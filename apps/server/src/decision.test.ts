import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaService } from "@firewall/arena";
import { type Event, type EventLog, openEventLog } from "@firewall/events";
import { enforceReview } from "@firewall/firewall";
import {
  createFakePaymentAdapter,
  type FakePaymentAdapter,
  type PaymentAdapter,
  PaymentError,
  recordPayments,
} from "@firewall/payments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// A person's decision over HTTP, on a real SQLite event log in a temp folder and the in-memory fake
// payment platform: what the route does is what `decide-run` does, because it calls the same code.

let dir: string;
let log: EventLog;
let fake: FakePaymentAdapter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "server-decision-"));
  log = openEventLog({ path: join(dir, "events.db") });
  fake = createFakePaymentAdapter();
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

const appWith = (payments?: PaymentAdapter, paymentsUnavailable?: string) =>
  createApp({
    log,
    arena: createArenaService({ log }),
    ...(payments && { payments }),
    ...(paymentsUnavailable && { paymentsUnavailable }),
  });

// A run the way the pipeline leaves it: started, its order held on the platform, and reviewed with
// the given verdict, an escalation then waiting for a person.
async function heldRun(verdict: "escalate" | "approve" = "escalate") {
  const runId = "run_held";
  const started = log.append({
    runId,
    scenarioId: "sc_a01",
    lane: "arena",
    type: "run_started",
    provenance: "user",
    payload: { seed: "1", request: "Buy me a keyboard." },
  });
  const payments = recordPayments(fake, log, () => ({
    runId,
    scenarioId: "sc_a01",
    parentId: started.eventId,
  }));
  const order = await payments.createOrder({
    currency: "USD",
    customId: runId,
    invoiceId: "inv_1",
    purchaseUnits: [
      {
        referenceId: "cart",
        description: "Cart",
        items: [
          {
            lineId: "l1",
            payeeKey: "seller_2",
            name: "Keyboard",
            quantity: 1,
            unitAmountCents: 6199,
          },
        ],
      },
    ],
  });
  await payments.authorizeOrder(order.orderId, { vaultId: "FAKE-WALLET" });
  const review = log.append({
    runId,
    scenarioId: "sc_a01",
    lane: "review",
    type: "review_finished",
    provenance: "system",
    parentId: started.eventId,
    payload: { config: "full", verdict, gates: [], skipped: [], costUsd: 0 },
  });
  if (verdict === "escalate") await enforceReview(runId, { log, payments: fake });
  return { runId, review };
}

