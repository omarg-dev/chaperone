import { beforeEach, describe, expect, it } from "vitest";
import type { CreateOrderInput, PaymentAdapter, PaymentErrorCode } from "./types.js";

// What any payment adapter must do for the firewall to work. The fake runs this in the normal
// test run; the sandbox adapter runs it in its own command against the real sandbox, which is what
// shows the fake behaves like the platform.
export interface ContractHarness {
  adapter: PaymentAdapter;
  // Two payee keys that map to different merchant accounts.
  payees: [string, string];
  // Approves an order as the buyer would.
  approve(orderId: string): Promise<void>;
  // A saved buyer wallet. Required when the adapter claims `savedWallet`.
  vaultId?: string;
  // Moves time forward. Required when the adapter claims `timeTravel`.
  advanceDays?(days: number): void;
}

// What the adapter under test can do. The checks that need a capability are only registered when
// it's claimed, so an adapter that can't move time (the sandbox) simply doesn't have those tests,
// instead of having tests that pass without checking anything.
export interface ContractCapabilities {
  savedWallet: boolean;
  timeTravel: boolean;
}

export function paymentContract(
  name: string,
  capabilities: ContractCapabilities,
  setup: () => Promise<ContractHarness>,
) {
  describe(`payment contract: ${name}`, () => {
    let h: ContractHarness;
    beforeEach(async () => {
      h = await setup();
    });

    const order = (overrides: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
      currency: "USD",
      customId: "md_test:run_test",
      invoiceId: `inv_${Math.random().toString(36).slice(2)}`,
      purchaseUnits: [
        {
          referenceId: "line_1",
          payeeKey: h.payees[0],
          description: "Keyboard",
          amountCents: 10999,
        },
      ],
      ...overrides,
    });

    const approvedOrder = async (overrides: Partial<CreateOrderInput> = {}) => {
      const created = await h.adapter.createOrder(order(overrides));
      await h.approve(created.orderId);
      return created;
    };

    const fails = async (promise: Promise<unknown>, code: PaymentErrorCode) => {
      await expect(promise).rejects.toMatchObject({ code });
    };

    it("creates an order that waits for the buyer, with a link to approve it", async () => {
      const created = await h.adapter.createOrder(order());
      expect(created.status).toBe("PAYER_ACTION_REQUIRED");
      expect(created.approveUrl).toMatch(/^https:\/\//);
    });

    it("keeps the custom ID and invoice ID that link it to the event log", async () => {
      const input = order();
      const created = await h.adapter.createOrder(input);
      const read = await h.adapter.getOrder(created.orderId);
      expect(read.customId).toBe(input.customId);
      expect(read.invoiceId).toBe(input.invoiceId);
    });

    it("pays each purchase unit to its own merchant", async () => {
      const created = await approvedOrder({
        purchaseUnits: [
          { referenceId: "a", payeeKey: h.payees[0], description: "One", amountCents: 1000 },
          { referenceId: "b", payeeKey: h.payees[1], description: "Two", amountCents: 2000 },
        ],
      });
      const auths = await h.adapter.authorizeOrder(created.orderId);
      expect(auths.map((a) => [a.referenceId, a.amountCents])).toEqual([
        ["a", 1000],
        ["b", 2000],
      ]);
      expect(auths[0]?.merchantId).not.toBe(auths[1]?.merchantId);
    });

    it("won't authorize before the buyer approves", async () => {
      const created = await h.adapter.createOrder(order());
      await fails(h.adapter.authorizeOrder(created.orderId), "payer_action_required");
    });

    it("authorizes once: holds the money without capturing it", async () => {
      const created = await approvedOrder();
      const [auth] = await h.adapter.authorizeOrder(created.orderId);
      expect(auth?.status).toBe("CREATED");
      await fails(h.adapter.authorizeOrder(created.orderId), "invalid_state");
    });

    it("captures a held authorization, once", async () => {
      const [auth] = await h.adapter.authorizeOrder((await approvedOrder()).orderId);
      const id = auth?.authorizationId as string;
      const capture = await h.adapter.captureAuthorization(id);
      expect(capture.amountCents).toBe(10999);
      expect((await h.adapter.getAuthorization(id)).status).toBe("CAPTURED");
      await fails(h.adapter.captureAuthorization(id), "invalid_state");
    });

    it("voids a held authorization, after which it can't be captured", async () => {
      const [auth] = await h.adapter.authorizeOrder((await approvedOrder()).orderId);
      const id = auth?.authorizationId as string;
      expect((await h.adapter.voidAuthorization(id)).status).toBe("VOIDED");
      await fails(h.adapter.captureAuthorization(id), "invalid_state");
    });

    it("refunds part of a capture, then the rest, and no more", async () => {
      const [auth] = await h.adapter.authorizeOrder((await approvedOrder()).orderId);
      const capture = await h.adapter.captureAuthorization(auth?.authorizationId as string);
      expect((await h.adapter.refundCapture(capture.captureId, 999)).amountCents).toBe(999);
      expect((await h.adapter.refundCapture(capture.captureId)).amountCents).toBe(10000);
      await fails(h.adapter.refundCapture(capture.captureId, 1), "over_refund");
    });

    it("won't reauthorize during the honour period", async () => {
      const [auth] = await h.adapter.authorizeOrder((await approvedOrder()).orderId);
      await fails(h.adapter.reauthorize(auth?.authorizationId as string), "too_early");
    });

    it("answers not_found for IDs it doesn't know", async () => {
      await fails(h.adapter.getOrder("ORDER-NOPE"), "not_found");
      await fails(h.adapter.captureAuthorization("AUTH-NOPE"), "not_found");
      await fails(h.adapter.refundCapture("CAPTURE-NOPE"), "not_found");
    });

    if (capabilities.savedWallet) {
      it("approves the order at once with a saved wallet, with no link to follow", async () => {
        const created = await h.adapter.createOrder(order({ vaultId: h.vaultId as string }));
        expect(created.status).toBe("APPROVED");
        expect(created.approveUrl).toBeNull();
        expect(await h.adapter.authorizeOrder(created.orderId)).toHaveLength(1);
      });
    }
  });

  if (!capabilities.timeTravel) return;

  describe(`payment contract: ${name}, time limits`, () => {
    let h: ContractHarness;
    beforeEach(async () => {
      h = await setup();
    });

    const authorize = async () => {
      const created = await h.adapter.createOrder({
        currency: "USD",
        customId: "md_test:run_test",
        invoiceId: "inv_time",
        purchaseUnits: [
          { referenceId: "line_1", payeeKey: h.payees[0], description: "Mouse", amountCents: 4999 },
        ],
      });
      await h.approve(created.orderId);
      const [auth] = await h.adapter.authorizeOrder(created.orderId);
      return auth?.authorizationId as string;
    };

    it("reauthorizes after the honour period, replacing the old hold", async () => {
      const id = await authorize();
      h.advanceDays?.(4);
      const fresh = await h.adapter.reauthorize(id);
      expect(fresh.authorizationId).not.toBe(id);
      expect(fresh.amountCents).toBe(4999);
      expect((await h.adapter.getAuthorization(id)).status).toBe("VOIDED");
      expect((await h.adapter.captureAuthorization(fresh.authorizationId)).amountCents).toBe(4999);
    });

    it("expires an authorization after 29 days", async () => {
      const id = await authorize();
      h.advanceDays?.(30);
      expect((await h.adapter.getAuthorization(id)).status).toBe("EXPIRED");
      await expect(h.adapter.captureAuthorization(id)).rejects.toMatchObject({ code: "expired" });
    });
  });
}
