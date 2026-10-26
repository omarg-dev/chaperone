import { describe, expect, it } from "vitest";
import {
  ESTIMATED_CELL_TOTAL_USD,
  estimateMatrix,
  parseSeeds,
  planMatrix,
  runMatrix,
  selectScenarios,
} from "./matrix.js";
import { cell } from "./test-helpers.js";
import type { CellInput, CellResult } from "./types.js";

const inputs = (n: number): CellInput[] =>
  Array.from({ length: n }, (_, i) => ({ scenarioId: `sc_${i}`, seed: "1", column: "c" }));

// A cell task that costs `usd` and finishes after `ms`.
const costing =
  (usd: number, ms = 0, started: string[] = []) =>
  async (input: CellInput): Promise<CellResult> => {
    started.push(input.scenarioId);
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
    return { ...cell(), input, costUsd: usd };
  };

describe("choosing the cells", () => {
  it("selects scenarios by ID, by kind or all, and refuses one that doesn't exist", () => {
    expect(selectScenarios("sc_b01, sc_a02").map((s) => s.scenarioId)).toEqual([
      "sc_b01",
      "sc_a02",
    ]);
    expect(selectScenarios("attacks").every((s) => s.kind === "attack")).toBe(true);
    expect(selectScenarios("benign").every((s) => s.kind === "benign")).toBe(true);
    expect(selectScenarios("all").length).toBe(
      selectScenarios("attacks").length + selectScenarios("benign").length,
    );
    expect(() => selectScenarios("sc_nope")).toThrow('No scenario "sc_nope"');
    expect(() => selectScenarios(" , ")).toThrow("No scenarios named");
  });

  it("parses seeds and refuses none or a repeat", () => {
    expect(parseSeeds("1, 2,3")).toEqual(["1", "2", "3"]);
    expect(() => parseSeeds("")).toThrow("No seeds");
    expect(() => parseSeeds("1,1")).toThrow("twice");
  });

  it("plans every scenario with every seed, and estimates the cost", () => {
    const cells = planMatrix(selectScenarios("sc_b01,sc_a02"), ["1", "2"], "claude-haiku-5-5");
    expect(cells.map((c) => `${c.scenarioId}:${c.seed}`)).toEqual([
      "sc_b01:1",
      "sc_b01:2",
      "sc_a02:1",
      "sc_a02:2",
    ]);
    expect(estimateMatrix(cells)).toEqual({
      cells: 4,
      perCellUsd: ESTIMATED_CELL_TOTAL_USD,
      expectedUsd: 4 * ESTIMATED_CELL_TOTAL_USD,
    });
  });
});

describe("running the matrix", () => {
  it("runs every cell and returns the results in plan order, whatever order they finished in", async () => {
    const cells = inputs(6);
    const run = await runMatrix(
      cells,
      async (input) => {
        // Earlier cells take longer, so they finish last.
        const ms = 30 - Number(input.scenarioId.slice(3)) * 5;
        return costing(0.001, ms)(input);
      },
      { concurrency: 3, maxUsd: 1 },
    );
    expect(run.results.map((r) => r.input.scenarioId)).toEqual(cells.map((c) => c.scenarioId));
    expect(run.notStarted).toEqual([]);
    expect(run.stoppedBySpendCap).toBe(false);
    expect(run.spentUsd).toBeCloseTo(0.006);
  });

  it("never runs more cells at once than the concurrency", async () => {
    let running = 0;
    let most = 0;
    await runMatrix(
      inputs(8),
      async (input) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { ...cell(), input, costUsd: 0 };
      },
      { concurrency: 2, maxUsd: 1 },
    );
    expect(most).toBe(2);
  });

  it("stops starting new cells once the cap is spent", async () => {
    const started: string[] = [];
    const run = await runMatrix(inputs(10), costing(0.02, 0, started), {
      concurrency: 1,
      maxUsd: 0.05,
      estimateUsd: 0.02,
    });
    // Two cells ($0.04) fit; a third could take it past $0.05.
    expect(started).toEqual(["sc_0", "sc_1"]);
    expect(run.results).toHaveLength(2);
    expect(run.notStarted.map((c) => c.scenarioId)).toEqual(
      inputs(10)
        .slice(2)
        .map((c) => c.scenarioId),
    );
    expect(run.stoppedBySpendCap).toBe(true);
    expect(run.spentUsd).toBeCloseTo(0.04);
  });

  it("counts the cells still running against the cap, so concurrency can't overshoot it", async () => {
    const started: string[] = [];
    const run = await runMatrix(inputs(10), costing(0.02, 20, started), {
      concurrency: 5,
      maxUsd: 0.05,
      estimateUsd: 0.02,
    });
    expect(started).toHaveLength(2);
    expect(run.spentUsd).toBeLessThanOrEqual(0.05);
    expect(run.stoppedBySpendCap).toBe(true);
  });

  it("starts nothing when a single cell's estimate is over the cap", async () => {
    const started: string[] = [];
    const run = await runMatrix(inputs(3), costing(0.001, 0, started), {
      concurrency: 2,
      maxUsd: 0.001,
      estimateUsd: 0.01,
    });
    expect(started).toEqual([]);
    expect(run.stoppedBySpendCap).toBe(true);
    expect(run.notStarted).toHaveLength(3);
  });

  it("runs on when cells come in cheaper than their estimate", async () => {
    const run = await runMatrix(inputs(10), costing(0, 0), {
      concurrency: 2,
      maxUsd: 0.05,
      estimateUsd: 0.02,
    });
    expect(run.results).toHaveLength(10);
    expect(run.stoppedBySpendCap).toBe(false);
  });

  it("refuses a missing cap or concurrency", async () => {
    await expect(runMatrix(inputs(1), costing(0), { concurrency: 0, maxUsd: 1 })).rejects.toThrow(
      "Concurrency",
    );
    await expect(runMatrix(inputs(1), costing(0), { concurrency: 1, maxUsd: 0 })).rejects.toThrow(
      "cap",
    );
  });
});
