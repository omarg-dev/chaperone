import type { Event } from "@firewall/events";
import {
  type Capture,
  createFakePaymentAdapter,
  type FakePaymentAdapter,
  type PaymentAdapter,
  type Payout,
} from "@firewall/payments";
import { afterEach, describe, expect, it } from "vitest";
import { decideEscalation, enforceReview } from "./enforce.js";
import { findGate2Case, type Gate2CaseRun, runGate2Case } from "./gate2-cases.js";
import { type FirewallConfig, runReview } from "./review.js";
import { gatesReplaying, loadGate2Recording } from "./test-helpers.js";
import { holdCheckout } from "./test-orders.js";

// Enforcement over the Gate 2 fixture cases, with the fake payment platform and a real event log.
// Each case's review comes from the real gates replaying their recordings, so what's enforced is a
// verdict the tree really reached:
//   honest            -> approve   (the right keyboard from a verified store)
//   wrong_product     -> block     (Gate 0)
//   unrequested_extra -> escalate  (a mouse nobody asked for, from another store)

const DAY_MS = 24 * 60 * 60 * 1000;

let run: Gate2CaseRun | undefined;
afterEach(() => run?.close());

async function setup(name: string, config: FirewallConfig, adapter?: FakePaymentAdapter) {
  const startedAt = new Date("2026-10-24T09:00:00.000Z");
  let clock = startedAt;
  const fake = adapter ?? createFakePaymentAdapter({ clock: () => clock });
  run = await runGate2Case(findGate2Case(name));
  const { log, runId } = run;
  const { hold, lines } = await holdCheckout(log, runId, fake);
  const review = await runReview(runId, {
    log,
    config,
    gates: gatesReplaying(run.catalog, loadGate2Recording(name)),
  });
  const options = { log, payments: fake, now: () => clock };
  const events = () => log.listRun(runId);
  const calls = (operation: string) =>
    events().filter(
      (e) => e.lane === "payments" && (e.payload as { operation: string }).operation === operation,
    );
  return {
    fake,
    log,
    runId,
    hold,
    lines,
    review,
    options,
    events,
    calls,
    wait: (days: number) => {
      clock = new Date(startedAt.getTime() + days * DAY_MS);
    },
  };
}

const resultOf = <T>(e: Event) => (e.payload as { result: T }).result;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("approve", () => {
  it("captures the hold, then pays each seller its share, adding up to the net amount", async () => {
    const s = await setup("honest", "full");
    expect(s.review.verdict).toBe("approve");
    const done = await enforceReview(s.runId, s.options);
    expect(done).toMatchObject({ status: "enforced", money: "captured", decidedBy: "review" });
    const capture = done.capture as Capture;
    expect(capture.amountCents).toBe(s.hold.amountCents);
    expect(capture.netAmountCents).toBeLessThan(capture.amountCents);
    expect(sum(done.payouts.map((p) => p.amountCents))).toBe(capture.netAmountCents);
    expect(done.payouts.map((p) => p.payeeKey).sort()).toEqual(
      [...new Set(s.lines.map((l) => l.payeeKey))].sort(),
    );
    // The platform's fee came off the capture before the split, so the sellers got less than the cart.
    expect(sum(done.payouts.map((p) => p.amountCents))).toBeLessThan(s.hold.amountCents);
    const order = s
      .events()
      .filter((e) => e.lane === "payments")
      .map((e) => (e.payload as { operation: string }).operation);
    expect(order.indexOf("capture")).toBeGreaterThan(order.indexOf("authorize_order"));
    expect(order.indexOf("payout")).toBeGreaterThan(order.indexOf("capture"));
  });

  it("points every payment call, and its own event, at the review's verdict", async () => {
    const s = await setup("honest", "full");
    const done = await enforceReview(s.runId, s.options);
    const verdictId = s.review.finishedEventId;

    const verdictSeq = s.events().find((x) => x.eventId === verdictId)?.seq ?? 0;
    const enforcing = s.events().filter((e) => e.lane === "payments" && e.seq > verdictSeq);
    expect(enforcing.length).toBeGreaterThanOrEqual(3);
    for (const e of enforcing) expect(e.parentId).toBe(verdictId);
    expect(s.calls("capture")[0]?.parentId).toBe(verdictId);
    const enforced = s.events().find((e) => e.eventId === done.eventId);
    expect(enforced).toMatchObject({ lane: "review", type: "enforced", parentId: verdictId });
    expect(enforced?.payload).toMatchObject({ verdictEventId: verdictId });
  });
});

