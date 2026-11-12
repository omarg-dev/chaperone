import { type Event, type EventLog, holdStateOf, isHoldOpen } from "@firewall/events";
import {
  type Authorization,
  type Capture,
  type CreateOrderInput,
  type LineItemInput,
  type PaymentAdapter,
  type Payout,
  recordPayments,
  splitPayouts,
} from "@firewall/payments";

// Enforcement: what the platform does with the held order once the review has spoken. It acts
// through the run's payment adapter wrapped in recordPayments, so every call is on the payments
// lane, and it points each call at the event that caused it.
//
//  - approve: capture the hold, then split what the platform received (the capture's net amount)
//    over the sellers with `splitPayouts` and pay each one;
//  - block: void the hold, so nothing is captured and no seller is paid;
//  - escalate: leave the order held and write `escalated`, so a person decides. Their decision is a
//    human_decision event (lane human, provenance user) pointing at the review's verdict, and the
//    same code then captures and pays out (approve) or voids (reject);
//  - no firewall (the `off` configuration): capture and pay out as it stands.
//
// Events: `escalated` and `enforced` on the review lane (system), each naming the review's verdict
// event in its payload. The payment calls point at the verdict event, or, after a person decided,
// at their decision, which points at the verdict.
//
// Enforcement is idempotent per run: it works from the event log, so running it again after it
// finished writes nothing and calls nothing, and running it again after a crash halfway (captured
// but not all paid) does only what's left. Within one process, two calls at once share one run.
//
// A hold's honour period is three days. A person who takes longer than that finds the hold past it,
// so approving reauthorizes it first (one fresh hold for the same amount, which the platform allows
// once) and captures that. A hold past its expiry can't be captured at all, and the call says so.

export type EnforcedAction = "capture" | "void";

export interface Enforcement {
  // enforced: this call did it. already_enforced: an earlier call had; nothing was done now.
  // awaiting_person: the order is held and a person has to decide.
  status: "enforced" | "already_enforced" | "awaiting_person";
  // What the money did: captured and paid out, voided, or still held.
  money: "captured" | "voided" | "held";
  // Who decided it: the review, a person (after an escalation) or nobody (no firewall).
  decidedBy: "review" | "person" | "no_review";
  verdictEventId: string;
  // The `enforced` or `escalated` event.
  eventId: string;
  authorizationId: string;
  capture: Capture | null;
  payouts: Payout[];
  // Set while awaiting a person: when the platform stops honouring a capture without reauthorizing.
  honorUntil: string | null;
}

export class EnforcementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnforcementError";
  }
}

export interface EnforceOptions {
  log: EventLog;
  // The raw adapter: enforcement wraps it in recordPayments itself.
  payments: PaymentAdapter;
  now?: () => Date;
}

type Record_ = Record<string, unknown>;
const record = (value: unknown): Record_ =>
  value && typeof value === "object" ? (value as Record_) : {};

interface Call {
  operation: string;
  input: unknown[];
  result: unknown;
}

// The run's payment calls that went through, in order.
const succeededCalls = (events: readonly Event[]): Call[] =>
  events.flatMap((e) => {
    const p = record(e.payload);
    if (e.lane !== "payments" || e.type !== "payment_call" || "error" in p || !("result" in p)) {
      return [];
    }
    return [
      { operation: String(p.operation), input: (p.input as unknown[]) ?? [], result: p.result },
    ];
  });

interface Hold {
  authorizationId: string;
  honorUntil: string;
  items: LineItemInput[];
}

// The order and the hold the agent's checkout left, from the payments lane: the lines as they were
// sent, and the latest hold (a reauthorization replaces the one it came from).
function holdOf(calls: readonly Call[]): Hold {
  const created = calls.find((c) => c.operation === "create_order");
  const items = (created?.input[0] as CreateOrderInput | undefined)?.purchaseUnits[0]?.items;
  const holds = calls.filter(
    (c) => c.operation === "authorize_order" || c.operation === "reauthorize",
  );
  const latest = holds.at(-1)?.result as Authorization | undefined;
  if (!items || !latest)
    throw new EnforcementError("This run has no money on hold, so there is nothing to act on");
  return { authorizationId: latest.authorizationId, honorUntil: latest.honorUntil, items };
}

// Why a hold can't be charged, for the person deciding: the platform's status in plain words.
const HOLD_ENDED: Partial<Record<string, string>> = {
  CAPTURED: "The money for this order was already charged",
  VOIDED: "The hold on this order was already released",
  EXPIRED: "The hold on this order has expired",
  DENIED: "The payment platform declined the hold on this order",
};

