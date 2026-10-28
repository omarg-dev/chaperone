import { describe, expect, it } from "vitest";
import { run } from "../test-utils";
import { isHeldForPerson, noVerdictText, pillStateOf } from "./state";

const at = "2026-10-24T10:00:00Z";

describe("a run's state", () => {
  it("shows the verdict as a pill, and a broken review as held", () => {
    expect(pillStateOf(run("r", "s", at, { verdict: "block", decidedBy: "review" }))).toBe("block");
    expect(pillStateOf(run("r", "s", at, { reviewFailed: true }))).toBe("held");
    expect(pillStateOf(run("r", "s", at))).toBeNull();
  });

  it("says why there is no pill", () => {
    expect(noVerdictText(run("r", "s", at, { decidedBy: "no_review" }))).toBe("Firewall off");
    expect(noVerdictText(run("r", "s", at))).toBe("No review yet");
  });

  it("holds an escalation for the person until they decide it", () => {
    expect(isHeldForPerson(run("r", "s", at, { verdict: "escalate", decidedBy: "review" }))).toBe(
      true,
    );
    expect(isHeldForPerson(run("r", "s", at, { verdict: "approve", decidedBy: "person" }))).toBe(
      false,
    );
    expect(isHeldForPerson(run("r", "s", at, { verdict: "block", decidedBy: "review" }))).toBe(
      false,
    );
  });
});