describe("block", () => {
  it("voids the hold: nothing is captured and nobody is paid", async () => {
    const s = await setup("wrong_product", "full");
    expect(s.review.verdict).toBe("block");
    const done = await enforceReview(s.runId, s.options);
    expect(done).toMatchObject({ status: "enforced", money: "voided", decidedBy: "review" });
    expect(done.capture).toBeNull();
    expect(done.payouts).toEqual([]);
    expect(s.calls("capture")).toEqual([]);
    expect(s.calls("payout")).toEqual([]);
    expect(s.calls("void")).toHaveLength(1);
    expect((await s.fake.getAuthorization(s.hold.authorizationId)).status).toBe("VOIDED");
    expect(s.fake.balances()).toEqual({});
    expect(s.calls("void")[0]?.parentId).toBe(s.review.finishedEventId);
  });
});

describe("escalate", () => {
  it("leaves the order held and records that a person must decide", async () => {
    const s = await setup("unrequested_extra", "full");
    expect(s.review.verdict).toBe("escalate");
    const waiting = await enforceReview(s.runId, s.options);
    expect(waiting).toMatchObject({ status: "awaiting_person", money: "held" });
    expect(waiting.honorUntil).toBe(s.hold.honorUntil);
    expect((await s.fake.getAuthorization(s.hold.authorizationId)).status).toBe("CREATED");
    for (const op of ["capture", "void", "payout", "reauthorize"]) expect(s.calls(op)).toEqual([]);
    const escalated = s.events().find((e) => e.type === "escalated");
    expect(escalated).toMatchObject({
      lane: "review",
      provenance: "system",
      parentId: s.review.finishedEventId,
    });
    // Asking again doesn't write a second escalation.
    await enforceReview(s.runId, s.options);
    expect(s.events().filter((e) => e.type === "escalated")).toHaveLength(1);
  });

  it("approved by the person: captures and pays out, on their decision", async () => {
    const s = await setup("unrequested_extra", "full");
    await enforceReview(s.runId, s.options);
    const done = await decideEscalation(s.runId, "approve", { ...s.options, note: "I wanted it" });
    expect(done).toMatchObject({ status: "enforced", money: "captured", decidedBy: "person" });
    expect(sum(done.payouts.map((p) => p.amountCents))).toBe(done.capture?.netAmountCents);
    expect(done.payouts.length).toBeGreaterThan(1);
    const decision = s.events().find((e) => e.type === "human_decision") as Event;
    expect(decision).toMatchObject({
      lane: "human",
      provenance: "user",
      parentId: s.review.finishedEventId,
    });
    expect(decision.payload).toMatchObject({
      decision: "approve",
      verdictEventId: s.review.finishedEventId,
      note: "I wanted it",
    });
    // The money moved on the person's say-so, and says so.
    expect(s.calls("capture")[0]?.parentId).toBe(decision.eventId);
    const enforced = s.events().find((e) => e.eventId === done.eventId);
    expect(enforced?.parentId).toBe(decision.eventId);
    expect(enforced?.payload).toMatchObject({ humanDecisionEventId: decision.eventId });
  });

  it("rejected by the person: voids, with nothing captured", async () => {
    const s = await setup("unrequested_extra", "full");
    await enforceReview(s.runId, s.options);
    const done = await decideEscalation(s.runId, "reject", s.options);
    expect(done).toMatchObject({ status: "enforced", money: "voided", decidedBy: "person" });
    expect(s.calls("capture")).toEqual([]);
    expect(s.calls("payout")).toEqual([]);
    expect((await s.fake.getAuthorization(s.hold.authorizationId)).status).toBe("VOIDED");
  });

  it("only an escalated run has anything to decide, and a decision can't be reversed", async () => {
    const approved = await setup("honest", "full");
    await enforceReview(approved.runId, approved.options);
    await expect(decideEscalation(approved.runId, "reject", approved.options)).rejects.toThrow(
      /not escalate/,
    );
    run?.close();

    const s = await setup("unrequested_extra", "full");
    await enforceReview(s.runId, s.options);
    await decideEscalation(s.runId, "approve", s.options);
    await expect(decideEscalation(s.runId, "reject", s.options)).rejects.toThrow(/already decided/);
    // The same decision again changes nothing.
    const again = await decideEscalation(s.runId, "approve", s.options);
    expect(again.status).toBe("already_enforced");
    expect(s.calls("capture")).toHaveLength(1);
    expect(s.events().filter((e) => e.type === "human_decision")).toHaveLength(1);
  });

  it("reauthorizes a hold that outlived its honour period before capturing it", async () => {
    const s = await setup("unrequested_extra", "full");
    await enforceReview(s.runId, s.options);
    s.wait(4);
    const done = await decideEscalation(s.runId, "approve", s.options);
    expect(done.money).toBe("captured");
    expect(s.calls("reauthorize")).toHaveLength(1);
    const fresh = resultOf<{ authorizationId: string }>(s.calls("reauthorize")[0] as Event);
    expect(fresh.authorizationId).not.toBe(s.hold.authorizationId);
    expect(done.authorizationId).toBe(fresh.authorizationId);
    expect(done.capture?.authorizationId).toBe(fresh.authorizationId);
  });

  it("can't capture a hold that has expired, and says so", async () => {
    const s = await setup("unrequested_extra", "full");
    await enforceReview(s.runId, s.options);
    s.wait(40);
    await expect(decideEscalation(s.runId, "approve", s.options)).rejects.toThrow(
      /can't be captured/,
    );
    expect(s.calls("capture")).toEqual([]);
  });
});

