import { describe, expect, it } from "vitest";
import type { RunEvent } from "./events";
import { fixtures, payees } from "./fixtures";
import {
  clampPosition,
  describeEvent,
  elapsedAt,
  GAP_CAP_MS,
  gapMs,
  keyCommand,
  nextPosition,
  parseAt,
  SPEEDS,
  stepBy,
  stepDelayMs,
} from "./playhead";
import { buildRun } from "./timeline";

const NOW = Date.parse("2026-10-24T11:04:00Z");

// Events a known number of milliseconds apart, with nothing else about them that matters.
const spaced = (...gaps: number[]): RunEvent[] => {
  let at = Date.parse("2026-10-24T11:03:00.000Z");
  return [0, ...gaps].map((gap, i) => {
    at += gap;
    return {
      seq: i + 1,
      eventId: `ev_${i + 1}`,
      parentId: null,
      runId: "run_x",
      scenarioId: null,
      ts: new Date(at).toISOString(),
      lane: "agent",
      type: "model_turn",
      payload: {},
      provenance: "system",
      costUsd: 0,
      latencyMs: 0,
    };
  });
};

describe("positions", () => {
  it("keeps the playhead on an event of the run", () => {
    expect(clampPosition(0, 10)).toBe(1);
    expect(clampPosition(-3, 10)).toBe(1);
    expect(clampPosition(4, 10)).toBe(4);
    expect(clampPosition(99, 10)).toBe(10);
    expect(clampPosition(1, 0)).toBe(0);
    expect(stepBy(1, -1, 10)).toBe(1);
    expect(stepBy(10, 1, 10)).toBe(10);
    expect(stepBy(5, 1, 10)).toBe(6);
  });

  it("reads a position, or an event's ID, from the address", () => {
    const events = spaced(10, 10, 10);
    expect(parseAt("3", events)).toBe(3);
    expect(parseAt("ev_2", events)).toBe(2);
    // Past the end is the end; nothing usable is no position.
    expect(parseAt("40", events)).toBe(4);
    expect(parseAt("0", events)).toBeNull();
    expect(parseAt("ev_nope", events)).toBeNull();
    expect(parseAt("-2", events)).toBeNull();
    expect(parseAt("", events)).toBeNull();
    expect(parseAt(null, events)).toBeNull();
    expect(parseAt("2", [])).toBeNull();
  });
});

describe("how long the playhead waits", () => {
  // Gaps after events 1, 2, 3 and 4: a burst, a normal step, a long think and a very long one.
  const events = spaced(0, 400, 8000, 90000);

  it("says the real gap after the event at a position", () => {
    expect(gapMs(events, 1)).toBe(0);
    expect(gapMs(events, 2)).toBe(400);
    expect(gapMs(events, 3)).toBe(8000);
    expect(gapMs(events, 5)).toBe(0);
  });

  it("plays at 1x by the real gaps, with a long quiet one capped", () => {
    expect(stepDelayMs(events, 2, "1x")).toBe(400);
    expect(stepDelayMs(events, 3, "1x")).toBe(GAP_CAP_MS);
    expect(stepDelayMs(events, 4, "1x")).toBe(GAP_CAP_MS);
    expect(GAP_CAP_MS).toBeGreaterThanOrEqual(1000);
    expect(GAP_CAP_MS).toBeLessThanOrEqual(2000);
  });

  it("plays at 4x in a quarter of the time, and instantly in none", () => {
    expect(stepDelayMs(events, 2, "4x")).toBe(100);
    expect(stepDelayMs(events, 3, "4x")).toBe(GAP_CAP_MS / 4);
    expect(stepDelayMs(events, 3, "instant")).toBe(0);
  });

  it("never waits on a clock that ran backwards, or on one that isn't a time", () => {
    const backwards = spaced(-500);
    expect(gapMs(backwards, 1)).toBe(0);
    const broken = spaced(100);
    (broken[1] as RunEvent).ts = "not a time";
    expect(gapMs(broken, 1)).toBe(0);
  });

  it("goes one event on, or to the end when instant", () => {
    expect(nextPosition(3, 10, "1x")).toBe(4);
    expect(nextPosition(3, 10, "4x")).toBe(4);
    expect(nextPosition(3, 10, "instant")).toBe(10);
    expect(nextPosition(10, 10, "1x")).toBe(10);
    expect(SPEEDS).toEqual(["1x", "4x", "instant"]);
  });

  it("says how far into the run an event was", () => {
    expect(elapsedAt(events, 1)).toBe(0);
    expect(elapsedAt(events, 3)).toBe(400);
    expect(elapsedAt(events, 4)).toBe(8400);
    expect(elapsedAt([], 1)).toBe(0);
  });
});

