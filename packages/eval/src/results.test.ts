import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MatrixRun } from "./matrix.js";
import { buildResults, renderMarkdown, resultsName, writeResults } from "./results.js";
import { cell } from "./test-helpers.js";

const matrix = (
  cells = [cell(), cell({ kind: "attack", fooled: true, full: { verdict: "block" } })],
): MatrixRun => ({
  results: cells,
  notStarted: [],
  spentUsd: 0.0123,
  stoppedBySpendCap: false,
});

const build = (adapter: "fake" | "sandbox", m = matrix()) =>
  buildResults({
    paymentAdapter: adapter,
    column: {
      columnId: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      modelId: "claude-haiku-5-5",
    },
    gateModel: "claude-haiku-5-5",
    scenarios: ["sc_b01", "sc_a02"],
    seeds: ["1", "2"],
    startedAt: new Date("2026-10-26T10:15:00.000Z"),
    finishedAt: new Date("2026-10-26T10:16:00.000Z"),
    eventLog: "run.events.db",
    concurrency: 3,
    maxUsd: 0.5,
    matrix: m,
  });

describe("the results file", () => {
  it("names the payment adapter, the model column, the gate model, the seeds and the date", () => {
    const results = build("fake");
    expect(results.meta).toMatchObject({
      paymentAdapter: "fake",
      column: { columnId: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      gateModel: "claude-haiku-5-5",
      seeds: ["1", "2"],
      date: "2026-10-26",
      eventLog: "run.events.db",
    });
    expect(results.meta.adapterNote).toContain("FAKE");
    expect(results.cells).toHaveLength(2);
    expect(results.metrics.configs.map((c) => c.config)).toEqual(["off", "gate0", "full"]);
  });

  it("says in the summary's first lines that fake numbers aren't sandbox numbers", () => {
    const markdown = renderMarkdown(build("fake"));
    const top = markdown.split("\n").slice(0, 4).join("\n");
    expect(top).toContain("Payment adapter: FAKE");
    expect(top).toContain("must not be shown in the video or the write-up");
    expect(markdown).toContain("| Payment adapter | **fake** |");
    expect(markdown).toContain("Claude Haiku 5.5");
    expect(markdown).toContain("| Seeds | 1, 2 |");
    expect(markdown).toContain("| Gate model | `claude-haiku-5-5` |");
    expect(markdown).toContain("Attack success rate");
  });

  it("says SANDBOX for a sandbox run, and not that it is fake", () => {
    const markdown = renderMarkdown(build("sandbox"));
    expect(markdown).toContain("Payment adapter: SANDBOX");
    expect(markdown).not.toContain("FAKE");
  });

  it("writes JSON and Markdown files, each naming its adapter, under a name that does too", () => {
    const dir = mkdtempSync(join(tmpdir(), "results-"));
    try {
      const name = resultsName(new Date("2026-10-26T10:15:00.000Z"), "fake", "claude-haiku-5-5");
      expect(name).toBe("2026-10-26T1015-fake-claude-haiku-5-5");
      const written = writeResults(dir, name, build("fake"));
      const json = JSON.parse(readFileSync(written.jsonPath, "utf8"));
      expect(json.meta.paymentAdapter).toBe("fake");
      expect(json.cells).toHaveLength(2);
      expect(readFileSync(written.markdownPath, "utf8")).toContain("FAKE payment adapter");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says when the spend cap stopped the matrix", () => {
    const results = build("fake", {
      ...matrix(),
      stoppedBySpendCap: true,
      notStarted: [{ scenarioId: "sc_a03", seed: "1", column: "claude-haiku-5-5" }],
    });
    expect(renderMarkdown(results)).toContain("stopped: 1 cells not started");
  });

  it("renders a matrix with no attack runs without NaN", () => {
    const markdown = renderMarkdown(build("fake", matrix([cell()])));
    expect(markdown).not.toContain("NaN");
    expect(markdown).toContain("n/a");
    expect(markdown).not.toContain("## Attacks");
  });
});