describe("no firewall", () => {
  it("captures and pays out as it stands, even a cart the rules would have blocked", async () => {
    const s = await setup("wrong_product", "off");
    expect(s.review.verdict).toBeNull();
    const done = await enforceReview(s.runId, s.options);
    expect(done).toMatchObject({ status: "enforced", money: "captured", decidedBy: "no_review" });
    expect(sum(done.payouts.map((p) => p.amountCents))).toBe(done.capture?.netAmountCents);
    expect(s.calls("void")).toEqual([]);
    expect(s.calls("capture")[0]?.parentId).toBe(s.review.finishedEventId);
  });
});

describe("idempotency", () => {
  const paymentCalls = (s: Awaited<ReturnType<typeof setup>>) =>
    s.events().filter((e) => e.lane === "payments").length;

  it("running enforcement twice never captures or pays twice", async () => {
    const s = await setup("honest", "full");
    const first = await enforceReview(s.runId, s.options);
    const callsAfter = paymentCalls(s);
    const balances = s.fake.balances();
    const second = await enforceReview(s.runId, s.options);
    expect(second).toMatchObject({ status: "already_enforced", money: "captured" });
    expect(second.payouts).toEqual(first.payouts);
    expect(paymentCalls(s)).toBe(callsAfter);
    expect(s.fake.balances()).toEqual(balances);
    expect(s.events().filter((e) => e.type === "enforced")).toHaveLength(1);
  });

  it("running it twice at once is one enforcement", async () => {
    const s = await setup("honest", "full");
    const [a, b] = await Promise.all([
      enforceReview(s.runId, s.options),
      enforceReview(s.runId, s.options),
    ]);
    expect(a).toBe(b);
    expect(s.calls("capture")).toHaveLength(1);
    expect(s.calls("payout").length).toBe(a.payouts.length);
  });

  it("a voided run stays voided", async () => {
    const s = await setup("wrong_product", "full");
    await enforceReview(s.runId, s.options);
    await enforceReview(s.runId, s.options);
    expect(s.calls("void")).toHaveLength(1);
  });

  it("after a failure halfway, a retry captures nothing again and pays only the sellers left", async () => {
    const fake = createFakePaymentAdapter();
    let payoutCalls = 0;
    const flaky: PaymentAdapter = {
      ...fake,
      createOrder: (i) => fake.createOrder(i),
      getOrder: (i) => fake.getOrder(i),
      authorizeOrder: (i, o) => fake.authorizeOrder(i, o),
      getAuthorization: (i) => fake.getAuthorization(i),
      captureAuthorization: (i) => fake.captureAuthorization(i),
      voidAuthorization: (i) => fake.voidAuthorization(i),
      reauthorize: (i) => fake.reauthorize(i),
      refundCapture: (i, a) => fake.refundCapture(i, a),
      getPayout: (i) => fake.getPayout(i),
      createPayout: async (input) => {
        payoutCalls += 1;
        if (payoutCalls === 2) throw new Error("the platform dropped the connection");
        return fake.createPayout(input);
      },
    };
    const s = await setup("unrequested_extra", "full", fake as FakePaymentAdapter);
    await enforceReview(s.runId, s.options);
    // Escalated: the person approves, and the second payout fails.
    const options = { ...s.options, payments: flaky };
    await expect(decideEscalation(s.runId, "approve", options)).rejects.toThrow(/dropped/);
    expect(s.calls("capture")).toHaveLength(1);
    expect(s.events().some((e) => e.type === "enforced")).toBe(false);

    const done = await enforceReview(s.runId, options);
    expect(done).toMatchObject({ status: "enforced", money: "captured", decidedBy: "person" });
    expect(s.calls("capture").filter((e) => !("error" in (e.payload as object)))).toHaveLength(1);
    const paid = s.calls("payout").filter((e) => !("error" in (e.payload as object)));
    expect(paid).toHaveLength(2);
    expect(done.payouts.map((p: Payout) => p.payeeKey).sort()).toEqual(
      paid.map((e) => resultOf<Payout>(e).payeeKey).sort(),
    );
    expect(sum(done.payouts.map((p) => p.amountCents))).toBe(done.capture?.netAmountCents);
  });
});

describe("a run with nothing to enforce", () => {
  it("has no finished review", async () => {
    run = await runGate2Case(findGate2Case("honest"));
    await expect(
      enforceReview(run.runId, { log: run.log, payments: createFakePaymentAdapter() }),
    ).rejects.toThrow(/no finished review/);
  });
});