const reviewOf = (events: readonly Event[]): Event => {
  const finished = events.findLast((e) => e.lane === "review" && e.type === "review_finished");
  if (!finished) throw new EnforcementError("Chaperone hasn't finished checking this run yet");
  return finished;
};

const onReviewLane = (events: readonly Event[], type: string, verdictEventId: string) =>
  events.find(
    (e) =>
      e.lane === "review" && e.type === type && record(e.payload).verdictEventId === verdictEventId,
  );

const decisionOf = (events: readonly Event[], verdictEventId: string) =>
  events.find(
    (e) =>
      e.lane === "human" &&
      e.type === "human_decision" &&
      record(e.payload).verdictEventId === verdictEventId,
  );

function summaryOf(event: Event, status: Enforcement["status"]): Enforcement {
  const p = record(event.payload);
  return {
    status,
    money: p.money as Enforcement["money"],
    decidedBy: p.decidedBy as Enforcement["decidedBy"],
    verdictEventId: String(p.verdictEventId),
    eventId: event.eventId,
    authorizationId: String(p.authorizationId),
    capture: (p.capture as Capture | null) ?? null,
    payouts: (p.payouts as Payout[]) ?? [],
    honorUntil: (p.honorUntil as string | null) ?? null,
  };
}

// Runs one enforcement at a time per run, in this process.
const inFlight = new Map<string, Promise<Enforcement>>();
function once(runId: string, work: () => Promise<Enforcement>): Promise<Enforcement> {
  const running = inFlight.get(runId);
  if (running) return running;
  const started = work().finally(() => inFlight.delete(runId));
  inFlight.set(runId, started);
  return started;
}

// What the review's verdict calls for. Everything but an escalation is settled by the review.
export function enforceReview(runId: string, options: EnforceOptions): Promise<Enforcement> {
  return once(runId, async () => {
    const events = options.log.listRun(runId);
    const review = reviewOf(events);
    const verdict = record(review.payload).verdict as "approve" | "escalate" | "block" | null;
    const finished = onReviewLane(events, "enforced", review.eventId);
    if (finished) return summaryOf(finished, "already_enforced");

    if (verdict === "escalate") {
      // A person's decision that was made but not carried out (a crash) is carried out now.
      const decision = decisionOf(events, review.eventId);
      if (decision) {
        const approved = record(decision.payload).decision === "approve";
        return carryOut(runId, options, review, approved ? "capture" : "void", decision);
      }
      return hold(runId, options, review, events);
    }
    return carryOut(runId, options, review, verdict === "block" ? "void" : "capture", null);
  });
}

// The person's decision on an escalated run: approve captures and pays out, reject voids. It's
// written to the human lane first, then carried out by the same code as any other enforcement. If
// the platform refuses, the decision stays written and the hold stays open, which the run list
// reads as an unfinished decision (`escalationOf`): sending the same decision again finishes it,
// and the opposite one is refused. A hold already closed with no decision is refused up front.
export function decideEscalation(
  runId: string,
  decision: "approve" | "reject",
  options: EnforceOptions & { note?: string },
): Promise<Enforcement> {
  return once(runId, async () => {
    const events = options.log.listRun(runId);
    const review = reviewOf(events);
    const verdict = record(review.payload).verdict;
    if (verdict !== "escalate") {
      throw new EnforcementError(
        "Chaperone didn't send this run to you, so there is nothing for you to decide",
      );
    }
    const earlier = decisionOf(events, review.eventId);
    if (earlier && record(earlier.payload).decision !== decision) {
      throw new EnforcementError(
        record(earlier.payload).decision === "approve"
          ? "This run was already decided: it was approved and the seller paid"
          : "This run was already decided: it was rejected and the hold released",
      );
    }
    // A hold that was closed with nobody deciding (the eval voids the hold of every escalated cell)
    // has nothing left to decide. Refusing here, before the decision is written, keeps a person's
    // decision from being recorded for money that can't move.
    if (!earlier && !isHoldOpen(holdStateOf(events))) {
      throw new EnforcementError(
        holdStateOf(events).authorizationId === null
          ? "This run has no money on hold, so there is nothing to decide"
          : "The hold on this order was already released without a decision, so there is nothing to decide",
      );
    }
    const person =
      earlier ??
      options.log.append({
        runId,
        scenarioId: review.scenarioId,
        lane: "human",
        type: "human_decision",
        provenance: "user",
        parentId: review.eventId,
        payload: {
          decision,
          verdictEventId: review.eventId,
          escalatedEventId: onReviewLane(events, "escalated", review.eventId)?.eventId ?? null,
          ...(options.note && { note: options.note }),
        },
      });
    const finished = onReviewLane(events, "enforced", review.eventId);
    if (finished) return summaryOf(finished, "already_enforced");
    return carryOut(runId, options, review, decision === "approve" ? "capture" : "void", person);
  });
}

