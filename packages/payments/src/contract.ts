import { beforeEach, describe, expect, it } from "vitest";
import { splitPayouts } from "./rules.js";
import type {
  Authorization,
  CreateOrderInput,
  LineItemInput,
  PaymentAdapter,
  PaymentErrorCode,
  Payout,
} from "./types.js";

// What any payment adapter must do for the firewall to work. The fake runs this in the normal
// test run; the sandbox adapter runs it in its own command against the real sandbox
// (`pnpm --filter @firewall/payments test:sandbox`), which is what shows the fake behaves like the
// platform. Amounts stay at a few dollars, since the sandbox run moves real sandbox money.
export interface ContractHarness {
  adapter: PaymentAdapter;
  // Two payee keys that map to different merchant accounts.
  payees: [string, string];
  // Approves an order as the buyer would, by following its approval link.
  approve(orderId: string): Promise<void>;
  // A saved buyer wallet. Required when the adapter claims `savedWallet`.
  vaultId?: string;
  // Moves time forward. Required when the adapter claims `timeTravel`.
  advanceDays?(days: number): void;
  // How long to wait between reads of a payout that hasn't landed yet. The fake needs no wait;
  // the sandbox takes up to a minute.
  payoutPollMs?: number;
}

// What the adapter under test can do. The checks that need a capability are only registered when
// it's claimed, so an adapter that can't move time (the sandbox) simply doesn't have those tests,
// instead of having tests that pass without checking anything.
export interface ContractCapabilities {
  savedWallet: boolean;
  timeTravel: boolean;
}

