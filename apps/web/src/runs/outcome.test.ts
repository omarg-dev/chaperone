import { describe, expect, it } from "vitest";
import type { RunEvent } from "../api";
import { isOpenEscalation, outcomeOf, pillStateOf } from "./outcome";

const event = (lane: string, type: string, payload: unknown): RunEvent => ({
  eventId: `${lane}_${type}`,
  lane,
  type,
  payload,
});

describe("outcomeOf", () => {
  it("says no review yet for a run nobody reviewed", () => {
    expect(outcomeOf([event("arena", "search", {})])).toEqual({ kind: "none" });
  });

  it("reads the review's verdict", () => {
    const outcome = outcomeOf([event("review", "review_finished", { verdict: "block" })]);
    expect(outcome).toEqual({ kind: "verdict", verdict: "block", decidedByPerson: false });
    expect(pillStateOf(outcome)).toBe("block");
  });

  it("reads a null verdict as the firewall being off", () => {
    expect(outcomeOf([event("review", "review_finished", { verdict: null })])).toEqual({
      kind: "off",
    });
  });

  it("holds the order when the review failed", () => {
    const outcome = outcomeOf([event("review", "review_failed", { error: "boom" })]);
    expect(pillStateOf(outcome)).toBe("held");
  });

  it("lets a person's decision settle an escalation, and only an escalation", () => {
    const escalated = event("review", "review_finished", { verdict: "escalate" });
    const open = outcomeOf([escalated]);
    expect(isOpenEscalation(open)).toBe(true);

    const decided = outcomeOf([
      escalated,
      event("human", "human_decision", { decision: "approve" }),
    ]);
    expect(decided).toEqual({ kind: "verdict", verdict: "approve", decidedByPerson: true });
    expect(isOpenEscalation(decided)).toBe(false);

    const blocked = outcomeOf([
      event("review", "review_finished", { verdict: "block" }),
      event("human", "human_decision", { decision: "approve" }),
    ]);
    expect(blocked).toMatchObject({ verdict: "block", decidedByPerson: false });
  });
});