// Leaves the order held and records that a person has to decide.
async function hold(
  runId: string,
  options: EnforceOptions,
  review: Event,
  events: readonly Event[],
): Promise<Enforcement> {
  const { authorizationId, honorUntil } = holdOf(succeededCalls(events));
  const earlier = onReviewLane(events, "escalated", review.eventId);
  const event =
    earlier ??
    options.log.append({
      runId,
      scenarioId: review.scenarioId,
      lane: "review",
      type: "escalated",
      provenance: "system",
      parentId: review.eventId,
      payload: {
        verdictEventId: review.eventId,
        money: "held",
        decidedBy: "review",
        authorizationId,
        honorUntil,
        // For the person: what the gates said, written by their code.
        gates: record(review.payload).gates ?? [],
        awaiting: "person",
      },
    });
  return summaryOf(event, "awaiting_person");
}

async function carryOut(
  runId: string,
  options: EnforceOptions,
  review: Event,
  action: EnforcedAction,
  decision: Event | null,
): Promise<Enforcement> {
  const { log } = options;
  const now = options.now ?? (() => new Date());
  const cause = decision ?? review;
  const payments = recordPayments(options.payments, log, () => ({
    runId,
    scenarioId: review.scenarioId,
    parentId: cause.eventId,
  }));
  const calls = succeededCalls(log.listRun(runId));
  const order = holdOf(calls);
  let { authorizationId } = order;
  const decidedBy: Enforcement["decidedBy"] = decision
    ? "person"
    : record(review.payload).verdict === null
      ? "no_review"
      : "review";

  let capture: Capture | null = null;
  const payouts: Payout[] = [];

  if (action === "void") {
    const hold = await payments.getAuthorization(authorizationId);
    if (hold.status === "CAPTURED") {
      throw new EnforcementError(
        "The money for this order was already charged, so the hold can't be released",
      );
    }
    if (hold.status === "CREATED") await payments.voidAuthorization(authorizationId);
  } else {
    const captured = calls.find(
      (c) => c.operation === "capture" && (c.result as Capture).authorizationId === authorizationId,
    );
    if (captured) {
      capture = captured.result as Capture;
    } else {
      let hold = await payments.getAuthorization(authorizationId);
      if (hold.status !== "CREATED") {
        throw new EnforcementError(
          `${HOLD_ENDED[hold.status] ?? "The hold on this order is no longer open"}, so it can't be captured`,
        );
      }
      // A person who took longer than the honour period: a fresh hold for the same amount first.
      if (now() >= new Date(hold.honorUntil)) {
        hold = await payments.reauthorize(authorizationId);
        authorizationId = hold.authorizationId;
      }
      capture = await payments.captureAuthorization(authorizationId);
    }
    if (capture.status !== "COMPLETED" || capture.netAmountCents === null) {
      throw new EnforcementError(
        "The payment platform hasn't finished the charge yet, so the seller can't be paid. Try again in a minute",
      );
    }
    // A seller already paid from this capture (a run that stopped halfway) isn't paid again.
    const paid = new Map(
      calls
        .filter((c) => c.operation === "payout")
        .map((c) => c.result as Payout)
        .filter((p) => p.captureId === capture?.captureId)
        .map((p) => [p.payeeKey, p]),
    );
    for (const share of splitPayouts(capture.netAmountCents, order.items)) {
      const earlier = paid.get(share.payeeKey);
      payouts.push(
        earlier ??
          (await payments.createPayout({
            captureId: capture.captureId,
            payeeKey: share.payeeKey,
            amountCents: share.amountCents,
          })),
      );
    }
  }

  const event = log.append({
    runId,
    scenarioId: review.scenarioId,
    lane: "review",
    type: "enforced",
    provenance: "system",
    parentId: cause.eventId,
    payload: {
      verdictEventId: review.eventId,
      humanDecisionEventId: decision?.eventId ?? null,
      action,
      money: action === "capture" ? "captured" : "voided",
      decidedBy,
      authorizationId,
      capture,
      payouts,
      honorUntil: null,
    },
  });
  return summaryOf(event, "enforced");
}