const PAYOUT_WAIT_MS = 120_000;

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

    const line = (overrides: Partial<LineItemInput> = {}): LineItemInput => ({
      lineId: "line_1",
      payeeKey: h.payees[0],
      name: "Keyboard",
      quantity: 1,
      unitAmountCents: 200,
      ...overrides,
    });

    const order = (items: LineItemInput[] = [line()]): CreateOrderInput => ({
      currency: "USD",
      customId: "md_test:run_test",
      invoiceId: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      purchaseUnits: [{ referenceId: "cart", description: "Arena cart", items }],
    });

    const fails = async (promise: Promise<unknown>, code: PaymentErrorCode) => {
      await expect(promise).rejects.toMatchObject({ code });
    };

    // A held cart, the way the firewall usually gets one: with the saved wallet when the adapter
    // has one, otherwise through the approval link.
    const hold = async (items?: LineItemInput[]): Promise<Authorization> => {
      const created = await h.adapter.createOrder(order(items));
      if (capabilities.savedWallet) {
        return h.adapter.authorizeOrder(created.orderId, { vaultId: h.vaultId as string });
      }
      await h.approve(created.orderId);
      return h.adapter.authorizeOrder(created.orderId);
    };

    const captured = async (items?: LineItemInput[]) =>
      h.adapter.captureAuthorization((await hold(items)).authorizationId);

    const landed = async (payoutId: string): Promise<Payout> => {
      const pollMs = h.payoutPollMs ?? 0;
      const tries = pollMs > 0 ? Math.ceil(PAYOUT_WAIT_MS / pollMs) : 3;
      let payout = await h.adapter.getPayout(payoutId);
      for (let i = 1; i < tries && payout.status === "PENDING"; i++) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        payout = await h.adapter.getPayout(payoutId);
      }
      return payout;
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

    it("carries each line's seller, quantity and price on the order, adding up to the total", async () => {
      const items = [
        line({ lineId: "lst_a", payeeKey: h.payees[0], name: "Keyboard", unitAmountCents: 125 }),
        line({
          lineId: "lst_b",
          payeeKey: h.payees[1],
          name: "Cable",
          quantity: 2,
          unitAmountCents: 50,
        }),
      ];
      const created = await h.adapter.createOrder(order(items));
      const [unit] = (await h.adapter.getOrder(created.orderId)).purchaseUnits;
      expect(unit?.amountCents).toBe(225);
      expect(unit?.items).toEqual(items);
    });

    it("holds a whole cart in one purchase unit, and refuses an order with two", async () => {
      const two = order();
      two.purchaseUnits.push({ referenceId: "second", description: "Second", items: [line()] });
      await fails(h.adapter.createOrder(two), "unsupported_intent");
    });

    it("refuses a line whose seller it can't pay out to", async () => {
      await fails(h.adapter.createOrder(order([line({ payeeKey: "nobody" })])), "invalid_request");
    });

    it("won't authorize before the buyer approves", async () => {
      const created = await h.adapter.createOrder(order());
      await fails(h.adapter.authorizeOrder(created.orderId), "payer_action_required");
    });

    it("authorizes once the buyer approves through the link: one hold for the whole cart", async () => {
      const created = await h.adapter.createOrder(
        order([line(), line({ lineId: "line_2", payeeKey: h.payees[1], unitAmountCents: 100 })]),
      );
      await h.approve(created.orderId);
      const auth = await h.adapter.authorizeOrder(created.orderId);
      expect(auth).toMatchObject({ orderId: created.orderId, amountCents: 300, status: "CREATED" });
      await fails(h.adapter.authorizeOrder(created.orderId), "invalid_state");
    });

    if (capabilities.savedWallet) {
      it("authorizes at once with the saved wallet, with no link to follow, once", async () => {
        const created = await h.adapter.createOrder(order());
        const auth = await h.adapter.authorizeOrder(created.orderId, {
          vaultId: h.vaultId as string,
        });
        expect(auth.status).toBe("CREATED");
        expect((await h.adapter.getOrder(created.orderId)).approveUrl).toBeNull();
        await fails(
          h.adapter.authorizeOrder(created.orderId, { vaultId: h.vaultId as string }),
          "invalid_state",
        );
      });
    }

    it("captures a held authorization, once", async () => {
      const auth = await hold();
      const capture = await h.adapter.captureAuthorization(auth.authorizationId);
      expect(capture).toMatchObject({ amountCents: 200, status: "COMPLETED" });
      expect((await h.adapter.getAuthorization(auth.authorizationId)).status).toBe("CAPTURED");
      await fails(h.adapter.captureAuthorization(auth.authorizationId), "invalid_state");
    });

    // The sellers are paid out of what the platform received, so the capture has to say what that
    // was (docs/PLAN.md, "Fees").
    it("reports what the platform received from a capture, after its fees", async () => {
      const capture = await captured();
      const net = capture.netAmountCents as number;
      expect(Number.isInteger(net)).toBe(true);
      expect(net).toBeGreaterThan(0);
      expect(net).toBeLessThan(200);
    });

    it("voids a held authorization, after which it can't be captured or voided again", async () => {
      const auth = await hold();
      expect((await h.adapter.voidAuthorization(auth.authorizationId)).status).toBe("VOIDED");
      expect((await h.adapter.getAuthorization(auth.authorizationId)).status).toBe("VOIDED");
      await fails(h.adapter.captureAuthorization(auth.authorizationId), "invalid_state");
      await fails(h.adapter.voidAuthorization(auth.authorizationId), "invalid_state");
    });

    it("refunds part of the platform's capture, then the rest, and no more", async () => {
      const capture = await captured();
      expect((await h.adapter.refundCapture(capture.captureId, 50)).amountCents).toBe(50);
      await fails(h.adapter.refundCapture(capture.captureId, 500), "over_refund");
      expect((await h.adapter.refundCapture(capture.captureId)).amountCents).toBe(150);
      await fails(h.adapter.refundCapture(capture.captureId, 1), "over_refund");
    });

    it("pays a seller its share of what the platform received, landing with that seller", async () => {
      const items = [
        line({ payeeKey: h.payees[0], unitAmountCents: 150 }),
        line({ lineId: "line_2", payeeKey: h.payees[1], unitAmountCents: 100 }),
      ];
      const capture = await captured(items);
      const shares = splitPayouts(capture.netAmountCents as number, items);
      expect(shares.map((share) => share.payeeKey)).toEqual(h.payees);
      const share = shares[1]?.amountCents as number;
      const payout = await h.adapter.createPayout({
        captureId: capture.captureId,
        payeeKey: h.payees[1],
        amountCents: share,
      });
      expect(payout).toMatchObject({ captureId: capture.captureId, payeeKey: h.payees[1] });
      const read = await landed(payout.payoutId);
      expect(read).toMatchObject({
        payoutId: payout.payoutId,
        captureId: capture.captureId,
        payeeKey: h.payees[1],
        merchantId: payout.merchantId,
        amountCents: share,
        status: "SUCCESS",
      });
    });

    it("pays a seller once per capture, so a retried payout can't pay twice", async () => {
      const capture = await captured();
      const payout = {
        captureId: capture.captureId,
        payeeKey: h.payees[0],
        amountCents: capture.netAmountCents as number,
      };
      await h.adapter.createPayout(payout);
      await fails(h.adapter.createPayout(payout), "duplicate");
    });

    it("won't pay out of an unknown capture, more than the platform received, or a refund", async () => {
      await fails(
        h.adapter.createPayout({
          captureId: "CAPTURE-NOPE",
          payeeKey: h.payees[0],
          amountCents: 1,
        }),
        "not_found",
      );
      const capture = await captured();
      await fails(
        h.adapter.createPayout({
          captureId: capture.captureId,
          payeeKey: h.payees[0],
          amountCents: (capture.netAmountCents as number) + 1,
        }),
        "invalid_request",
      );
      await h.adapter.refundCapture(capture.captureId);
      await fails(
        h.adapter.createPayout({
          captureId: capture.captureId,
          payeeKey: h.payees[0],
          amountCents: capture.netAmountCents as number,
        }),
        "invalid_state",
      );
    });

    it("won't reauthorize during the honour period", async () => {
      const auth = await hold();
      await fails(h.adapter.reauthorize(auth.authorizationId), "too_early");
      await h.adapter.voidAuthorization(auth.authorizationId);
    });

    it("answers not_found for IDs it doesn't know", async () => {
      await fails(h.adapter.getOrder("ORDER-NOPE"), "not_found");
      await fails(h.adapter.getAuthorization("AUTH-NOPE"), "not_found");
      await fails(h.adapter.captureAuthorization("AUTH-NOPE"), "not_found");
      await fails(h.adapter.refundCapture("CAPTURE-NOPE"), "not_found");
      await fails(h.adapter.getPayout("PAYOUT-NOPE"), "not_found");
    });
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
          {
            referenceId: "cart",
            description: "Arena cart",
            items: [
              {
                lineId: "line_1",
                payeeKey: h.payees[0],
                name: "Mouse",
                quantity: 1,
                unitAmountCents: 499,
              },
            ],
          },
        ],
      });
      await h.approve(created.orderId);
      return (await h.adapter.authorizeOrder(created.orderId)).authorizationId;
    };

    it("reauthorizes after the honour period, replacing the old hold", async () => {
      const id = await authorize();
      h.advanceDays?.(4);
      const fresh = await h.adapter.reauthorize(id);
      expect(fresh.authorizationId).not.toBe(id);
      expect(fresh.amountCents).toBe(499);
      expect((await h.adapter.getAuthorization(id)).status).toBe("VOIDED");
      expect((await h.adapter.captureAuthorization(fresh.authorizationId)).amountCents).toBe(499);
    });

    // The platform allows one reauthorization per hold, from day 4 to day 29 of the original,
    // and a reauthorized hold doesn't outlive that window.
    it("reauthorizes a hold only once, within the original's 29 days", async () => {
      const id = await authorize();
      const original = await h.adapter.getAuthorization(id);
      h.advanceDays?.(4);
      const fresh = await h.adapter.reauthorize(id);
      expect(fresh.expiresAt).toBe(original.expiresAt);
      h.advanceDays?.(4);
      await expect(h.adapter.reauthorize(fresh.authorizationId)).rejects.toMatchObject({
        code: "invalid_state",
      });
      await expect(h.adapter.reauthorize(id)).rejects.toMatchObject({ code: "invalid_state" });
      expect((await h.adapter.getAuthorization(fresh.authorizationId)).status).toBe("CREATED");
      h.advanceDays?.(22);
      expect((await h.adapter.getAuthorization(fresh.authorizationId)).status).toBe("EXPIRED");
    });

    it("expires an authorization after 29 days", async () => {
      const id = await authorize();
      h.advanceDays?.(30);
      expect((await h.adapter.getAuthorization(id)).status).toBe("EXPIRED");
      await expect(h.adapter.captureAuthorization(id)).rejects.toMatchObject({ code: "expired" });
    });
  });
}
