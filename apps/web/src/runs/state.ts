import type { RunSummary } from "../api";
import type { GateState } from "../design";

// A run's escalation is held for the person until they decide it: the verdict is still "escalate".
export const isHeldForPerson = (run: RunSummary) =>
  run.verdict === "escalate" && run.decidedBy === "review";

// The pill for a run's state, or null when there is no verdict to show.
export function pillStateOf(run: RunSummary): GateState | null {
  if (run.reviewFailed) return "held";
  return run.verdict;
}

// What to say in the verdict column when there is no pill.
export function noVerdictText(run: RunSummary): string {
  return run.decidedBy === "no_review" ? "Firewall off" : "No review yet";
}
