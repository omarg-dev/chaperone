import type { DecisionResult, RunSummary } from "../api";
import { formatMoney } from "../design";
import { isHeldForPerson } from "../runs/state";

// What the escalation inbox lists, as the run list says it. Pure, so the rules have unit tests.

// Runs that need a person: escalated with the platform's hold still open, whether nobody has decided
// (waiting) or a person decided and the money hasn't moved yet (unfinished). A hold released with
// no decision isn't here. The same rule as the top bar's count, so the two agree.
export function waitingRuns(runs: readonly RunSummary[]): RunSummary[] {
  return runs.filter(isHeldForPerson);
}

// Oldest hold first, since it has waited longest. `heldSince` says when a hold began, from the
// run's events; the run's last event stands in until they are read (a run waiting on a person has
// written nothing since it escalated).
export function oldestFirst<T extends { run: RunSummary; heldSince: string | null }>(
  items: readonly T[],
): T[] {
  const at = (item: T) => Date.parse(item.heldSince ?? item.run.lastEventAt);
  return [...items].sort((a, b) => at(a) - at(b) || a.run.runId.localeCompare(b.run.runId));
}

// The last few runs a person decided and whose money has moved, newest first, leaving out the ones
// the page already shows another way (the confirmations from this visit). A decision that didn't
// finish is still in the list above.
export function recentlyDecided(
  runs: readonly RunSummary[],
  leaveOut: ReadonlySet<string>,
  limit = 5,
): RunSummary[] {
  return runs
    .filter((run) => run.escalation === "decided" && !leaveOut.has(run.runId))
    .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt))
    .slice(0, limit);
}

// What a person's decision came to, as one short sentence. A reject reads as a block in the run
// list, so "Rejected" is what a person decided and "Approved" what they allowed.
export const decidedLabel = (run: RunSummary) =>
  run.verdict === "approve" ? "Approved" : "Rejected";

// The confirmation after a decision, from what the server answered. No answer (null) means someone
// else had decided it first, and the run says how.
export function confirmationText(
  result: DecisionResult | null,
  amountCents: number | null,
): string {
  const amount = amountCents === null ? "the purchase" : formatMoney(amountCents);
  if (!result) return "This purchase was already decided. The run shows how it ended.";
  if (result.money === "captured") return `Approved. ${amount} was captured and the seller paid.`;
  if (result.money === "voided")
    return `Rejected. The hold on ${amount} was released and nobody was paid.`;
  return "Your decision is recorded. The money hasn't moved yet.";
}
