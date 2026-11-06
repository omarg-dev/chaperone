import { describe, expect, it } from "vitest";
import { run } from "../test-utils";
import {
  configLabel,
  configOf,
  isHeldForPerson,
  noVerdictText,
  OUTCOMES,
  outcomeOf,
  pillStateOf,
} from "./state";

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

  it("holds an escalation for the person while its hold is open and nobody has decided", () => {
    const waiting = run("r", "s", at, {
      verdict: "escalate",
      decidedBy: "review",
      holdOpen: true,
      escalation: "waiting",
    });
    expect(isHeldForPerson(waiting)).toBe(true);
    expect(isHeldForPerson(run("r", "s", at, { verdict: "approve", decidedBy: "review" }))).toBe(
      false,
    );
    expect(isHeldForPerson(run("r", "s", at, { verdict: "block", decidedBy: "review" }))).toBe(
      false,
    );
  });

  it("still holds a decision that wasn't carried out, and lets go of one that was", () => {
    const decided = { verdict: "approve", decidedBy: "person" } as const;
    expect(
      isHeldForPerson(run("r", "s", at, { ...decided, holdOpen: true, escalation: "unfinished" })),
    ).toBe(true);
    expect(isHeldForPerson(run("r", "s", at, { ...decided, escalation: "decided" }))).toBe(false);
  });

  it("does not hold an escalation whose hold was released with no decision", () => {
    const released = run("r", "s", at, {
      verdict: "escalate",
      decidedBy: "review",
      escalation: "released",
    });
    expect(isHeldForPerson(released)).toBe(false);
    expect(pillStateOf(released)).toBeNull();
    expect(noVerdictText(released)).toBe("Hold released");
  });

  it("shows an unfinished decision as an escalation, not as the verdict the person chose", () => {
    expect(
      pillStateOf(
        run("r", "s", at, {
          verdict: "approve",
          decidedBy: "person",
          holdOpen: true,
          escalation: "unfinished",
        }),
      ),
    ).toBe("escalate");
  });
});

describe("how a run ended", () => {
  const ended = (outcome: Parameters<typeof run>[3]) => outcomeOf(run("r", "s", at, outcome));

  it("is exactly one of the outcomes the history filters by", () => {
    expect(ended({ verdict: "approve", decidedBy: "review" })).toBe("approved");
    expect(ended({ verdict: "approve", decidedBy: "person" })).toBe("approved");
    expect(ended({ verdict: "block", decidedBy: "review" })).toBe("blocked");
    expect(ended({ verdict: "block", decidedBy: "person" })).toBe("blocked");
    expect(ended({ verdict: "escalate", decidedBy: "review", escalation: "waiting" })).toBe("held");
    expect(ended({ verdict: "approve", decidedBy: "person", escalation: "unfinished" })).toBe(
      "held",
    );
    expect(ended({ verdict: "escalate", decidedBy: "review", escalation: "released" })).toBe(
      "released",
    );
    expect(ended({ verdict: "block", decidedBy: "person", escalation: "decided" })).toBe("blocked");
    expect(ended({ decidedBy: "no_review" })).toBe("firewall_off");
    expect(ended({ reviewFailed: true })).toBe("review_failed");
    expect(ended({})).toBe("not_reviewed");
    expect(OUTCOMES).toContain(ended({ attackerPaid: true }));
  });

  it("puts money that reached an attacker first, however the run got there", () => {
    expect(ended({ attackerPaid: true, decidedBy: "no_review" })).toBe("attacker_paid");
    expect(ended({ attackerPaid: true, verdict: "approve", decidedBy: "review" })).toBe(
      "attacker_paid",
    );
    expect(pillStateOf(run("r", "s", at, { attackerPaid: true, decidedBy: "no_review" }))).toBe(
      "attacker",
    );
  });

  it("names the firewall setting of the last review, in words", () => {
    expect(configOf(run("r", "s", at, { reviews: ["off", "gate0", "full"] }))).toBe("full");
    expect(configOf(run("r", "s", at))).toBeNull();
    expect(configLabel("gate0")).toBe("Gate 0 only");
    expect(configLabel("something_new")).toBe("something_new");
  });
});
