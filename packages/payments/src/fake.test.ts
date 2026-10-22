import { describe, expect, it } from "vitest";
import { paymentContract } from "./contract.js";
import { createFakePaymentAdapter, DEFAULT_MERCHANTS, MAX_PURCHASE_UNITS } from "./fake.js";
import type { CreateOrderInput } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

paymentContract("in-memory fake", { savedWallet: true, timeTravel: true }, async () => {
  let now = Date.UTC(2026, 10, 1);
  const adapter = createFakePaymentAdapter({ clock: () => new Date(now) });
  return {
    adapter,
    payees: ["seller_1", "attacker_1"],
    approve: (orderId) => adapter.approve(orderId),
    vaultId: "VAULT-FAKE-BUYER",
    advanceDays: (days) => {
      now += days * DAY_MS;
    },
  };
});

const input = (overrides: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  currency: "USD",
  customId: "md_1:run_1",
  invoiceId: "inv_1",
  purchaseUnits: [{ referenceId: "a", payeeKey: "seller_1", description: "x", amountCents: 1000 }],
  ...overrides,
});

describe("fake payment adapter", () => {
  it("credits a merchant on capture and debits it on refund", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(
      input({
        vaultId: "VAULT",
        purchaseUnits: [
          { referenceId: "a", payeeKey: "seller_1", description: "x", amountCents: 1000 },
          { referenceId: "b", payeeKey: "attacker_1", description: "y", amountCents: 2500 },
        ],
      }),
    );
    const [honest, attacker] = await fake.authorizeOrder(order.orderId);
    await fake.captureAuthorization(honest?.authorizationId as string);
    const capture = await fake.captureAuthorization(attacker?.authorizationId as string);
    expect(fake.balances()).toEqual({
      [DEFAULT_MERCHANTS.seller_1 as string]: 1000,
      [DEFAULT_MERCHANTS.attacker_1 as string]: 2500,
    });
    await fake.refundCapture(capture.captureId);
    expect(fake.balances()[DEFAULT_MERCHANTS.attacker_1 as string]).toBe(0);
  });

  it("moves no money for a voided authorization", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(input({ vaultId: "VAULT" }));
    const [auth] = await fake.authorizeOrder(order.orderId);
    await fake.voidAuthorization(auth?.authorizationId as string);
    expect(fake.balances()).toEqual({});
  });

  it.each([
    [
      "an unknown payee",
      {
        purchaseUnits: [{ referenceId: "a", payeeKey: "nobody", description: "x", amountCents: 1 }],
      },
      /Unknown payee/,
    ],
    [
      "a zero amount",
      {
        purchaseUnits: [
          { referenceId: "a", payeeKey: "seller_1", description: "x", amountCents: 0 },
        ],
      },
      /positive/,
    ],
    ["no purchase units", { purchaseUnits: [] }, /1 to 10/],
    [
      "too many purchase units",
      {
        purchaseUnits: Array.from({ length: MAX_PURCHASE_UNITS + 1 }, (_, i) => ({
          referenceId: `r${i}`,
          payeeKey: "seller_1",
          description: "x",
          amountCents: 1,
        })),
      },
      /1 to 10/,
    ],
    [
      "duplicate reference IDs",
      {
        purchaseUnits: [
          { referenceId: "a", payeeKey: "seller_1", description: "x", amountCents: 1 },
          { referenceId: "a", payeeKey: "seller_2", description: "y", amountCents: 1 },
        ],
      },
      /unique/,
    ],
  ] as const)("refuses an order with %s", async (_, overrides, message) => {
    const fake = createFakePaymentAdapter();
    await expect(fake.createOrder(input(overrides as Partial<CreateOrderInput>))).rejects.toThrow(
      message,
    );
  });

  it("returns copies, so a caller can't change the fake's state by editing a result", async () => {
    const fake = createFakePaymentAdapter();
    const order = await fake.createOrder(input());
    order.status = "COMPLETED";
    expect((await fake.getOrder(order.orderId)).status).toBe("PAYER_ACTION_REQUIRED");
  });
});
