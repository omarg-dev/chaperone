import type { RunEvent } from "../api";
import type { GateState } from "../design";

// Where a run ended up, read from its events: the review's verdict, or the person's decision when
// an escalated run was decided. Pure, so it's tested without a server.
export type RunOutcome =
  | { kind: "verdict"; verdict: "approve" | "escalate" | "block"; decidedByPerson: boolean }
  // The firewall was off: nobody reviewed the cart.
  | { kind: "off" }
  // A gate broke, nothing was enforced and the order stays held.
  | { kind: "held" }
  // No review has run on this run (yet).
  | { kind: "none" };

const isVerdict = (value: unknown): value is "approve" | "escalate" | "block" =>
  value === "approve" || value === "escalate" || value === "block";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export function outcomeOf(events: readonly RunEvent[]): RunOutcome {
  let outcome: RunOutcome = { kind: "none" };
  let decision: "approve" | "block" | undefined;
  for (const event of events) {
    if (event.lane === "review" && event.type === "review_finished") {
      const verdict = record(event.payload).verdict;
      outcome = isVerdict(verdict)
        ? { kind: "verdict", verdict, decidedByPerson: false }
        : { kind: "off" };
    } else if (event.lane === "review" && event.type === "review_failed") {
      outcome = { kind: "held" };
    } else if (event.lane === "human" && event.type === "human_decision") {
      const answer = record(event.payload).decision;
      if (answer === "approve" || answer === "block") decision = answer;
    }
  }
  if (outcome.kind === "verdict" && outcome.verdict === "escalate" && decision) {
    return { kind: "verdict", verdict: decision, decidedByPerson: true };
  }
  return outcome;
}

// A run's escalation is open until a person has decided it.
export const isOpenEscalation = (outcome: RunOutcome | undefined) =>
  outcome?.kind === "verdict" && outcome.verdict === "escalate" && !outcome.decidedByPerson;

export function pillStateOf(outcome: RunOutcome): GateState | null {
  if (outcome.kind === "held") return "held";
  if (outcome.kind !== "verdict") return null;
  return outcome.verdict === "block" ? "block" : outcome.verdict;
}
