import { type EventLog, type EventLogOptions, openEventLog } from "./store.js";
import type { Event, Lane, NewEvent, Provenance } from "./types.js";
import { validateNewEvent } from "./validate.js";

// Moving runs between event logs: the recorded real runs made on one machine become the hosted
// demo's default content on another. The file keeps every event as it was written (ID, parent,
// timestamp, payload, cost), so a replay on the server is the replay that was recorded, and the
// causal arrows, the mandate hashes and the cost counted for the daily cap all still hold.
// Importing only ever appends, and an event already in the log (same ID) is left alone, so
// importing a file twice does nothing the second time.

export const RUNS_FILE_FORMAT = "chaperone-runs";
export const RUNS_FILE_VERSION = 1;

export interface PortableEvent {
  eventId: string;
  parentId: string | null;
  runId: string;
  scenarioId: string | null;
  ts: string;
  lane: Lane;
  type: string;
  payload: unknown;
  provenance: Provenance;
  costUsd: number;
  latencyMs: number;
}

export interface RunsFile {
  format: typeof RUNS_FILE_FORMAT;
  version: typeof RUNS_FILE_VERSION;
  exportedAt: string;
  // Oldest run first, each run's events together in the order they were appended.
  events: PortableEvent[];
}

export interface ExportOptions {
  // Only these runs. Unset: every run in the log.
  runIds?: string[];
  // Only runs that held their money on this adapter ("sandbox" for the real ones).
  payments?: string;
  now?: Date;
}

export function exportRuns(log: EventLog, options: ExportOptions = {}): RunsFile {
  const wanted = options.runIds ? new Set(options.runIds) : null;
  // listRuns is most recent first; the file is oldest first, so an import appends in the order the
  // runs were made and the Runs page lists them in the same order.
  const runs = log
    .listRuns()
    .filter((run) => !wanted || wanted.has(run.runId))
    .filter((run) => !options.payments || run.payments === options.payments)
    .reverse();
  if (wanted) {
    const found = new Set(runs.map((run) => run.runId));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(`No such run, or not on the chosen adapter: ${missing.join(", ")}`);
    }
  }
  return {
    format: RUNS_FILE_FORMAT,
    version: RUNS_FILE_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    events: runs.flatMap((run) => log.listRun(run.runId).map(portable)),
  };
}

function portable(event: Event): PortableEvent {
  return {
    eventId: event.eventId,
    parentId: event.parentId,
    runId: event.runId,
    scenarioId: event.scenarioId,
    ts: event.ts,
    lane: event.lane,
    type: event.type,
    payload: event.payload,
    provenance: event.provenance,
    costUsd: event.costUsd,
    latencyMs: event.latencyMs,
  };
}

export interface ImportResult {
  imported: number;
  // Events already in the log, left as they were.
  skipped: number;
  // The runs that gained at least one event.
  runs: string[];
}

// Problems with a parsed file, as messages to act on. Empty when it can be imported. Checked in full
// before anything is written, so a bad file leaves the log as it was.
export function validateRunsFile(file: unknown, known: (eventId: string) => boolean): string[] {
  if (typeof file !== "object" || file === null) return ["the file is not a JSON object"];
  const { format, version, events } = file as Record<string, unknown>;
  if (format !== RUNS_FILE_FORMAT) return [`format must be "${RUNS_FILE_FORMAT}"`];
  if (version !== RUNS_FILE_VERSION)
    return [`version must be ${RUNS_FILE_VERSION}, got ${version}`];
  if (!Array.isArray(events)) return ["events must be a list"];

  const problems: string[] = [];
  const seen = new Set<string>();
  events.forEach((raw: unknown, index) => {
    const event = raw as Partial<PortableEvent> | null;
    const where = `event ${index}`;
    if (typeof event !== "object" || event === null) {
      problems.push(`${where} is not an object`);
      return;
    }
    if (typeof event.eventId !== "string" || !event.eventId) {
      problems.push(`${where} has no eventId`);
      return;
    }
    if (seen.has(event.eventId)) problems.push(`${where}: eventId ${event.eventId} appears twice`);
    if (typeof event.ts !== "string" || Number.isNaN(Date.parse(event.ts))) {
      problems.push(`${where} (${event.eventId}): ts must be an ISO date`);
    } else if (new Date(event.ts).toISOString() !== event.ts) {
      problems.push(`${where} (${event.eventId}): ts must be written as toISOString does`);
    }
    for (const problem of validateNewEvent(event as NewEvent)) {
      problems.push(`${where} (${event.eventId}): ${problem}`);
    }
    // A parent has to come first in the file, or already be in the log.
    const parent = event.parentId ?? null;
    if (parent !== null && !seen.has(parent) && !known(parent)) {
      problems.push(
        `${where} (${event.eventId}): parent ${parent} is not earlier in the file or in the log`,
      );
    }
    seen.add(event.eventId);
  });
  return problems;
}

export class InvalidRunsFileError extends Error {
  constructor(readonly problems: string[]) {
    super(`Not a runs file I can import: ${problems.slice(0, 5).join("; ")}`);
    this.name = "InvalidRunsFileError";
  }
}

// Appends the file's events to the log at `options.path`. The log's append makes the ID and the
// timestamp itself, so the file's are handed to it through the clock and ID hooks the log already
// takes for seeded scenarios; nothing about how events are stored changes, and the log still has no
// way to update or delete one. The events get new positions (seq) in this log, in file order.
export function importRuns(
  options: Omit<EventLogOptions, "clock" | "newId">,
  file: unknown,
): ImportResult {
  let next: PortableEvent | null = null;
  const log = openEventLog({
    ...options,
    clock: () => new Date((next as PortableEvent).ts),
    newId: () => (next as PortableEvent).eventId,
  });
  try {
    const problems = validateRunsFile(file, (id) => log.get(id) !== undefined);
    if (problems.length > 0) throw new InvalidRunsFileError(problems);

    const result: ImportResult = { imported: 0, skipped: 0, runs: [] };
    const touched = new Set<string>();
    for (const event of (file as RunsFile).events) {
      if (log.get(event.eventId)) {
        result.skipped++;
        continue;
      }
      next = event;
      log.append({
        runId: event.runId,
        lane: event.lane,
        type: event.type,
        provenance: event.provenance,
        parentId: event.parentId,
        scenarioId: event.scenarioId,
        payload: event.payload,
        costUsd: event.costUsd,
        latencyMs: event.latencyMs,
      });
      result.imported++;
      touched.add(event.runId);
    }
    result.runs = [...touched];
    return result;
  } finally {
    log.close();
  }
}
