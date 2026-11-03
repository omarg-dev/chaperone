import { describe, expect, it } from "vitest";
import { escalated, run } from "../test-utils";
import { heldRightNow, type MoneyPlace, placeOf } from "./money";

const at = "2026-10-24T10:00:00Z";
const made = (overrides: Parameters<typeof run>[3]) =>
  run("run_x", "sc_b01", at, { heldCents: 10999, ...overrides });

describe("where a run's money is", () => {
  it("has no place before the agent has checked out", () => {
    expect(placeOf(run("r", "s", at))).toBeNull();
    expect(placeOf(run("r", "s", at, { verdict: "block", decidedBy: "review" }))).toBeNull();
  });

  it("holds an escalation for a person, and says it is waiting on them", () => {
    expect(placeOf(made({ ...escalated.waiting, reviews: ["full"] }))).toEqual({
      place: "held",
      cents: 10999,
      tone: "plain",
      note: "waiting on you",
      noteTone: "escalate",
    });
    expect(placeOf(made({ ...escalated.unfinished("approve") }))).toMatchObject({
      place: "held",
      note: "decision not finished",
    });
  });

  it("holds the money of a run whose review broke", () => {
    expect(placeOf(made({ reviewFailed: true, holdOpen: true }))).toMatchObject({
      place: "held",
      note: "review failed",
    });
  });

  it("moves the money to the store it was paid out to, by name", () => {
    expect(
      placeOf(made({ verdict: "approve", decidedBy: "review", paidTo: ["Larkspur Goods"] })),
    ).toEqual({
      place: "moved",
      cents: 10999,
      tone: "plain",
      note: "to Larkspur Goods",
      noteTone: "plain",
    });
    expect(
      placeOf(made({ decidedBy: "no_review", paidTo: ["Pinecrest Direct", "Northgate Supply"] })),
    ).toMatchObject({ note: "to Pinecrest Direct, Northgate Supply" });
  });

  it("marks money that reached an attacker, and nothing else, as the attacker's", () => {
    const paid = placeOf(made({ attackerPaid: true, paidTo: ["Keyhaven Direct"] }));
    expect(paid).toMatchObject({
      place: "moved",
      tone: "attacker",
      noteTone: "attacker",
      note: "to Keyhaven Direct",
    });
    expect(placeOf(made({ attackerPaid: true }))).toMatchObject({ note: "to an attacker" });
    expect(placeOf(made({ paidTo: ["Larkspur Goods"] }))?.tone).toBe("plain");
  });

  it("voids the money of a block and of a hold that was released", () => {
    expect(placeOf(made({ verdict: "block", decidedBy: "review" }))).toEqual({
      place: "voided",
      cents: 10999,
      tone: "voided",
      note: "voided",
      noteTone: "plain",
    });
    expect(placeOf(made({ ...escalated.released }))).toMatchObject({
      place: "voided",
      note: "released",
    });
    expect(placeOf(made({ ...escalated.decided("block") }))).toMatchObject({ place: "voided" });
  });

  it("keeps a hold that is still open held, even after a review", () => {
    expect(
      placeOf(made({ verdict: "approve", decidedBy: "review", holdOpen: true })),
    ).toMatchObject({ place: "held", note: "not settled yet" });
    expect(placeOf(made({ holdOpen: true }))).toMatchObject({
      place: "held",
      note: "not reviewed yet",
    });
  });

  it("puts every run's amount in exactly one place column", () => {
    const places = new Set<MoneyPlace>();
    const everyKind = [
      made({ ...escalated.waiting }),
      made({ reviewFailed: true, holdOpen: true }),
      made({ verdict: "approve", decidedBy: "review", paidTo: ["A"] }),
      made({ attackerPaid: true, paidTo: ["B"] }),
      made({ verdict: "block", decidedBy: "review" }),
      made({ ...escalated.released }),
      made({ decidedBy: "no_review", paidTo: ["C"] }),
      made({ verdict: "approve", decidedBy: "review" }),
    ];
    for (const one of everyKind) {
      const placed = placeOf(one);
      expect(placed, JSON.stringify(one)).not.toBeNull();
      // One place, one amount: the result is a single record, never an amount per column.
      expect(Object.keys(placed ?? {}).sort()).toEqual(
        ["cents", "note", "noteTone", "place", "tone"].sort(),
      );
      places.add(placed?.place as MoneyPlace);
    }
    expect([...places].sort()).toEqual(["held", "moved", "voided"]);
  });
});

describe("what is held right now", () => {
  const runs = [
    made({ ...escalated.waiting, heldCents: 10999 }),
    {
      ...made({ ...escalated.waiting, heldCents: 6199 }),
      runId: "r2",
      lastEventAt: "2026-10-23T08:00:00Z",
    },
    made({ verdict: "block", decidedBy: "review", heldCents: 13900 }),
    made({ verdict: "approve", decidedBy: "review", paidTo: ["A"], heldCents: 500 }),
    run("r5", "s", at),
  ];

  it("adds up the open holds, and counts the runs a person has to decide", () => {
    expect(heldRightNow(runs)).toMatchObject({ cents: 17198, holds: 2, waiting: 2 });
  });

  it("says since when the oldest waiting hold has been held", () => {
    expect(heldRightNow(runs).oldestWaitingAt).toBe("2026-10-23T08:00:00Z");
    expect(heldRightNow([runs[2] as (typeof runs)[number]])).toEqual({
      cents: 0,
      holds: 0,
      waiting: 0,
      oldestWaitingAt: null,
    });
  });

  it("counts a hold nobody can decide as held money, not as the person's work", () => {
    expect(heldRightNow([made({ reviewFailed: true, holdOpen: true })])).toMatchObject({
      cents: 10999,
      holds: 1,
      waiting: 0,
    });
  });
});
