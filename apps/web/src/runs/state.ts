import { needsPerson } from "@firewall/events/outcome";
import type { RunSummary } from "../api";
import type { GateState } from "../design";

// A run is held for a person while its escalation needs one: nobody has decided and the platform's
// hold is open (waiting), or a person decided and the hold is still open (unfinished). It follows
// the money, not the verdict: an escalation whose hold was released without a decision is not held.
// The rule is `needsPerson` in @firewall/events, the same one the run view's model uses.
export const isHeldForPerson = (run: RunSummary) => needsPerson(run.escalation);

// The pill for a run's state, or null when there is no verdict to show. Money that reached an
// attacker comes first, as it does in the run view: however the run got there, that is the state.
// A released hold has no verdict to show (the review escalated and nobody decided), and an
// unfinished decision is still the person's to carry out, whatever they chose.
export function pillStateOf(run: RunSummary): GateState | null {
  if (run.attackerPaid) return "attacker";
  if (run.reviewFailed) return "held";
  if (run.escalation === "released") return null;
  if (run.escalation === "unfinished") return "escalate";
  return run.verdict;
}

// How a run ended, in the ways the history can be filtered by, and one for a run that hasn't been
// reviewed. Each run is exactly one, in the run view's order of precedence.
export const OUTCOMES = [
  "approved",
  "blocked",
  "held",
  "released",
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
  released: "Hold released",
  attacker_paid: "Paid attacker",
  firewall_off: "Firewall off",
  review_failed: "Review failed",
  not_reviewed: "Not reviewed yet",
};

export function outcomeOf(run: RunSummary): RunOutcome {
  if (run.attackerPaid) return "attacker_paid";
  if (run.reviewFailed) return "review_failed";
  if (isHeldForPerson(run)) return "held";
  if (run.escalation === "released") return "released";
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
  if (run.escalation === "released") return "Hold released";
  return run.decidedBy === "no_review" ? "Firewall off" : "No review yet";
}

// Which money a run moved, said quietly beside it: the fake is practice money.
export const PAYMENTS_LABELS = { fake: "Practice money", sandbox: "Sandbox" } as const;
export const paymentsLabel = (payments: RunSummary["payments"]): string | null =>
  payments ? PAYMENTS_LABELS[payments] : null;
