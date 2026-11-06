// The daily cap on live runs, as pure functions over the run list. The log is the only record of
// what was spent: every model call's cost is on its event, a run's cost is the sum of its events
// (`RunSummary.costUsd`), and a run started from the web app says so in its `run_started`
// (`origin: "web"`). So the day's spend is those runs' costs, for the runs started on the current
// UTC day, and nothing is kept in memory that a restart could lose.
//
// A run is counted on the day it started, whatever time it finishes, and its mandate's draft counts
// with it: asking for a mandate is a model call too.

export interface SpendRow {
  startedAt: string;
  costUsd: number;
  origin: string | null;
}

// What the review's model gates and the rest of a run may cost after the agent stops, which the
// agent's own spend cap doesn't cover: about a fifth of a cent for the gates (docs/PLAN.md,
// "Cost"), so a cent is a generous allowance. A run starts only with this much to spare, and the
// agent's cap is what is left beyond it, so a day's spend can't pass the cap by a review.
export const REVIEW_RESERVE_USD = 0.01;

export interface Budget {
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  // What the agent may spend in a run that starts now: what is left, less the review's allowance.
  // Zero means the day's budget is used up, even if a few thousandths remain.
  agentRoomUsd: number;
  exhausted: boolean;
  // The next UTC midnight, when today's spend starts again from nothing.
  resetsAt: string;
}

export const utcDayStart = (now: Date): number =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

const DAY_MS = 24 * 60 * 60 * 1000;

// Money in whole micro-dollars, so a day of sums doesn't drift.
const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

export function budgetAt(capUsd: number, runs: readonly SpendRow[], now: Date): Budget {
  const from = utcDayStart(now);
  const spentUsd = round(
    runs
      .filter((run) => {
        const at = Date.parse(run.startedAt);
        return run.origin === "web" && at >= from && at < from + DAY_MS;
      })
      .reduce((sum, run) => sum + run.costUsd, 0),
  );
  const remainingUsd = Math.max(0, round(capUsd - spentUsd));
  const agentRoomUsd = Math.max(0, round(remainingUsd - REVIEW_RESERVE_USD));
  return {
    capUsd,
    spentUsd,
    remainingUsd,
    agentRoomUsd,
    exhausted: agentRoomUsd <= 0,
    resetsAt: new Date(from + DAY_MS).toISOString(),
  };
}

// The cap is reached when a run could no longer be paid for: nothing is left, or no more than a
// review's allowance.
export const isSpent = (budget: Budget): boolean => budget.exhausted;