describe("the keyboard", () => {
  const page = { tag: "BODY" };
  it("plays and pauses on space, and steps on the arrows", () => {
    expect(keyCommand(" ", page)).toBe("toggle");
    expect(keyCommand("ArrowLeft", page)).toBe("back");
    expect(keyCommand("ArrowRight", page)).toBe("forward");
    expect(keyCommand("Home", page)).toBe("first");
    expect(keyCommand("End", page)).toBe("last");
    expect(keyCommand("a", page)).toBeNull();
  });

  it("leaves a button its own space, but still steps from it", () => {
    expect(keyCommand(" ", { tag: "BUTTON" })).toBeNull();
    expect(keyCommand("ArrowRight", { tag: "BUTTON" })).toBe("forward");
  });

  it("leaves a slider its own arrows, and text boxes and menus everything", () => {
    expect(keyCommand("ArrowRight", { tag: "INPUT", type: "range" })).toBeNull();
    expect(keyCommand(" ", { tag: "INPUT", type: "range" })).toBeNull();
    expect(keyCommand(" ", { tag: "INPUT", type: "search" })).toBeNull();
    expect(keyCommand("ArrowLeft", { tag: "INPUT", type: "search" })).toBeNull();
    expect(keyCommand("ArrowLeft", { tag: "SELECT" })).toBeNull();
    expect(keyCommand("ArrowLeft", { tag: "TEXTAREA" })).toBeNull();
  });

  it("leaves the browser's own shortcuts alone", () => {
    expect(keyCommand("ArrowLeft", page, { alt: true })).toBeNull();
    expect(keyCommand("ArrowRight", page, { meta: true })).toBeNull();
    expect(keyCommand(" ", page, { ctrl: true })).toBeNull();
  });
});

describe("what an event was", () => {
  it("says it in words, for every event of every recorded run, without a seller's text", () => {
    for (const [name, log] of Object.entries(fixtures)) {
      for (const event of log) {
        const words = describeEvent(event);
        expect(words, `${name} ${event.lane}/${event.type}`).toMatch(/^[A-Z]/);
        expect(words).not.toMatch(/_/);
        expect(words).not.toContain("Halvard Link");
      }
    }
  });

  it("says when Gate 1 flagged a passage, the moment the run view outlines it", () => {
    const facts = fixtures.escalated.filter((e) => e.type === "gate1_facts");
    expect(facts.map(describeEvent)).toEqual(["Gate 1 flagged a passage as steering"]);
    const clean = fixtures.approved.filter((e) => e.type === "gate1_facts");
    expect(clean.map(describeEvent)).toEqual([
      "Gate 1 read a page and found nothing steering",
      "Gate 1 read a page and found nothing steering",
    ]);
  });

  it("reads the money's steps", () => {
    const words = fixtures.attackerPaid.map(describeEvent);
    expect(words).toContain("The platform held the money");
    expect(words).toContain("The review started (firewall off)");
    expect(words).toContain("The money was captured and paid out");
    expect(fixtures.blocked.map(describeEvent)).toContain("Gate 0 ruled: block");
  });
});

// The replay draws the model of a prefix of the log, so these are what keeps it honest: every
// moment of every recorded run is something the run view can draw, and the last is the run.
describe("the model at each position", () => {
  it("is the whole run at the last position, and never throws before it", () => {
    for (const [name, log] of Object.entries(fixtures)) {
      const whole = buildRun(log, payees, NOW);
      expect(buildRun(log.slice(0, log.length), payees, NOW), name).toEqual(whole);
      for (let position = 1; position <= log.length; position++) {
        const model = buildRun(log.slice(0, position), payees, NOW);
        expect(model.items.length, `${name} at ${position}`).toBeGreaterThan(0);
      }
    }
  });

  it("builds up: what was drawn stays drawn as the playhead moves on", () => {
    for (const [name, log] of Object.entries(fixtures)) {
      let seen = new Set<string>();
      for (let position = 1; position <= log.length; position++) {
        const model = buildRun(log.slice(0, position), payees, NOW);
        const drawn = new Set(model.items.map((i) => `${i.group}/${i.kind}`));
        for (const item of seen)
          expect(drawn.has(item), `${name} at ${position}: ${item}`).toBe(true);
        seen = drawn;
      }
    }
  });

  it("follows the money: held, then captured or voided, and an attacker paid only at the end", () => {
    const log = fixtures.attackerPaid;
    const states = log.map((_, i) => buildRun(log.slice(0, i + 1), payees, NOW).money);
    expect(states[0]?.state).toBe("none");
    expect(states.some((m) => m.state === "held")).toBe(true);
    const paidAt = states.findIndex((m) => m.paidToAttackerCents > 0);
    expect(paidAt).toBe(log.length - 1);
    expect(states.slice(0, paidAt).every((m) => m.paidToAttackerCents === 0)).toBe(true);
  });

  it("shows the passage Gate 1 copied from the moment it read the page, before its verdict", () => {
    const log = fixtures.escalated;
    const factsAt = log.findIndex((e) => e.type === "gate1_facts") + 1;
    const marked = (position: number) =>
      buildRun(log.slice(0, position), payees, NOW)
        .items.flatMap((i) => (i.kind === "served" ? i.pages : []))
        .flatMap((p) => p.blocks)
        .flatMap((b) => b.segments)
        .filter((s) => s.marked).length;
    expect(marked(factsAt - 1)).toBe(0);
    expect(marked(factsAt)).toBeGreaterThan(0);
    const verdictAt = log.findIndex((e) => e.lane === "gate1" && e.type === "verdict") + 1;
    expect(verdictAt).toBeGreaterThan(factsAt);
  });
});