const decide = (app: ReturnType<typeof createApp>, runId: string, body: unknown) =>
  app.request(`/events/runs/${runId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const paymentOps = (runId: string) =>
  log
    .listRun(runId)
    .filter((e) => e.lane === "payments")
    .map((e) => (e.payload as { operation: string }).operation);

describe("POST /events/runs/:runId/decision", () => {
  it("approving captures the hold and pays the seller, and writes the person's decision", async () => {
    const { runId, review } = await heldRun();
    const res = await decide(appWith(fake), runId, { decision: "approve", note: "Fine by me" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "enforced",
      money: "captured",
      decidedBy: "person",
      payouts: [{ payeeKey: "seller_2" }],
    });
    const events = log.listRun(runId);
    const human = events.find((e) => e.type === "human_decision");
    expect(human).toMatchObject({ lane: "human", provenance: "user", parentId: review.eventId });
    expect(human?.payload).toMatchObject({ decision: "approve", note: "Fine by me" });
    expect(paymentOps(runId)).toContain("capture");
    expect(events.at(-1)).toMatchObject({ lane: "review", type: "enforced" });
  });

  it("rejecting voids the hold, so nobody is paid", async () => {
    const { runId } = await heldRun();
    const res = await decide(appWith(fake), runId, { decision: "reject" });
    expect(await res.json()).toMatchObject({ status: "enforced", money: "voided", payouts: [] });
    expect(paymentOps(runId)).toContain("void");
    expect(paymentOps(runId)).not.toContain("capture");
  });

  it("is idempotent: the same decision again changes nothing, and the opposite one is refused", async () => {
    const { runId } = await heldRun();
    const app = appWith(fake);
    await decide(app, runId, { decision: "approve" });
    const before = log.listRun(runId).length;

    const again = await decide(app, runId, { decision: "approve" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "already_enforced", money: "captured" });
    expect(log.listRun(runId)).toHaveLength(before);

    const opposite = await decide(app, runId, { decision: "reject" });
    expect(opposite.status).toBe(409);
    expect(await opposite.json()).toMatchObject({ error: "cannot_decide" });
    expect(log.listRun(runId)).toHaveLength(before);
  });

  it("refuses a run whose review didn't escalate: there is nothing for a person to decide", async () => {
    const { runId } = await heldRun("approve");
    const res = await decide(appWith(fake), runId, { decision: "approve" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(/not escalate/);
    expect(log.listRun(runId).some((e) => e.type === "human_decision")).toBe(false);
  });

  it("refuses a body that isn't a decision, and a run that doesn't exist", async () => {
    const { runId } = await heldRun();
    const app = appWith(fake);
    expect((await decide(app, runId, { decision: "maybe" })).status).toBe(400);
    expect((await decide(app, runId, {})).status).toBe(400);
    expect((await decide(app, runId, { decision: "approve", note: "" })).status).toBe(400);
    const missing = await decide(app, "run_nope", { decision: "approve" });
    expect(missing.status).toBe(404);
  });

  it("says what's missing when the server has no payment platform, and writes nothing", async () => {
    const { runId } = await heldRun();
    const before = log.listRun(runId).length;
    const res = await decide(appWith(undefined, "Needs SANDBOX_CLIENT_ID."), runId, {
      decision: "approve",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "decisions_unavailable",
      message: "Needs SANDBOX_CLIENT_ID.",
    });
    expect(log.listRun(runId)).toHaveLength(before);
  });

  it("answers 502 when the platform refuses, and a retry can finish the job", async () => {
    const { runId } = await heldRun();
    let down = true;
    const flaky: PaymentAdapter = new Proxy(fake, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "captureAuthorization") return value;
        return async (id: string) => {
          if (down) throw new PaymentError("platform_error", "The platform is down");
          return target.captureAuthorization(id);
        };
      },
    });
    const app = appWith(flaky);
    const failed = await decide(app, runId, { decision: "approve" });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: "payment_failed" });

    down = false;
    const retried = await decide(app, runId, { decision: "approve" });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ money: "captured", decidedBy: "person" });
    // One decision on the log, however many tries it took.
    expect(log.listRun(runId).filter((e) => e.type === "human_decision")).toHaveLength(1);
  });
});

// What GET /events/runs says an escalated run needs: the top bar's count, the Runs filter and the
// inbox all read it, so it has to follow the money rather than only whether a person decided.
describe("GET /events/runs on an escalated run", () => {
  const listed = async (app: ReturnType<typeof createApp>, runId: string) => {
    const runs = (await (await app.request("/events/runs")).json()) as Record<string, unknown>[];
    return runs.find((r) => r.runId === runId);
  };

  it("is waiting while the hold is open and nobody has decided, and decided once the money moved", async () => {
    const { runId } = await heldRun();
    const app = appWith(fake);
    expect(await listed(app, runId)).toMatchObject({
      verdict: "escalate",
      decidedBy: "review",
      holdOpen: true,
      escalation: "waiting",
    });
    await decide(app, runId, { decision: "reject" });
    expect(await listed(app, runId)).toMatchObject({
      verdict: "block",
      decidedBy: "person",
      holdOpen: false,
      escalation: "decided",
    });
  });

  it("is released, not waiting, when the hold was voided with no decision (what the eval does)", async () => {
    const { runId, review } = await heldRun();
    const authorizing = log
      .listRun(runId)
      .find((e) => (e.payload as { operation?: string }).operation === "authorize_order") as Event;
    const { authorizationId } = (authorizing.payload as { result: { authorizationId: string } })
      .result;
    await recordPayments(fake, log, () => ({
      runId,
      scenarioId: "sc_a01",
      parentId: review.eventId,
    })).voidAuthorization(authorizationId);

    const app = appWith(fake);
    expect(await listed(app, runId)).toMatchObject({
      verdict: "escalate",
      holdOpen: false,
      escalation: "released",
    });
    // A decision on it is refused with a 409 and a reason, and nothing is written.
    const before = log.listRun(runId).length;
    const res = await decide(app, runId, { decision: "approve" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(
      /released without a decision/,
    );
    expect(log.listRun(runId)).toHaveLength(before);
  });

  it("stays unfinished when the platform refused a decision, and the opposite decision is a 409", async () => {
    const { runId } = await heldRun();
    let down = true;
    const flaky: PaymentAdapter = new Proxy(fake, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property !== "captureAuthorization") return value;
        return async (id: string) => {
          if (down) throw new PaymentError("platform_error", "The platform is down");
          return target.captureAuthorization(id);
        };
      },
    });
    const app = appWith(flaky);
    expect((await decide(app, runId, { decision: "approve" })).status).toBe(502);
    // The decision is written but the hold is open: it still needs a person.
    expect(await listed(app, runId)).toMatchObject({
      verdict: "approve",
      decidedBy: "person",
      holdOpen: true,
      escalation: "unfinished",
    });
    const opposite = await decide(app, runId, { decision: "reject" });
    expect(opposite.status).toBe(409);
    expect(await opposite.json()).toMatchObject({ error: "cannot_decide" });
    expect(await listed(app, runId)).toMatchObject({ escalation: "unfinished" });

    down = false;
    expect((await decide(app, runId, { decision: "approve" })).status).toBe(200);
    expect(await listed(app, runId)).toMatchObject({ holdOpen: false, escalation: "decided" });
  });
});

describe("GET /events/runs/:runId/payees", () => {
  it("names the run's payees and which of them are attackers, from its scenario and seed", async () => {
    const { runId } = await heldRun();
    const res = await appWith(fake).request(`/events/runs/${runId}/payees`);
    const payees = (await res.json()) as { payeeKey: string; sellerName: string; role: string }[];
    expect(payees.filter((p) => p.role === "attacker").map((p) => p.payeeKey)).toEqual(
      expect.arrayContaining(["attacker_1"]),
    );
    expect(payees.find((p) => p.payeeKey === "seller_2")).toMatchObject({ role: "honest" });
    expect(payees.every((p) => p.sellerName.length > 0)).toBe(true);
  });

  it("is empty for a run it knows nothing about", async () => {
    const res = await appWith(fake).request("/events/runs/run_nope/payees");
    expect(await res.json()).toEqual([]);
  });
});
