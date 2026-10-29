import type { RunOutcome } from "./types.js";

// Where a run stands, read from the events the review and the person write. Pure, so the run list
// and its tests share one rule.
//
//  - review_finished (lane review): the review's verdict, or null when the firewall was off;
//  - review_failed (lane review): a gate broke, nothing was enforced and the order stays held;
//  - human_decision (lane human): a person's decision on an escalation, "approve" or "reject".
//
// The latest review event wins. A person's decision settles an escalation and nothing else, and
// reads as approve or block, so an escalation is held for the person exactly while its verdict is
// still "escalate". The `enforced` event adds nothing here: it only carries out these.
export interface OutcomeEvent {
  lane: string;
  type: string;
  payload: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export const NO_OUTCOME: RunOutcome = { verdict: null, decidedBy: null, reviewFailed: false };

export function outcomeOf(events: readonly OutcomeEvent[]): RunOutcome {
  let outcome: RunOutcome = NO_OUTCOME;
  let decision: unknown;
  for (const event of events) {
    if (event.lane === "review" && event.type === "review_finished") {
      const verdict = record(event.payload).verdict;
      outcome =
        verdict === "approve" || verdict === "escalate" || verdict === "block"
          ? { verdict, decidedBy: "review", reviewFailed: false }
          : { verdict: null, decidedBy: "no_review", reviewFailed: false };
    } else if (event.lane === "review" && event.type === "review_failed") {
      outcome = { verdict: null, decidedBy: null, reviewFailed: true };
    } else if (event.lane === "human" && event.type === "human_decision") {
      decision = record(event.payload).decision;
    }
  }
  if (outcome.verdict === "escalate" && (decision === "approve" || decision === "reject")) {
    return {
      verdict: decision === "approve" ? "approve" : "block",
      decidedBy: "person",
      reviewFailed: false,
    };
  }
  return outcome;
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
