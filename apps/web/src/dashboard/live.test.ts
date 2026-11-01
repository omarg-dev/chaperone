import { describe, expect, it } from "vitest";
import { escalated, run } from "../test-utils";
import { liveCounts, liveStats } from "./live";

const at = "2026-10-24T10:00:00Z";

describe("this server's runs", () => {
  const runs = [
    run("a", "sc_a01", at, { verdict: "block", decidedBy: "review" }),
    run("b", "sc_a02", at, { verdict: "block", decidedBy: "review" }),
    run("c", "sc_b01", at, { verdict: "approve", decidedBy: "review" }),
    run("d", "sc_a03", at, { verdict: "approve", decidedBy: "no_review", attackerPaid: true }),
    run("e", "sc_b02", at, escalated.waiting),
    run("f", "sc_b03", at, escalated.unfinished("approve")),
    run("g", "sc_b04", at, escalated.released),
    run("h", "sc_b05", at, escalated.decided("block")),
    run("i", "sc_b06", at),
  ];

  it("counts each run as one thing", () => {
    expect(liveCounts(runs)).toEqual({
      total: 9,
      // Waiting and unfinished: the same rule as the top bar's count.
      waiting: 2,
      attackerPaid: 1,
      blocked: 3,
      approved: 1,
      released: 1,
    });
  });

  it("counts nothing for no runs", () => {
    expect(liveCounts([])).toEqual({
      total: 0,
      waiting: 0,
      attackerPaid: 0,
      blocked: 0,
      approved: 0,
      released: 0,
    });
  });

  it("colours only what deserves it: red for an attacker paid, amber for a person waiting", () => {
    const tones = (counts: ReturnType<typeof liveCounts>) =>
      Object.fromEntries(liveStats(counts).map((s) => [s.key, s.tone]));
    expect(tones(liveCounts(runs))).toMatchObject({
      attackerPaid: "attacker",
      waiting: "escalate",
    });
    expect(
      tones(liveCounts([run("x", "sc_b01", at, { verdict: "block", decidedBy: "review" })])),
    ).toMatchObject({
      attackerPaid: "plain",
      waiting: "plain",
      blocked: "plain",
    });
  });

  it("links each number to the runs it counts", () => {
    expect(Object.fromEntries(liveStats(liveCounts(runs)).map((s) => [s.key, s.to]))).toEqual({
      total: "/runs",
      waiting: "/escalations",
      attackerPaid: "/runs?outcome=attacker_paid",
      blocked: "/runs?outcome=blocked",
      approved: "/runs?outcome=approved",
      released: "/runs?outcome=released",
    });
  });
});
