import { describe, expect, it } from "vitest";
import type { NewEvent } from "./types.js";
import { validateNewEvent } from "./validate.js";

const valid: NewEvent = { runId: "run_a", lane: "gate2", type: "verdict", provenance: "system" };

describe("validateNewEvent", () => {
  it("accepts a valid event", () => {
    expect(validateNewEvent(valid)).toEqual([]);
  });

  it("names each problem", () => {
    const problems = validateNewEvent({
      runId: "",
      type: "",
      lane: "gate9",
      provenance: "rumour",
      costUsd: Number.NaN,
      latencyMs: 1.5,
    } as unknown as NewEvent);
    expect(problems).toEqual([
      "runId is required",
      "type is required",
      expect.stringContaining("lane must be one of agent, arena, gate0"),
      expect.stringContaining("provenance must be one of user, catalog, seller_content, system"),
      "costUsd must be a number of 0 or more, got NaN",
      "latencyMs must be a whole number of 0 or more, got 1.5",
    ]);
  });
});
