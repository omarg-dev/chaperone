import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportRuns, InvalidRunsFileError, importRuns, type RunsFile } from "./portable.js";
import { type EventLog, openEventLog } from "./store.js";

let dir: string;
let tick: number;
const logs: EventLog[] = [];

function open(name: string): EventLog {
  const log = openEventLog({
    path: join(dir, name),
    clock: () => new Date(Date.UTC(2026, 10, 1, 12, 0, tick++)),
    newId: () => `ev_source_${String(tick).padStart(3, "0")}`,
  });
  logs.push(log);
  return log;
}

// Two runs: a real one (sandbox money) and a practice one, each with a parent chain.
function record(log: EventLog) {
  for (const [runId, payments] of [
    ["run_real", "sandbox"],
    ["run_practice", "fake"],
  ] as const) {
    const start = log.append({
      runId,
      scenarioId: "sc_a01",
      lane: "arena",
      type: "run_started",
      provenance: "catalog",
      payload: { origin: "web", payments },
    });
    log.append({
      runId,
      scenarioId: "sc_a01",
      lane: "gate1",
      type: "verdict",
      provenance: "system",
      parentId: start.eventId,
      payload: { verdict: "block", nested: { quote: "ünï", n: [1, 2] } },
      costUsd: 0.0042,
      latencyMs: 812,
    });
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "portable-"));
  tick = 0;
});
afterEach(() => {
  for (const log of logs.splice(0)) log.close();
  rmSync(dir, { recursive: true, force: true });
});

function opts(name: string) {
  return { path: join(dir, name) };
}

describe("export and import of runs", () => {
  it("keeps every event as it was written", () => {
    const source = open("source.db");
    record(source);
    const file = exportRuns(source);

    const result = importRuns(opts("hosted.db"), file);
    expect(result).toEqual({ imported: 4, skipped: 0, runs: ["run_real", "run_practice"] });

    const hosted = open("hosted.db");
    for (const runId of ["run_real", "run_practice"]) {
      const strip = (events: { seq: number }[]) => events.map(({ seq: _seq, ...rest }) => rest);
      expect(strip(hosted.listRun(runId))).toEqual(strip(source.listRun(runId)));
    }
    // Same causal chain, same order on the Runs page, same totals.
    expect(hosted.listRuns().map((run) => run.runId)).toEqual(
      source.listRuns().map((run) => run.runId),
    );
    expect(hosted.listRuns()[0]?.costUsd).toBe(0.0042);
    expect(hosted.listRuns()[0]?.payments).toBe("fake");
  });

  it("does nothing the second time", () => {
    const source = open("source.db");
    record(source);
    const file = exportRuns(source);
    importRuns(opts("hosted.db"), file);
    const again = importRuns(opts("hosted.db"), file);
    expect(again).toEqual({ imported: 0, skipped: 4, runs: [] });
    expect(open("hosted.db").listRuns()).toHaveLength(2);
  });

  it("adds only what a partly imported run is missing, and never changes what is there", () => {
    const source = open("source.db");
    record(source);
    const file = exportRuns(source);
    importRuns(opts("hosted.db"), { ...file, events: file.events.slice(0, 1) });
    const result = importRuns(opts("hosted.db"), file);
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(1);
    expect(open("hosted.db").listRun("run_real")).toHaveLength(2);
  });

  it("leaves the target's own runs alone", () => {
    const source = open("source.db");
    record(source);
    const hosted = open("hosted.db");
    hosted.append({ runId: "run_mine", lane: "agent", type: "tool_call", provenance: "system" });
    importRuns(opts("hosted.db"), exportRuns(source));
    expect(
      hosted
        .listRuns()
        .map((run) => run.runId)
        .sort(),
    ).toEqual(["run_mine", "run_practice", "run_real"]);
  });

  it("exports only the sandbox runs, or only the runs asked for", () => {
    const source = open("source.db");
    record(source);
    expect(new Set(exportRuns(source, { payments: "sandbox" }).events.map((e) => e.runId))).toEqual(
      new Set(["run_real"]),
    );
    expect(exportRuns(source, { runIds: ["run_practice"] }).events).toHaveLength(2);
    expect(() => exportRuns(source, { runIds: ["run_nope"] })).toThrow(/run_nope/);
  });

  it("refuses a bad file before writing any of it", () => {
    const source = open("source.db");
    record(source);
    const file = exportRuns(source);
    const bad: RunsFile = {
      ...file,
      events: [
        ...file.events,
        { ...file.events[0], eventId: "ev_orphan", parentId: "ev_missing" } as never,
      ],
    };
    expect(() => importRuns(opts("hosted.db"), bad)).toThrow(InvalidRunsFileError);
    expect(open("hosted.db").listRuns()).toHaveLength(0);

    expect(() => importRuns(opts("hosted.db"), { format: "other" })).toThrow(/format/);
    expect(() =>
      importRuns(opts("hosted.db"), { ...file, events: [{ ...file.events[0], lane: "nowhere" }] }),
    ).toThrow(/lane/);
  });

  it("goes through the log's append, which the database still refuses to update or delete", () => {
    const source = open("source.db");
    record(source);
    importRuns(opts("hosted.db"), exportRuns(source));
    const raw = new Database(join(dir, "hosted.db"));
    expect(() => raw.prepare("update events set cost_usd = 9").run()).toThrow();
    expect(() => raw.prepare("delete from events").run()).toThrow();
    raw.close();
  });
});
