import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventLog, InvalidEventError, openEventLog } from "./store.js";
import type { NewEvent } from "./types.js";

let dir: string;
let path: string;
let log: EventLog;
let tick: number;

// A clock that moves one second per append, and IDs that count up, so assertions are exact.
function open() {
  return openEventLog({
    path,
    clock: () => new Date(Date.UTC(2026, 10, 1, 12, 0, tick++)),
    newId: () => `ev_${String(tick).padStart(3, "0")}`,
  });
}

const noOutcome = {
  verdict: null,
  decidedBy: null,
  reviewFailed: false,
  holdOpen: false,
  escalation: null,
  seed: null,
  reviews: [],
  paidPayees: [],
  origin: null,
  payments: null,
};

const base: NewEvent = { runId: "run_a", lane: "agent", type: "tool_call", provenance: "system" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "events-"));
  path = join(dir, "events.db");
  tick = 0;
  log = open();
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("append", () => {
  it("stores the event with its ID, timestamp, position and defaults", () => {
    const event = log.append({ ...base, payload: { tool: "search", query: "keyboard" } });
    expect(event).toEqual({
      seq: 1,
      eventId: "ev_001",
      parentId: null,
      runId: "run_a",
      scenarioId: null,
      ts: "2026-11-01T12:00:00.000Z",
      lane: "agent",
      type: "tool_call",
      payload: { tool: "search", query: "keyboard" },
      provenance: "system",
      costUsd: 0,
      latencyMs: 0,
    });
    expect(log.get("ev_001")).toEqual(event);
  });

  it("links an event to its parent", () => {
    const parent = log.append(base);
    const child = log.append({ ...base, type: "tool_result", parentId: parent.eventId });
    expect(child.parentId).toBe(parent.eventId);
  });

  it("refuses a parent that isn't in the log", () => {
    expect(() => log.append({ ...base, parentId: "ev_missing" })).toThrow(InvalidEventError);
    expect(log.listRun("run_a")).toEqual([]);
  });

  it("refuses an invalid event and writes nothing", () => {
    expect(() => log.append({ ...base, costUsd: -1 })).toThrow(/costUsd/);
    expect(log.listRun("run_a")).toEqual([]);
  });

  it("tells subscribers about each event, until they unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribe = log.subscribe((e) => seen.push(e.eventId));
    log.append(base);
    unsubscribe();
    log.append(base);
    expect(seen).toEqual(["ev_001"]);
  });

  it("keeps appending when a subscriber throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error("socket closed");
    });
    log.subscribe((e) => seen.push(e.eventId));
    expect(() => log.append(base)).not.toThrow();
    expect(seen).toEqual(["ev_001"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe("reading", () => {
  it("lists a run's events in append order, leaving other runs out", () => {
    log.append({ ...base, runId: "run_a" });
    log.append({ ...base, runId: "run_b" });
    log.append({ ...base, runId: "run_a", lane: "gate0", type: "verdict" });
    expect(log.listRun("run_a").map((e) => [e.seq, e.lane])).toEqual([
      [1, "agent"],
      [3, "gate0"],
    ]);
  });

  it("summarises every run, most recent first", () => {
    log.append({ ...base, runId: "run_a", costUsd: 0.25 });
    log.append({ ...base, runId: "run_a", scenarioId: "sc_a1", costUsd: 0.5 });
    log.append({ ...base, runId: "run_b" });
    expect(log.listRuns()).toEqual([
      {
        runId: "run_b",
        scenarioId: null,
        startedAt: "2026-11-01T12:00:02.000Z",
        lastEventAt: "2026-11-01T12:00:02.000Z",
        eventCount: 1,
        costUsd: 0,
        ...noOutcome,
      },
      {
        runId: "run_a",
        scenarioId: "sc_a1",
        startedAt: "2026-11-01T12:00:00.000Z",
        lastEventAt: "2026-11-01T12:00:01.000Z",
        eventCount: 2,
        costUsd: 0.75,
        ...noOutcome,
      },
    ]);
  });

  it("adds how each run ended, from its review and a person's decision", () => {
    const review = (runId: string, type: string, payload: unknown) =>
      log.append({ runId, lane: "review", type, provenance: "system", payload });
    const decide = (runId: string, decision: string) =>
      log.append({
        runId,
        lane: "human",
        type: "human_decision",
        provenance: "user",
        payload: { decision },
      });

    log.append({ ...base, runId: "run_none" });
    review("run_block", "review_finished", { verdict: "block" });
    review("run_off", "review_finished", { verdict: null });
    review("run_failed", "review_failed", { error: "model unavailable" });
    // An escalation needs the order's hold on record, since it is waiting for a person only while
    // the hold is open (see outcome.test.ts for each state).
    for (const runId of ["run_open", "run_yes", "run_no"]) {
      log.append({
        runId,
        lane: "payments",
        type: "payment_call",
        provenance: "system",
        payload: {
          operation: "authorize_order",
          input: ["order_1"],
          result: { authorizationId: "A1" },
        },
      });
    }
    review("run_open", "review_finished", { verdict: "escalate" });
    review("run_yes", "review_finished", { verdict: "escalate" });
    decide("run_yes", "approve");
    review("run_no", "review_finished", { verdict: "escalate" });
    decide("run_no", "reject");
    // A decision only settles an escalation.
    review("run_approved", "review_finished", { verdict: "approve" });
    decide("run_approved", "reject");
    // A later review replaces an earlier failure.
    review("run_retried", "review_failed", {});
    review("run_retried", "review_finished", { verdict: "approve" });

    const outcomes = Object.fromEntries(
      log.listRuns().map((r) => [r.runId, [r.verdict, r.decidedBy, r.reviewFailed]]),
    );
    expect(outcomes).toEqual({
      run_none: [null, null, false],
      run_block: ["block", "review", false],
      run_off: [null, "no_review", false],
      run_failed: [null, null, true],
      run_open: ["escalate", "review", false],
      run_yes: ["approve", "person", false],
      run_no: ["block", "person", false],
      run_approved: ["approve", "review", false],
      run_retried: ["approve", "review", false],
    });
  });

  it("adds the seed, the configurations a run was reviewed under and who was paid", () => {
    const append = (runId: string, lane: "arena" | "review", type: string, payload: unknown) =>
      log.append({ runId, lane, type, provenance: "system", payload });

    append("run_cell", "arena", "run_started", { seed: "3", request: "x" });
    // An eval cell: one checkout reviewed under three configurations, the last enforced.
    for (const config of ["off", "gate0", "full"]) {
      append("run_cell", "review", "review_started", { config });
      append("run_cell", "review", "review_finished", { verdict: "approve" });
    }
    append("run_cell", "review", "enforced", {
      money: "captured",
      payouts: [
        { payeeKey: "seller_2", amountCents: 9000 },
        { payeeKey: "attacker_1", amountCents: 0 },
      ],
    });
    // Voided: nobody was paid.
    append("run_void", "review", "review_started", { config: "full" });
    append("run_void", "review", "enforced", { money: "voided", payouts: [] });
    // A run that never got as far as a review.
    log.append({ ...base, runId: "run_early" });

    const facets = Object.fromEntries(
      log.listRuns().map((r) => [r.runId, [r.seed, r.reviews, r.paidPayees]]),
    );
    expect(facets).toEqual({
      run_cell: ["3", ["off", "gate0", "full"], ["seller_2"]],
      run_void: [null, ["full"], []],
      run_early: [null, [], []],
    });
  });

  it("keeps events when the log is closed and opened again", () => {
    log.append(base);
    log.close();
    log = open();
    expect(log.listRun("run_a")).toHaveLength(1);
  });
});

// Replay, the eval numbers and dispute evidence all assume a written event never changes.
describe("test_events_cannot_be_updated_or_deleted", () => {
  it("refuses updates and deletes made straight against the database", () => {
    log.append(base);
    const raw = new Database(path);
    expect(() => raw.prepare("UPDATE events SET cost_usd = 9").run()).toThrow(/append-only/);
    expect(() => raw.prepare("DELETE FROM events").run()).toThrow(/append-only/);
    raw.close();
    expect(log.listRun("run_a")[0]?.costUsd).toBe(0);
  });
});
