import type { RunSummary } from "../api";
import type { GateState } from "../design";

// A run's escalation is held for the person until they decide it: the verdict is still "escalate".
export const isHeldForPerson = (run: RunSummary) =>
  run.verdict === "escalate" && run.decidedBy === "review";

// The pill for a run's state, or null when there is no verdict to show. Money that reached an
// attacker comes first, as it does in the run view: however the run got there, that is the state.
export function pillStateOf(run: RunSummary): GateState | null {
  if (run.attackerPaid) return "attacker";
  if (run.reviewFailed) return "held";
  return run.verdict;
}

// How a run ended, in the six ways the history can be filtered by, and one for a run that hasn't
// been reviewed. Each run is exactly one, in the run view's order of precedence.
export const OUTCOMES = [
  "approved",
  "blocked",
  "held",
  "attacker_paid",
  "firewall_off",
  "review_failed",
  "not_reviewed",
] as const;
export type RunOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<RunOutcome, string> = {
  approved: "Approved",
  blocked: "Blocked",
  held: "Held for a person",
  attacker_paid: "Paid attacker",
  firewall_off: "Firewall off",
  review_failed: "Review failed",
  not_reviewed: "Not reviewed yet",
};

export function outcomeOf(run: RunSummary): RunOutcome {
  if (run.attackerPaid) return "attacker_paid";
  if (run.reviewFailed) return "review_failed";
  if (isHeldForPerson(run)) return "held";
  if (run.decidedBy === "no_review") return "firewall_off";
  if (run.verdict === "approve") return "approved";
  if (run.verdict === "block") return "blocked";
  return "not_reviewed";
}

// The firewall configurations a review can run under, as the log names them.
export const CONFIGS = ["off", "gate0", "full"] as const;
export type Config = (typeof CONFIGS)[number];

export const CONFIG_LABELS: Record<Config, string> = {
  off: "Off",
  gate0: "Gate 0 only",
  full: "Full",
};

export const configLabel = (config: string) =>
  config in CONFIG_LABELS ? CONFIG_LABELS[config as Config] : config;

// The configuration the run's outcome comes from: the last review it went through.
export const configOf = (run: RunSummary): string | null => run.reviews.at(-1) ?? null;

// What to say in the verdict column when there is no pill.
export function noVerdictText(run: RunSummary): string {
  return run.decidedBy === "no_review" ? "Firewall off" : "No review yet";
}
