import type { SpendRow } from "@firewall/events";
import { costUsd, HAIKU_5_5_PRICING } from "@firewall/mandate";
import { utcDayStart } from "../live/budget.js";
import { MAX_OUTPUT_TOKENS } from "./translate.js";

// The daily cap on the dashboard assistant (AG Studio's AI), as pure functions over the model spend
// ledger (`model_spend`, written by the event log). Every call is reserved at the most it could
// cost before it is sent and settled at what it did cost once it answers, so the day's spend is the
// settled costs plus every reservation not yet settled: a call in flight counts at its worst, and
// one a crash cut off stays counted at its worst rather than being forgotten.
//
// A call is let through only when the day's spend plus its own worst case stays within the cap, so
// the cap can't be passed, however many people ask at once (the check and the reservation are one
// synchronous step in the service).

export const STUDIO_PURPOSE = "studio_ai";

const DAY_MS = 24 * 60 * 60 * 1000;

// Money in whole micro-dollars, so a day of sums doesn't drift.
const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

// The most a call can cost once the API has counted its input: every input token at the input rate
// (no cache discount assumed) and the full output cap at the output rate. The input stays below the
// long-context threshold (`MAX_INPUT_TOKENS`), so the base rate card is the one that applies.
export const worstCaseUsd = (inputTokens: number): number =>
  round(
    costUsd(HAIKU_5_5_PRICING, {
      inputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: MAX_OUTPUT_TOKENS,
    }),
  );

// The day's spend from the ledger's rows: what settled calls cost, and what unsettled ones might.
export function spentOf(rows: readonly SpendRow[]): number {
  const settled = new Map<string, number>();
  const reserved = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === "settle") settled.set(row.callId, row.costUsd);
    else reserved.set(row.callId, row.costUsd);
  }
  let total = 0;
  for (const cost of settled.values()) total += cost;
  for (const [callId, cost] of reserved) if (!settled.has(callId)) total += cost;
  return round(total);
}

export interface StudioBudget {
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  // The next UTC midnight, when the day's spend starts again from nothing.
  resetsAt: string;
}

// The rows a day's budget is counted from: those written since the UTC day began.
export const dayStartOf = (now: Date): string => new Date(utcDayStart(now)).toISOString();

export function studioBudgetAt(capUsd: number, rows: readonly SpendRow[], now: Date): StudioBudget {
  const from = utcDayStart(now);
  const today = rows.filter((row) => {
    const at = Date.parse(row.ts);
    return at >= from && at < from + DAY_MS;
  });
  const spentUsd = spentOf(today);
  return {
    capUsd,
    spentUsd,
    remainingUsd: Math.max(0, round(capUsd - spentUsd)),
    resetsAt: new Date(from + DAY_MS).toISOString(),
  };
}

// Whether a call whose worst case is `worstUsd` fits in what is left today.
export const fits = (budget: StudioBudget, worstUsd: number): boolean =>
  round(budget.spentUsd + worstUsd) <= budget.capUsd;

// Whether the day is spent: not even the smallest call (a near-empty prompt and the full output
// cap) would fit.
export const isStudioSpent = (budget: StudioBudget): boolean => !fits(budget, worstCaseUsd(0));
