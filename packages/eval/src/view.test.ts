import { readdirSync, readFileSync } from "node:fs";
import { FIREWALL_CONFIGS, VERDICTS } from "@firewall/firewall";
import { describe, expect, it } from "vitest";
import type { MatrixRun } from "./matrix.js";
import { buildResults, type PaymentAdapterName } from "./results.js";
import { cell } from "./test-helpers.js";
import { SCHEMA_VERSION } from "./types.js";
import {
  CONFIGS_READ,
  isResultsName,
  newestFirst,
  parseResults,
  SCHEMA_VERSION_READ,
  summarize,
  VERDICTS_READ,
} from "./view.js";

const build = (
  adapter: PaymentAdapterName = "fake",
  cells = [cell(), cell({ kind: "attack" })],
) => {
  const matrix: MatrixRun = {
    results: cells,
    notStarted: [],
    spentUsd: 0.01,
    stoppedBySpendCap: false,
  };
  return buildResults({
    paymentAdapter: adapter,
    column: {
      columnId: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      modelId: "claude-haiku-5-5",
    },
    gateModel: "claude-haiku-5-5",
    scenarios: ["sc_b01", "sc_a01"],
    seeds: ["1", "2"],
    startedAt: new Date("2026-10-26T10:15:00.000Z"),
    finishedAt: new Date("2026-10-26T10:16:00.000Z"),
    eventLog: "run.events.db",
    concurrency: 3,
    maxUsd: 0.5,
    matrix,
  });
};

const text = (value: unknown) => JSON.stringify(value);

describe("the results reader", () => {
  it("reads what the writer writes, with the rates the harness computed", () => {
    const written = build();
    const parsed = parseResults(text(written));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.results.meta).toMatchObject({
      paymentAdapter: "fake",
      gateModel: "claude-haiku-5-5",
      seeds: ["1", "2"],
      date: "2026-10-26",
    });
    // Rates are read, never recomputed: the reader hands back the writer's numbers as they are.
    expect(parsed.results.metrics.configs).toEqual(written.metrics.configs);
    expect(parsed.results.cells).toHaveLength(2);
  });

  it("reads the committed first matrix", () => {
    const dir = new URL("../../../results/", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const parsed = parseResults(readFileSync(new URL(file, dir), "utf8"));
      if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
      expect(parsed.results.cells.length).toBe(parsed.results.metrics.runs.cells);
    }
  });

  it("leaves out what a headline page doesn't draw", () => {
    const parsed = parseResults(text(build()));
    if (!parsed.ok) throw new Error(parsed.error);
    const outcome = parsed.results.cells[0]?.outcomes[0];
    expect(outcome).not.toHaveProperty("gates");
    expect(parsed.results.cells[0]?.run).not.toHaveProperty("trajectory");
  });

  it("says why it refused a file, without echoing it", () => {
    expect(parseResults("{nope")).toEqual({ ok: false, error: "The file isn't valid JSON." });
    const wrongVersion = { ...build(), meta: { ...build().meta, schemaVersion: 2 } };
    const refused = parseResults(text(wrongVersion));
    expect(refused).toEqual({
      ok: false,
      error: "The file isn't a results file this version reads (at meta.schemaVersion).",
    });
    const noAdapter = build();
    // @ts-expect-error a file written by hand, missing its adapter
    delete noAdapter.meta.paymentAdapter;
    expect(parseResults(text(noAdapter)).ok).toBe(false);
    expect(parseResults("[]").ok).toBe(false);
  });

  it("refuses an adapter it doesn't know, so a result can't be taken for a sandbox one", () => {
    const odd = { ...build(), meta: { ...build().meta, paymentAdapter: "live" } };
    expect(parseResults(text(odd)).ok).toBe(false);
  });

  it("keeps the values it hard-codes equal to the harness's", () => {
    expect(SCHEMA_VERSION_READ).toBe(SCHEMA_VERSION);
    expect([...CONFIGS_READ]).toEqual([...FIREWALL_CONFIGS]);
    expect([...VERDICTS_READ]).toEqual([...VERDICTS]);
  });
});

describe("the list of results", () => {
  const meta = (startedAt: string) => {
    const parsed = parseResults(text(build()));
    if (!parsed.ok) throw new Error(parsed.error);
    return { ...parsed.results.meta, startedAt };
  };

  it("names the adapter, model column, gate model, seeds and date", () => {
    expect(summarize("a", meta("2026-10-26T10:15:00.000Z"))).toEqual({
      name: "a",
      paymentAdapter: "fake",
      column: {
        columnId: "claude-haiku-5-5",
        label: "Claude Haiku 5.5",
        modelId: "claude-haiku-5-5",
      },
      gateModel: "claude-haiku-5-5",
      seeds: ["1", "2"],
      date: "2026-10-26",
      startedAt: "2026-10-26T10:15:00.000Z",
    });
  });

  it("puts the newest first", () => {
    const items = [
      summarize("old", meta("2026-10-20T10:00:00.000Z")),
      summarize("b", meta("2026-10-26T10:15:00.000Z")),
      summarize("a", meta("2026-10-26T10:15:00.000Z")),
      summarize("new", meta("2026-10-30T09:00:00.000Z")),
    ];
    expect(items.sort(newestFirst).map((i) => i.name)).toEqual(["new", "b", "a", "old"]);
  });

  it.each(["2026-10-26T0012-fake-claude-haiku-5-5", "a", "run_1.v2"])(
    "accepts the name %s",
    (name) => {
      expect(isResultsName(name)).toBe(true);
    },
  );

  it.each([
    "",
    ".",
    "..",
    ".hidden",
    "../secret",
    "a/b",
    "a\\b",
    "/etc/passwd",
    "name.json/",
    "a b",
    "a\0b",
  ])("refuses the name %j", (name) => {
    expect(isResultsName(name)).toBe(false);
  });
});
