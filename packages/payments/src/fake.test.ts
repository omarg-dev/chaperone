import { describe, expect, it } from "vitest";
import { paymentContract } from "./contract.js";
import { createFakePaymentAdapter, DEFAULT_MERCHANTS, PLATFORM_ACCOUNT } from "./fake.js";
import type { CreateOrderInput, LineItemInput } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const VAULT = "VAULT-FAKE-BUYER";

paymentContract("in-memory fake", { savedWallet: true, timeTravel: true }, async () => {
  let now = Date.UTC(2026, 10, 1);
  const adapter = createFakePaymentAdapter({ clock: () => new Date(now) });
  return {
    adapter,
    payees: ["seller_1", "attacker_1"],
    approve: (orderId) => adapter.approve(orderId),
    vaultId: VAULT,
    advanceDays: (days) => {
      now += days * DAY_MS;
    },
  };
});

const item = (overrides: Partial<LineItemInput> = {}): LineItemInput => ({
  lineId: "a",
  payeeKey: "seller_1",
  name: "x",
  quantity: 1,
  unitAmountCents: 1000,
  ...overrides,
});

const input = (items: LineItemInput[] = [item()]): CreateOrderInput => ({
  currency: "USD",
  customId: "md_1:run_1",
  invoiceId: "inv_1",
  purchaseUnits: [{ referenceId: "cart", description: "Cart", items }],
});

describe("fake payment adapter", () => {
  it("credits the platform on capture, then moves each seller's share on payout", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(
      input([item(), item({ lineId: "b", payeeKey: "attacker_1", unitAmountCents: 2500 })]),
    );
    const auth = await fake.authorizeOrder(order.orderId, { vaultId: VAULT });
    const capture = await fake.captureAuthorization(auth.authorizationId);
    expect(fake.balances()).toEqual({ [PLATFORM_ACCOUNT]: 3500 });

    const payout = await fake.createPayout({
      captureId: capture.captureId,
      payeeKey: "attacker_1",
      amountCents: 2500,
    });
    // Pending money hasn't moved yet.
    expect(fake.balances()).toEqual({ [PLATFORM_ACCOUNT]: 3500 });
    await fake.getPayout(payout.payoutId);
    expect(fake.balances()).toEqual({
      [PLATFORM_ACCOUNT]: 1000,
      [DEFAULT_MERCHANTS.attacker_1 as string]: 2500,
    });
  });

  it("takes a refund out of the platform's balance, not the seller's", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(input());
    const auth = await fake.authorizeOrder(order.orderId, { vaultId: VAULT });
    const capture = await fake.captureAuthorization(auth.authorizationId);
    await fake.refundCapture(capture.captureId, 400);
    expect(fake.balances()).toEqual({ [PLATFORM_ACCOUNT]: 600 });
  });

  it("moves no money for a voided authorization", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(input());
    const auth = await fake.authorizeOrder(order.orderId, { vaultId: VAULT });
    await fake.voidAuthorization(auth.authorizationId);
    expect(fake.balances()).toEqual({});
  });

  it.each([
    ["a zero price", [item({ unitAmountCents: 0 })], /positive/],
    ["a fractional quantity", [item({ quantity: 1.5 })], /whole number/],
    ["no lines", [], /with items/],
    ["duplicate line IDs", [item(), item({ payeeKey: "seller_2" })], /unique/],
  ] as const)("refuses an order with %s", async (_, items, message) => {
    const fake = createFakePaymentAdapter();
    await expect(fake.createOrder(input([...items]))).rejects.toThrow(message);
  });

  it("refuses an order with no purchase unit", async () => {
    const fake = createFakePaymentAdapter();
    await expect(fake.createOrder({ ...input(), purchaseUnits: [] })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("returns copies, so a caller can't change the fake's state by editing a result", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(input());
    order.status = "COMPLETED";
    expect((await fake.getOrder(order.orderId)).status).toBe("PAYER_ACTION_REQUIRED");
  });
});
