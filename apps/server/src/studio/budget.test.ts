import type { SpendRow } from "@firewall/events";
import { describe, expect, it } from "vitest";
import { fits, isStudioSpent, spentOf, studioBudgetAt, worstCaseUsd } from "./budget.js";

let seq = 0;
const row = (
  kind: SpendRow["kind"],
  callId: string,
  costUsd: number,
  ts = "2026-11-10T08:00:00.000Z",
): SpendRow => ({
  seq: ++seq,
  purpose: "studio_ai",
  callId,
  kind,
  ts,
  costUsd,
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  error: null,
});

const now = new Date("2026-11-10T09:00:00.000Z");

describe("the dashboard assistant's budget", () => {
  it("prices a call's worst case at the input rate and the full output cap", () => {
    // 10,000 tokens at $0.10 per million, 2,048 out at $0.50 per million.
    expect(worstCaseUsd(10_000)).toBeCloseTo(0.001 + 0.001024, 9);
  });

  it("counts settled calls at their cost and unsettled ones at their worst case", () => {
    expect(
      spentOf([row("reserve", "a", 0.002), row("settle", "a", 0.0005), row("reserve", "b", 0.003)]),
    ).toBeCloseTo(0.0035, 9);
  });

  it("counts only today's rows, and says when the day starts again", () => {
    const budget = studioBudgetAt(
      0.1,
      [row("settle", "y", 0.05, "2026-11-09T23:59:59.000Z"), row("settle", "t", 0.02)],
      now,
    );
    expect(budget).toEqual({
      capUsd: 0.1,
      spentUsd: 0.02,
      remainingUsd: 0.08,
      resetsAt: "2026-11-11T00:00:00.000Z",
    });
  });

  it("lets a call through only when its worst case fits under the cap", () => {
    const budget = studioBudgetAt(0.01, [row("settle", "a", 0.008)], now);
    expect(fits(budget, 0.002)).toBe(true);
    expect(fits(budget, 0.0021)).toBe(false);
    expect(isStudioSpent(budget)).toBe(false);
    expect(isStudioSpent(studioBudgetAt(0.01, [row("settle", "a", 0.0095)], now))).toBe(true);
    // A cap of zero is the assistant off for the day.
    expect(isStudioSpent(studioBudgetAt(0, [], now))).toBe(true);
  });
});
