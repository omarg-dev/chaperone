import { needsPerson } from "@firewall/events/outcome";
import type { RunSummary } from "../api";
import type { MoneyState } from "../design";
import { SETTING_WORDS, settingWords } from "../words/plain";

// A run is held for a person while its escalation needs one: nobody has decided and the platform's
// hold is open (waiting), or a person decided and the hold is still open (unfinished). It follows
// the money, not the verdict: an escalation whose hold was released without a decision is not held.
// The rule is `needsPerson` in @firewall/events, the same one the run view's model uses.
export const isHeldForPerson = (run: RunSummary) => needsPerson(run.escalation);

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
  held: "Waiting on you",
  released: "Hold released",
  attacker_paid: "Paid attacker",
  firewall_off: "Chaperone off",
  review_failed: "Check failed",
  not_reviewed: "Not checked yet",
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

// In the words Start a run offers them in: Full check, Rules only, Off.
export const CONFIG_LABELS: Record<Config, string> = SETTING_WORDS;

export const configLabel = settingWords;

// The configuration the run's outcome comes from: the last review it went through.
export const configOf = (run: RunSummary): string | null => run.reviews.at(-1) ?? null;

// What the outcome says under itself: who decided it, when that is worth saying. A review's own
// verdict says nothing more here, since the run view has the gates.
export function outcomeNote(run: RunSummary): string | null {
  if (run.escalation === "unfinished") return "Decision not finished";
  if (run.escalation === "released") return "Nobody decided";
  if (run.decidedBy === "person")
    return run.verdict === "block" ? "You rejected it" : "You decided";
  if (run.decidedBy === "no_review") return "Paid with no check";
  if (run.reviewFailed) return "A check broke";
  return null;
}

// Which money a run moved, said quietly beside it: the fake is practice money.
export const PAYMENTS_LABELS = { fake: "Practice money", sandbox: "Sandbox" } as const;
export const paymentsLabel = (payments: RunSummary["payments"]): string | null =>
  payments ? PAYMENTS_LABELS[payments] : null;

// The order the verdict column sorts in: what needs a person's eye first, so an ascending sort opens
// on the money that reached an attacker and then on what is waiting for a decision.
const OUTCOME_RANK: Record<RunOutcome, number> = {
  attacker_paid: 0,
  held: 1,
  review_failed: 2,
  released: 3,
  blocked: 4,
  approved: 5,
  firewall_off: 6,
  not_reviewed: 7,
};
export const outcomeRank = (run: RunSummary): number => OUTCOME_RANK[outcomeOf(run)];

// The money-state glyph for each outcome: the run's state drawn on the bracket. A broken review leaves
// the order held, so it is the held glyph; a run nobody has reviewed yet is the dashed one.
export const MONEY_OF_OUTCOME: Record<RunOutcome, MoneyState> = {
  approved: "captured",
  blocked: "voided",
  held: "person",
  released: "released",
  attacker_paid: "attacker",
  firewall_off: "off",
  review_failed: "held",
  not_reviewed: "none",
};

export const moneyStateOf = (run: RunSummary): MoneyState => MONEY_OF_OUTCOME[outcomeOf(run)];

// The order the outcome chips are drawn in: what needs an eye first, then how the rest ended.
export const OUTCOME_CHIP_ORDER: readonly RunOutcome[] = [
  "held",
  "attacker_paid",
  "review_failed",
  "blocked",
  "approved",
  "released",
  "firewall_off",
  "not_reviewed",
];
