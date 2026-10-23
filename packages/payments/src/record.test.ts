import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePaymentAdapter } from "./fake.js";
import { recordPayments } from "./record.js";

let dir: string;
let log: EventLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "payments-"));
  log = openEventLog({ path: join(dir, "events.db") });
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recordPayments", () => {
  it("writes each call to the payments lane with its result", async () => {
    const context = { runId: "run_pay", scenarioId: "sc_b01", parentId: null as string | null };
    const payments = recordPayments(createFakePaymentAdapter(), log, () => context);
    const order = await payments.createOrder({
      currency: "USD",
      customId: "md_1:run_pay",
      invoiceId: "inv_1",
      purchaseUnits: [
        {
          referenceId: "cart",
          description: "Cart",
          items: [
            { lineId: "a", payeeKey: "seller_1", name: "x", quantity: 1, unitAmountCents: 500 },
          ],
        },
      ],
    });
    const verdict = log.append({
      runId: "run_pay",
      lane: "gate0",
      type: "verdict",
      provenance: "system",
    });
    context.parentId = verdict.eventId;
    const auth = await payments.authorizeOrder(order.orderId, { vaultId: "VAULT" });
    const capture = await payments.captureAuthorization(auth.authorizationId);
    const payout = await payments.createPayout({
      captureId: capture.captureId,
      payeeKey: "seller_1",
      amountCents: capture.netAmountCents as number,
    });
    await payments.getPayout(payout.payoutId);

    const events = log.listRun("run_pay").filter((e) => e.lane === "payments");
    expect(events.map((e) => (e.payload as { operation: string }).operation)).toEqual([
      "create_order",
      "authorize_order",
      "capture",
      "payout",
      "get_payout",
    ]);
    expect(events[0]).toMatchObject({
      type: "payment_call",
      provenance: "system",
      scenarioId: "sc_b01",
    });
    expect(events[1]?.parentId).toBe(verdict.eventId);
    expect(events[0]?.payload).toMatchObject({ result: { orderId: order.orderId } });
    expect(events[1]?.payload).toMatchObject({ input: [order.orderId, { vaultId: "VAULT" }] });
    expect(events[3]?.payload).toMatchObject({
      input: [{ captureId: capture.captureId, payeeKey: "seller_1", amountCents: 434 }],
      result: { payoutId: payout.payoutId, status: "PENDING" },
    });
  });

  it("records a failed call with its error code, then rethrows", async () => {
    const payments = recordPayments(createFakePaymentAdapter(), log, () => ({ runId: "run_pay" }));
    await expect(payments.captureAuthorization("AUTH-NOPE")).rejects.toMatchObject({
      code: "not_found",
    });
    const [event] = log.listRun("run_pay");
    expect(event?.payload).toMatchObject({ operation: "capture", error: { code: "not_found" } });
  });
});
