import { needsPerson } from "@firewall/events/outcome";
import type { RunSummary } from "../api";
import type { AmountTone } from "../design";

// Where a run's money is, said once. A run's money is in exactly one place: held (the platform's hold
// is open, so nothing has moved), moved (captured and paid out) or voided (the hold was closed and
// nobody was paid). The Runs grid has a column for each place and writes the run's amount in the one
// that applies, so an amount is never written twice. It follows the money, not the verdict: a hold
// that was released with no decision is voided money, whatever the review said.
export type MoneyPlace = "held" | "moved" | "voided";

export interface PlacedMoney {
  place: MoneyPlace;
  cents: number;
  // Struck through when nobody got it, red when an attacker did.
  tone: AmountTone;
  // The small line under the amount: "waiting on you", "to Larkspur Goods", "voided".
  note: string;
  // Held for a person is amber, money that reached an attacker is red; the rest is quiet.
  noteTone: "plain" | "escalate" | "attacker";
}

// Null for a run that has had no money: the agent hasn't checked out, so there is no hold.
export function placeOf(run: RunSummary): PlacedMoney | null {
  const cents = run.heldCents;
  if (cents === null) return null;
  const held = (note: string, noteTone: PlacedMoney["noteTone"] = "plain"): PlacedMoney => ({
    place: "held",
    cents,
    tone: "plain",
    note,
    noteTone,
  });

  // A hold waiting on a person (or a decision that didn't finish) is held, whatever else is true.
  if (needsPerson(run.escalation)) {
    return held(
      run.escalation === "unfinished" ? "decision not finished" : "waiting on you",
      "escalate",
    );
  }
  // A gate broke: nothing was enforced and the order stays held.
  if (run.reviewFailed) return held("review failed");

  if (run.attackerPaid) {
    return {
      place: "moved",
      cents,
      tone: "attacker",
      note: run.paidTo.length > 0 ? `to ${run.paidTo.join(", ")}` : "to an attacker",
      noteTone: "attacker",
    };
  }
  if (run.paidTo.length > 0) {
    return {
      place: "moved",
      cents,
      tone: "plain",
      note: `to ${run.paidTo.join(", ")}`,
      noteTone: "plain",
    };
  }
  if (run.holdOpen) return held(run.verdict === null ? "not reviewed yet" : "not settled yet");

  // The hold is closed and nobody was paid: it was voided or released, unless it was captured and
  // the payouts aren't in the log yet.
  if (run.verdict === "block" || run.escalation === "released") {
    return {
      place: "voided",
      cents,
      tone: "voided",
      note: run.escalation === "released" ? "released" : "voided",
      noteTone: "plain",
    };
  }
  return { place: "moved", cents, tone: "plain", note: "captured", noteTone: "plain" };
}

// What is held right now across the runs: the sum of every hold still open, and how many runs a
// person has to decide. The first is money, the second is the person's work, and they differ when a
// broken review leaves a hold that nobody can decide.
export function heldRightNow(runs: readonly RunSummary[]): {
  cents: number;
  holds: number;
  waiting: number;
  // The oldest a waiting run has been held since, as the time of its last event.
  oldestWaitingAt: string | null;
} {
  let cents = 0;
  let holds = 0;
  let waiting = 0;
  let oldest: string | null = null;
  for (const run of runs) {
    const placed = placeOf(run);
    if (placed?.place === "held") {
      cents += placed.cents;
      holds += 1;
    }
    if (needsPerson(run.escalation)) {
      waiting += 1;
      if (oldest === null || Date.parse(run.lastEventAt) < Date.parse(oldest)) {
        oldest = run.lastEventAt;
      }
    }
  }
  return { cents, holds, waiting, oldestWaitingAt: oldest };
}

// The cents a run has in one money column, or null when its money is somewhere else (or it has none
// yet). A group row adds these up, so a scenario's row says how much of its money is in each place.
export function moneyIn(run: RunSummary, place: MoneyPlace): number | null {
  const placed = placeOf(run);
  return placed?.place === place ? placed.cents : null;
}

export interface MoneyTotal {
  cents: number;
  runs: number;
}

// Where the money of a set of runs is, in four: held right now (a hold that is open), moved to
// sellers, paid to attackers (the red one: moved to a seller the scenario says is an attacker), and
// voided (the hold was closed and nobody was paid). Every run with money is in exactly one, since
// `placeOf` puts it in exactly one place, so the four add up to the money of all of them. The Runs
// page's status bar says these for the runs the filters leave.
export interface MoneyTotals {
  held: MoneyTotal;
  moved: MoneyTotal;
  attacker: MoneyTotal;
  voided: MoneyTotal;
}

export function moneyTotals(runs: readonly RunSummary[]): MoneyTotals {
  const totals: MoneyTotals = {
    held: { cents: 0, runs: 0 },
    moved: { cents: 0, runs: 0 },
    attacker: { cents: 0, runs: 0 },
    voided: { cents: 0, runs: 0 },
  };
  for (const run of runs) {
    const placed = placeOf(run);
    if (!placed) continue;
    const total =
      placed.place === "moved" && placed.tone === "attacker"
        ? totals.attacker
        : totals[placed.place];
    total.cents += placed.cents;
    total.runs += 1;
  }
  return totals;
}
