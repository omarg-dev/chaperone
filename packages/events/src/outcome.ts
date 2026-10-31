import type { RunOutcome } from "./types.js";

// Where a run stands, read from the events the review, the payments and the person write. Pure, so
// the run list, the run view and their tests share one rule.
//
//  - review_finished (lane review): the review's verdict, or null when the firewall was off;
//  - review_failed (lane review): a gate broke, nothing was enforced and the order stays held;
//  - human_decision (lane human): a person's decision on an escalation, "approve" or "reject";
//  - payment_call (lane payments): the platform's calls, which say whether the hold is still open.
//
// The latest review event wins. A person's decision settles an escalation and nothing else, and
// reads as approve or block. Whether an escalation still needs a person follows the money, not the
// decision: it needs one while the platform's hold is open (see `escalationOf`).
export interface OutcomeEvent {
  lane: string;
  type: string;
  payload: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

// The order's authorization and what became of it, from the payments lane. The hold is the latest
// authorization (a reauthorization replaces the one it came from); it is closed once a capture or a
// void of it has gone through, and a call the platform refused closes nothing. Pure.
export interface HoldState {
  // The latest authorization, or null when the order was never authorized.
  authorizationId: string | null;
  // How it was closed, or null while it is still held.
  closedBy: "capture" | "void" | null;
}

// The payment calls `holdStateOf` reads, so a caller that fetches events can fetch only these.
export const HOLD_OPERATIONS = ["authorize_order", "reauthorize", "capture", "void"] as const;

export function holdStateOf(events: readonly OutcomeEvent[]): HoldState {
  let authorizationId: string | null = null;
  let closedBy: HoldState["closedBy"] = null;
  for (const event of events) {
    if (event.lane !== "payments" || event.type !== "payment_call") continue;
    const call = record(event.payload);
    if ("error" in call || !("result" in call)) continue;
    const input = Array.isArray(call.input) ? call.input : [];
    if (call.operation === "authorize_order" || call.operation === "reauthorize") {
      const id = record(call.result).authorizationId;
      if (typeof id === "string") {
        authorizationId = id;
        closedBy = null;
      }
    } else if (call.operation === "capture" || call.operation === "void") {
      const id = typeof input[0] === "string" ? input[0] : record(call.result).authorizationId;
      if (authorizationId !== null && id === authorizationId) closedBy = call.operation;
    }
  }
  return { authorizationId, closedBy };
}

export const isHoldOpen = (hold: HoldState) => hold.authorizationId !== null && !hold.closedBy;

// What an escalated run needs, from whether a person decided and whether the hold is still open:
//
//  - waiting: nobody decided and the hold is open, so a person has to;
//  - unfinished: a person decided but the hold is still open (the platform refused, or the server
//    stopped), so it still needs attention, and sending the same decision again finishes it;
//  - released: nobody decided and the hold was closed anyway (the eval voids the hold of every
//    escalated cell when it is done), so nobody is waiting;
//  - decided: a person decided and the hold is closed.
export type Escalation = "waiting" | "unfinished" | "released" | "decided";

export function escalationOf(decided: boolean, holdOpen: boolean): Escalation {
  if (decided) return holdOpen ? "unfinished" : "decided";
  return holdOpen ? "waiting" : "released";
}

// An escalation needs a person while it is waiting or unfinished.
export const needsPerson = (escalation: Escalation | null) =>
  escalation === "waiting" || escalation === "unfinished";

export const NO_OUTCOME: RunOutcome = {
  verdict: null,
  decidedBy: null,
  reviewFailed: false,
  holdOpen: false,
  escalation: null,
};

export function outcomeOf(events: readonly OutcomeEvent[]): RunOutcome {
  let outcome: RunOutcome = NO_OUTCOME;
  let decision: unknown;
  for (const event of events) {
    if (event.lane === "review" && event.type === "review_finished") {
      const verdict = record(event.payload).verdict;
      outcome =
        verdict === "approve" || verdict === "escalate" || verdict === "block"
          ? { ...NO_OUTCOME, verdict, decidedBy: "review" }
          : { ...NO_OUTCOME, decidedBy: "no_review" };
    } else if (event.lane === "review" && event.type === "review_failed") {
      outcome = { ...NO_OUTCOME, reviewFailed: true };
    } else if (event.lane === "human" && event.type === "human_decision") {
      decision = record(event.payload).decision;
    }
  }
  const holdOpen = isHoldOpen(holdStateOf(events));
  if (outcome.verdict === "escalate") {
    const decided = decision === "approve" || decision === "reject";
    const escalation = escalationOf(decided, holdOpen);
    if (decided) {
      return {
        verdict: decision === "approve" ? "approve" : "block",
        decidedBy: "person",
        reviewFailed: false,
        holdOpen,
        escalation,
      };
    }
    return { ...outcome, holdOpen, escalation };
  }
  return { ...outcome, holdOpen };
}

// More of what a run list shows, read from the same few events: the seed, the firewall
// configuration of each review the run went through (an eval run reviews one checkout under
// several), and who the money was paid out to. Pure, like `outcomeOf`.
//
//  - run_started (lane arena): the seed the scenario was built with;
//  - review_started (lane review): `config`, in the order the reviews ran, so the last is the one
//    the run's outcome comes from;
//  - enforced (lane review): `payouts`, the sellers the capture was shared out to. The last
//    `enforced` event is the run's: only payees that were paid an amount count.
export interface RunFacets {
  seed: string | null;
  reviews: string[];
  paidPayees: string[];
}

export function facetsOf(events: readonly OutcomeEvent[]): RunFacets {
  let seed: string | null = null;
  const reviews: string[] = [];
  let paidPayees: string[] = [];
  for (const event of events) {
    const body = record(event.payload);
    if (event.lane === "arena" && event.type === "run_started") {
      if (typeof body.seed === "string") seed = body.seed;
    } else if (event.lane === "review" && event.type === "review_started") {
      reviews.push(typeof body.config === "string" ? body.config : "full");
    } else if (event.lane === "review" && event.type === "enforced") {
      const payouts = Array.isArray(body.payouts) ? body.payouts : [];
      paidPayees = payouts
        .map(record)
        .filter((p) => typeof p.payeeKey === "string" && Number(p.amountCents) > 0)
        .map((p) => p.payeeKey as string);
    }
  }
  return { seed, reviews, paidPayees };
}
