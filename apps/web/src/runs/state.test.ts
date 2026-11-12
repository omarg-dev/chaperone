import { describe, expect, it } from "vitest";
import { escalated, run } from "../test-utils";
import {
  configLabel,
  configOf,
  isHeldForPerson,
  MONEY_OF_OUTCOME,
  moneyStateOf,
  OUTCOME_CHIP_ORDER,
  OUTCOMES,
  outcomeNote,
  outcomeOf,
  outcomeRank,
} from "./state";

const at = "2026-10-24T10:00:00Z";

describe("a run's state", () => {
  it("draws the verdict as a glyph, and a broken review as held", () => {
    expect(moneyStateOf(run("r", "s", at, { verdict: "block", decidedBy: "review" }))).toBe(
      "voided",
    );
    expect(moneyStateOf(run("r", "s", at, { reviewFailed: true }))).toBe("held");
    expect(moneyStateOf(run("r", "s", at))).toBe("none");
  });

  it("says who decided it, when that is worth saying", () => {
    expect(outcomeNote(run("r", "s", at, { decidedBy: "no_review" }))).toBe("Paid with no check");
    expect(outcomeNote(run("r", "s", at))).toBeNull();
    expect(outcomeNote(run("r", "s", at, { verdict: "approve", decidedBy: "review" }))).toBeNull();
    expect(outcomeNote(run("r", "s", at, { ...escalated.decided("approve") }))).toBe("You decided");
    expect(outcomeNote(run("r", "s", at, { ...escalated.decided("block") }))).toBe(
      "You rejected it",
    );
    expect(outcomeNote(run("r", "s", at, { reviewFailed: true }))).toBe("A check broke");
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
    expect(moneyStateOf(released)).toBe("released");
    expect(outcomeNote(released)).toBe("Nobody decided");
  });

  it("shows an unfinished decision as held for a person, not as the verdict they chose", () => {
    const unfinished = run("r", "s", at, {
      verdict: "approve",
      decidedBy: "person",
      holdOpen: true,
      escalation: "unfinished",
    });
    expect(moneyStateOf(unfinished)).toBe("person");
    expect(outcomeNote(unfinished)).toBe("Decision not finished");
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
    expect(moneyStateOf(run("r", "s", at, { attackerPaid: true, decidedBy: "no_review" }))).toBe(
      "attacker",
    );
  });

  it("names the firewall setting of the last review, in words", () => {
    expect(configOf(run("r", "s", at, { reviews: ["off", "gate0", "full"] }))).toBe("full");
    expect(configOf(run("r", "s", at))).toBeNull();
    expect(configLabel("gate0")).toBe("Rules only");
    expect(configLabel("full")).toBe("Full check");
    expect(configLabel("something_new")).toBe("something_new");
  });

  it("ranks every outcome, what needs an eye first", () => {
    const rank = (outcome: Parameters<typeof run>[3]) => outcomeRank(run("r", "s", at, outcome));
    const order = [
      rank({ attackerPaid: true }),
      rank({ ...escalated.waiting }),
      rank({ reviewFailed: true }),
      rank({ ...escalated.released }),
      rank({ verdict: "block", decidedBy: "review" }),
      rank({ verdict: "approve", decidedBy: "review" }),
      rank({ decidedBy: "no_review" }),
      rank({}),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(OUTCOMES.length);
  });
});

describe("a run's money-state glyph", () => {
  it("is one of the eight, for each of the eight outcomes", () => {
    expect(Object.keys(MONEY_OF_OUTCOME).sort()).toEqual([...OUTCOMES].sort());
    expect(MONEY_OF_OUTCOME).toEqual({
      approved: "captured",
      blocked: "voided",
      held: "person",
      released: "released",
      attacker_paid: "attacker",
      firewall_off: "off",
      review_failed: "held",
      not_reviewed: "none",
    });
  });

  it("follows the outcome, money that reached an attacker first", () => {
    expect(moneyStateOf(run("r", "s", at, { verdict: "approve", decidedBy: "review" }))).toBe(
      "captured",
    );
    expect(moneyStateOf(run("r", "s", at, { verdict: "block", decidedBy: "review" }))).toBe(
      "voided",
    );
    expect(moneyStateOf(run("r", "s", at, { ...escalated.waiting }))).toBe("person");
    expect(moneyStateOf(run("r", "s", at, { ...escalated.released }))).toBe("released");
    expect(moneyStateOf(run("r", "s", at, { decidedBy: "no_review" }))).toBe("off");
    expect(moneyStateOf(run("r", "s", at, { reviewFailed: true }))).toBe("held");
    expect(moneyStateOf(run("r", "s", at))).toBe("none");
    expect(
      moneyStateOf(
        run("r", "s", at, { attackerPaid: true, verdict: "approve", decidedBy: "review" }),
      ),
    ).toBe("attacker");
  });

  it("draws every outcome's chip once", () => {
    expect([...OUTCOME_CHIP_ORDER].sort()).toEqual([...OUTCOMES].sort());
  });
});
