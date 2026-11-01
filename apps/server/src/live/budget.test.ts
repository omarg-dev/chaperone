import { describe, expect, it } from "vitest";
import { budgetAt, isSpent, type SpendRow } from "./budget.js";

const web = (startedAt: string, costUsd: number): SpendRow => ({
  startedAt,
  costUsd,
  origin: "web",
});
const NOW = new Date("2026-11-05T15:30:00.000Z");

describe("budgetAt", () => {
  it("counts only runs started from the web today, in UTC", () => {
    const budget = budgetAt(
      1,
      [
        web("2026-11-05T00:00:00.000Z", 0.25),
        web("2026-11-05T15:00:00.000Z", 0.1),
        // Yesterday's, by a second.
        web("2026-11-04T23:59:59.999Z", 0.5),
        // Tomorrow's cannot be spent yet, and isn't counted.
        web("2026-11-06T00:00:00.000Z", 0.5),
        // The eval and the command line spend from their own budget.
        { startedAt: "2026-11-05T10:00:00.000Z", costUsd: 0.9, origin: null },
        { startedAt: "2026-11-05T10:00:00.000Z", costUsd: 0.9, origin: "cli" },
      ],
      NOW,
    );
    expect(budget).toEqual({
      capUsd: 1,
      spentUsd: 0.35,
      remainingUsd: 0.65,
      agentRoomUsd: 0.64,
      exhausted: false,
      resetsAt: "2026-11-06T00:00:00.000Z",
    });
  });

  it("resets at UTC midnight, whatever the server's own zone says", () => {
    const rows = [web("2026-11-05T23:59:00.000Z", 0.8)];
    expect(budgetAt(1, rows, new Date("2026-11-05T23:59:59.000Z")).remainingUsd).toBe(0.2);
    expect(budgetAt(1, rows, new Date("2026-11-06T00:00:00.000Z")).remainingUsd).toBe(1);
  });

  it("sums to the micro-dollar, not to floating point's guess", () => {
    const rows = Array.from({ length: 30 }, () => web("2026-11-05T09:00:00.000Z", 0.0001));
    expect(budgetAt(1, rows, NOW).spentUsd).toBe(0.003);
  });

  it("never reports a negative remainder when a run overshoots the cap", () => {
    const budget = budgetAt(0.05, [web("2026-11-05T09:00:00.000Z", 0.06)], NOW);
    expect(budget.remainingUsd).toBe(0);
    expect(isSpent(budget)).toBe(true);
  });
});

describe("isSpent", () => {
  it("is true at exactly the cap, and once no more than a review's allowance is left", () => {
    const at = (spent: number) => budgetAt(1, [web("2026-11-05T09:00:00.000Z", spent)], NOW);
    expect(isSpent(at(0.98))).toBe(false);
    expect(at(0.98).agentRoomUsd).toBe(0.01);
    expect(isSpent(at(0.99))).toBe(true);
    expect(isSpent(at(1))).toBe(true);
    expect(isSpent(at(1.2))).toBe(true);
  });

  it("leaves the agent what the day has left, less the review's allowance", () => {
    const budget = budgetAt(1, [web("2026-11-05T09:00:00.000Z", 0.95)], NOW);
    expect(budget.remainingUsd).toBe(0.05);
    expect(budget.agentRoomUsd).toBe(0.04);
  });

  it("a cap of zero is spent before anything runs", () => {
    expect(isSpent(budgetAt(0, [], NOW))).toBe(true);
  });
});
