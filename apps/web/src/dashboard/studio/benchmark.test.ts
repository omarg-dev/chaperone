import { type ResultsSummary, summarize } from "@firewall/eval/view";
import { describe, expect, it } from "vitest";
import { fakeResults, sandboxResults } from "../fixtures";
import { CONFIG_INFO } from "../results";
import { benchmarkRows, leftOutNote, selectBenchmarkFiles, sourceLine } from "./benchmark";

const sum = (values: (number | null)[]) => values.reduce<number>((a, b) => a + (b ?? 0), 0);
const avg = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : sum(present) / present.length;
};

describe("benchmarkRows", () => {
  const rows = benchmarkRows("first", fakeResults, { sc_b01: "A keyboard" });

  it("makes one row per cell and firewall setting", () => {
    expect(rows).toHaveLength(fakeResults.cells.length * 3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.setting))).toEqual(
      new Set(["Off", "Gate 0 only", "Full tree"]),
    );
  });

  it("states where every row came from", () => {
    const [row] = rows;
    expect(row).toMatchObject({
      file: "first",
      adapter: "fake",
      model: "Claude Haiku 5.5",
      gateModel: "claude-haiku-5-5",
      scenarioSet: "Own",
    });
    expect(rows.find((r) => r.scenarioId === "sc_b01")?.scenario).toBe("A keyboard");
  });

  // Studio counts with sum and average; each must give the number the harness wrote in the file.
  it.each(fakeResults.metrics.configs.map((c) => [c.config, c] as const))(
    "adds up to the file's own numbers under %s",
    (config, metrics) => {
      const mine = rows.filter((r) => r.setting === CONFIG_INFO[config].name);
      expect(sum(mine.map((r) => r.counted))).toBe(metrics.runs);
      expect(sum(mine.map((r) => r.attackRun))).toBe(metrics.attackRuns);
      expect(sum(mine.map((r) => r.gotThrough))).toBe(metrics.attackSuccesses);
      expect(avg(mine.map((r) => r.attackGotThrough))).toBe(metrics.attackSuccessRate);
      expect(sum(mine.map((r) => r.agentFooled))).toBe(metrics.attackFooled);
      expect(sum(mine.map((r) => r.cleanCart))).toBe(metrics.cleanCarts);
      expect(avg(mine.map((r) => r.falseBlock))).toBe(metrics.falseBlockRate);
      expect(avg(mine.map((r) => r.falseEscalation))).toBe(metrics.falseEscalationRate);
      expect(sum(mine.map((r) => r.escalated))).toBe(metrics.escalated);
      expect(sum(mine.map((r) => r.reviewCostUsd))).toBeCloseTo(metrics.gatesCostUsd, 10);
      expect(avg(mine.map((r) => r.reviewCostUsd)) ?? 0).toBeCloseTo(
        metrics.gatesCostPerRunUsd ?? 0,
        10,
      );
    },
  );

  it("never gives an attack measure to a benign run, or a clean-cart one to a harmed cart", () => {
    for (const row of rows) {
      if (row.kind === "Benign") expect(row.attackGotThrough).toBeNull();
      if (row.cleanCart === 0) expect(row.falseEscalation).toBeNull();
    }
    expect(rows.filter((r) => r.setting === "Off").every((r) => r.reviewLatencyMs === null)).toBe(
      true,
    );
  });
});

const summary = (name: string, over: Partial<ResultsSummary>): ResultsSummary => ({
  ...summarize(name, sandboxResults.meta),
  ...over,
});

describe("selectBenchmarkFiles", () => {
  const heldOut = { scenarios: ["sc_h01", "sc_h02"] };
  const luna = { columnId: "gpt-6-luna", label: "OpenAI GPT-6 Luna", modelId: "gpt-6-luna" };

  it("reads the newest sandbox file of each model on each set, and says what it left out", () => {
    const list = [
      summary("haiku-new", { startedAt: "2026-11-07T16:47:00Z" }),
      summary("haiku-old", { startedAt: "2026-11-01T10:00:00Z" }),
      summary("haiku-held", { startedAt: "2026-11-07T17:05:00Z", ...heldOut }),
      summary("luna", { startedAt: "2026-11-07T16:48:00Z", column: luna }),
      summary("practice", { paymentAdapter: "fake", startedAt: "2026-11-08T00:00:00Z" }),
    ];
    const selection = selectBenchmarkFiles(list);
    expect(selection.files.map((f) => f.name)).toEqual(["haiku-new", "luna", "haiku-held"]);
    expect(selection.fake.map((f) => f.name)).toEqual(["practice"]);
    expect(selection.older.map((f) => f.name)).toEqual(["haiku-old"]);
    expect(leftOutNote(selection)).toBe(
      'Left out: 1 fake-adapter file and 1 older run of the same model and set. Each is still under "One result".',
    );
    expect(leftOutNote(selectBenchmarkFiles([list[0] as ResultsSummary]))).toBeNull();
  });

  it("says each file's adapter, model, set, gate model, seeds and date", () => {
    expect(sourceLine(summary("h", { ...heldOut, date: "2026-11-07" }))).toBe(
      "Claude Haiku 5.5 · held-out set · sandbox adapter · gates on claude-haiku-5-5 · seeds 1, 2 · 7 Nov 2026",
    );
  });
});
