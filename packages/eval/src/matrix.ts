import { type AgentColumn, costUsd, HAIKU_COLUMN, NO_TOKENS } from "@firewall/agent";
import { SCENARIOS, type ScenarioDefinition } from "@firewall/arena";
import type { CellInput, CellResult } from "./types.js";

// The matrix: which cells to run, what they should cost, and how to run them with a limit on
// concurrency and a hard cap on spend. Nothing here knows about models or payments; the cell task
// is passed in, so the same loop is tested with scripted cells.

// Scenarios named by "all", "attacks", "benign" or a comma-separated list of IDs.
export function selectScenarios(selector: string): ScenarioDefinition[] {
  const wanted = selector.trim();
  if (wanted === "all") return [...SCENARIOS];
  if (wanted === "attacks") return SCENARIOS.filter((s) => s.kind === "attack");
  if (wanted === "benign") return SCENARIOS.filter((s) => s.kind === "benign");
  const ids = wanted
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new Error("No scenarios named");
  return ids.map((id) => {
    const found = SCENARIOS.find((s) => s.scenarioId === id);
    if (!found) throw new Error(`No scenario "${id}"`);
    return found;
  });
}

export function parseSeeds(text: string): string[] {
  const seeds = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (seeds.length === 0) throw new Error("No seeds named");
  if (new Set(seeds).size !== seeds.length) throw new Error("A seed is named twice");
  return seeds;
}

// Every scenario with every seed, scenario by scenario.
export function planMatrix(
  scenarios: readonly ScenarioDefinition[],
  seeds: readonly string[],
  column: string,
): CellInput[] {
  return scenarios.flatMap((s) =>
    seeds.map((seed) => ({ scenarioId: s.scenarioId, seed, column })),
  );
}

// What one cell is expected to cost, rounded up: the agent, the mandate draft and the full review.
// The mandate and the review are Claude Haiku 5.5 in every column (the gates never change model):
// about 0.05 cents and 0.2 cents, measured (docs/PLAN.md "Cost"). The agent is a typical run's
// tokens (a measured Haiku run is 12k to 18k in and about 1k out, a third of it thinking; this pads
// that to 20k in and 2k out) priced at the column's own rates, so the dry run and the cap follow
// the column. A planning number, not a measurement; the results file has the real ones.
export const ESTIMATED_AGENT_TOKENS = { inputTokens: 20_000, outputTokens: 2_000 } as const;
export const ESTIMATED_GATE_USD = { mandate: 0.0005, gates: 0.003 } as const;

export const estimatedAgentUsd = (column: AgentColumn): number =>
  costUsd(column.pricing, { ...NO_TOKENS, ...ESTIMATED_AGENT_TOKENS });

export const estimatedCellUsd = (column: AgentColumn): number =>
  estimatedAgentUsd(column) + ESTIMATED_GATE_USD.mandate + ESTIMATED_GATE_USD.gates;

// The Claude Haiku 5.5 column's.
export const ESTIMATED_CELL_USD = {
  agent: estimatedAgentUsd(HAIKU_COLUMN),
  ...ESTIMATED_GATE_USD,
} as const;
export const ESTIMATED_CELL_TOTAL_USD = estimatedCellUsd(HAIKU_COLUMN);

export interface MatrixEstimate {
  cells: number;
  perCellUsd: number;
  expectedUsd: number;
}

export const estimateMatrix = (
  cells: readonly CellInput[],
  column: AgentColumn = HAIKU_COLUMN,
): MatrixEstimate => {
  const perCellUsd = estimatedCellUsd(column);
  return { cells: cells.length, perCellUsd, expectedUsd: cells.length * perCellUsd };
};

export interface RunMatrixOptions {
  concurrency: number;
  // The whole matrix's cap in US dollars. A cell is started only when what has been spent, plus the
  // estimate for every cell still running, plus the estimate for this one, fits under it.
  maxUsd: number;
  // What a cell not yet finished is assumed to cost.
  estimateUsd?: number;
  onCell?: (
    result: CellResult,
    progress: { done: number; total: number; spentUsd: number },
  ) => void;
}

export interface MatrixRun {
  results: CellResult[];
  // Cells never started because the cap was reached.
  notStarted: CellInput[];
  spentUsd: number;
  stoppedBySpendCap: boolean;
}

// Runs the cells with at most `concurrency` at once, in order, and stops starting new ones once the
// cap is reached. Cells already running finish, so spend can pass the cap by the difference between
// a cell's estimate and its real cost; the per-run cap on the agent bounds that.
export async function runMatrix(
  cells: readonly CellInput[],
  runCell: (input: CellInput) => Promise<CellResult>,
  options: RunMatrixOptions,
): Promise<MatrixRun> {
  if (!(options.concurrency >= 1)) throw new Error("Concurrency must be at least 1");
  if (!(options.maxUsd > 0)) throw new Error("The spend cap must be above zero");
  const estimate = options.estimateUsd ?? ESTIMATED_CELL_TOTAL_USD;
  const results: CellResult[] = [];
  let next = 0;
  let spentUsd = 0;
  let running = 0;
  let stoppedBySpendCap = false;

  async function worker(): Promise<void> {
    while (next < cells.length && !stoppedBySpendCap) {
      if (spentUsd + (running + 1) * estimate > options.maxUsd) {
        // Another worker's cell may still finish cheaper than its estimate; wait for it before
        // giving up, so the cap is only hit when it really is.
        if (running === 0) {
          stoppedBySpendCap = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      const input = cells[next];
      next += 1;
      if (!input) return;
      running += 1;
      try {
        const result = await runCell(input);
        results.push(result);
        spentUsd += result.costUsd;
        options.onCell?.(result, { done: results.length, total: cells.length, spentUsd });
      } finally {
        running -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, cells.length) }, worker));
  return {
    results: orderLike(cells, results),
    notStarted: cells.slice(next),
    spentUsd,
    stoppedBySpendCap: stoppedBySpendCap && next < cells.length,
  };
}

// Results in the order the cells were planned, whatever order they finished in.
function orderLike(cells: readonly CellInput[], results: CellResult[]): CellResult[] {
  const key = (c: CellInput) => `${c.scenarioId}\u0000${c.seed}\u0000${c.column}`;
  const index = new Map(cells.map((c, i) => [key(c), i]));
  return [...results].sort(
    (a, b) => (index.get(key(a.input)) ?? 0) - (index.get(key(b.input)) ?? 0),
  );
}
