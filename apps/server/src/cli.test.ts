import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, runCli } from "./cli.js";
import { eventLogOptions } from "./open-log.js";

let dir: string;
let out: string;
let err: string;
let stdin: string;

const io: CliIo = {
  readStdin: () => stdin,
  stdout: (text) => {
    out += text;
  },
  stderr: (text) => {
    err += text;
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-"));
  out = err = stdin = "";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A source data folder with one sandbox run and one practice run, written by the real log.
function seed(dataDir: string) {
  const log = openEventLog(eventLogOptions(dataDir));
  for (const [runId, payments] of [
    ["run_real", "sandbox"],
    ["run_fake", "fake"],
  ] as const) {
    const start = log.append({
      runId,
      lane: "arena",
      type: "run_started",
      provenance: "catalog",
      payload: { payments },
    });
    log.append({
      runId,
      lane: "gate0",
      type: "verdict",
      provenance: "system",
      parentId: start.eventId,
    });
  }
  log.close();
}

function runsIn(dataDir: string): string[] {
  const log = openEventLog(eventLogOptions(dataDir));
  const ids = log.listRuns().map((run) => run.runId);
  log.close();
  return ids.sort();
}

describe("export-runs and import-runs", () => {
  it("move the real runs from one data folder to another, and a second import adds nothing", () => {
    const source = join(dir, "source");
    const hosted = join(dir, "hosted");
    seed(source);
    const file = join(dir, "runs.json");

    expect(runCli(["export-runs", "--sandbox", "--out", file], { DATA_DIR: source }, io)).toBe(0);
    expect(err).toContain("Exported 2 events from 1 runs");

    err = "";
    expect(runCli(["import-runs", file], { DATA_DIR: hosted }, io)).toBe(0);
    expect(err).toContain("Imported 2 events from 1 runs; 0 were already");
    expect(runsIn(hosted)).toEqual(["run_real"]);

    err = "";
    expect(runCli(["import-runs", file], { DATA_DIR: hosted }, io)).toBe(0);
    expect(err).toContain("Imported 0 events from 0 runs; 2 were already");
  });

  it("writes the file to standard output and reads it back from standard input", () => {
    const source = join(dir, "source");
    seed(source);
    expect(runCli(["export-runs"], { DATA_DIR: source }, io)).toBe(0);
    expect(JSON.parse(out).events).toHaveLength(4);

    stdin = out;
    expect(runCli(["import-runs", "-"], { DATA_DIR: join(dir, "hosted") }, io)).toBe(0);
    expect(runsIn(join(dir, "hosted"))).toEqual(["run_fake", "run_real"]);
  });

  it("refuses a file that is not a runs file, and imports nothing", () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ format: "chaperone-runs", version: 1, events: [{}] }));
    expect(runCli(["import-runs", file], { DATA_DIR: join(dir, "hosted") }, io)).toBe(1);
    expect(err).toContain("Nothing was imported");
    writeFileSync(file, "not json");
    expect(runCli(["import-runs", file], { DATA_DIR: join(dir, "hosted") }, io)).toBe(1);
    expect(runsIn(join(dir, "hosted"))).toEqual([]);
  });

  it("explains itself on an unknown command or option", () => {
    expect(runCli(["frobnicate"], {}, io)).toBe(2);
    expect(err).toContain("Usage:");
    err = "";
    expect(runCli(["export-runs", "--nope"], { DATA_DIR: dir }, io)).toBe(1);
    expect(err).toContain("Unknown option --nope");
  });
});
