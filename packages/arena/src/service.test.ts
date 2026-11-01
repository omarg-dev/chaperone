import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ArenaService, createArenaService } from "./service.js";

let dir: string;
let log: EventLog;
let arena: ArenaService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arena-"));
  log = openEventLog({ path: join(dir, "events.db") });
  arena = createArenaService({ log, newRunId: () => "run_test" });
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("arena service", () => {
  it("starts a run with the person's request, marked as coming from the user", () => {
    const run = arena.start("sc_b01", "1");
    expect(run.runId).toBe("run_test");
    const [started] = log.listRun("run_test");
    expect(started).toMatchObject({
      lane: "arena",
      type: "run_started",
      provenance: "user",
      scenarioId: "sc_b01",
      payload: { seed: "1", request: run.scenario.request },
    });
  });

  it("records who started a run and which payment adapter holds its money, when told", () => {
    arena.start("sc_b01", "1", { origin: "web", payments: "fake" });
    const [started] = log.listRun("run_test");
    expect(started?.payload).toEqual({
      seed: "1",
      request: expect.any(String),
      origin: "web",
      payments: "fake",
    });
  });

  it("refuses a scenario that doesn't exist", () => {
    expect(() => arena.start("sc_nope", "1")).toThrow(/No scenario/);
  });

  it("records page reads as seller content and cart steps as catalog", () => {
    arena.start("sc_b01", "1");
    const [hit] = arena.search("run_test", { text: "tactile" });
    if (!hit) throw new Error("no search hits");
    arena.listing("run_test", hit.listingId);
    arena.reviews("run_test", hit.listingId);
    arena.addToCart("run_test", hit.listingId, 1);
    arena.checkout("run_test");
    expect(log.listRun("run_test").map((e) => [e.type, e.provenance])).toEqual([
      ["run_started", "user"],
      ["search", "seller_content"],
      ["listing_viewed", "seller_content"],
      ["reviews_viewed", "seller_content"],
      ["cart_updated", "catalog"],
      ["checkout", "catalog"],
    ]);
    expect(arena.get("run_test").order?.lines).toHaveLength(1);
  });

  it("links an arena event to the agent call that caused it", () => {
    arena.start("sc_b01", "1");
    const call = log.append({
      runId: "run_test",
      lane: "agent",
      type: "tool_call",
      provenance: "system",
    });
    arena.search("run_test", {}, { parentId: call.eventId });
    expect(log.listRun("run_test").at(-1)?.parentId).toBe(call.eventId);
  });

  it("records a failed call with its reason, then rethrows", () => {
    arena.start("sc_b01", "1");
    expect(() => arena.checkout("run_test")).toThrow(/empty/);
    expect(log.listRun("run_test").at(-1)).toMatchObject({
      type: "checkout_failed",
      payload: { error: "The cart is empty" },
    });
  });

  it("refuses a run that doesn't exist", () => {
    expect(() => arena.search("run_nope", {})).toThrow(/No run/);
  });
});
