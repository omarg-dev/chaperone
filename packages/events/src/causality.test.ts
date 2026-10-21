import { describe, expect, it } from "vitest";
import { ancestors, children } from "./causality.js";
import type { Event } from "./types.js";

function event(eventId: string, parentId: string | null, seq: number): Event {
  return {
    seq,
    eventId,
    parentId,
    runId: "run_a",
    scenarioId: null,
    ts: "2026-11-01T12:00:00.000Z",
    lane: "agent",
    type: "tool_call",
    payload: null,
    provenance: "system",
    costUsd: 0,
    latencyMs: 0,
  };
}

// A poisoned review is read, the agent acts on it, and a gate flags the checkout.
const run = [
  event("review", null, 1),
  event("decision", "review", 2),
  event("checkout", "decision", 3),
  event("verdict", "checkout", 4),
  event("other", "review", 5),
];

describe("ancestors", () => {
  it("walks from an event back to the root, nearest first", () => {
    expect(ancestors(run, "verdict").map((e) => e.eventId)).toEqual([
      "checkout",
      "decision",
      "review",
    ]);
  });

  it("is empty for a root event or an unknown one", () => {
    expect(ancestors(run, "review")).toEqual([]);
    expect(ancestors(run, "missing")).toEqual([]);
  });

  it("stops at a parent outside the list", () => {
    expect(ancestors([event("orphan", "elsewhere", 1)], "orphan")).toEqual([]);
  });

  it("stops instead of looping on a cycle", () => {
    const cyclic = [event("a", "b", 1), event("b", "a", 2)];
    expect(ancestors(cyclic, "a").map((e) => e.eventId)).toEqual(["b"]);
  });
});

describe("children", () => {
  it("lists the events caused by this one, in log order", () => {
    expect(children(run, "review").map((e) => e.eventId)).toEqual(["decision", "other"]);
  });
});
