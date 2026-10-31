import { describe, expect, it } from "vitest";
import { run } from "../test-utils";
import { confirmationText, decidedLabel, oldestFirst, recentlyDecided, waitingRuns } from "./inbox";

const held = (id: string, at: string) =>
  run(id, "sc_b01", at, { verdict: "escalate", decidedBy: "review" });
const decided = (id: string, at: string, verdict: "approve" | "block") =>
  run(id, "sc_b01", at, { verdict, decidedBy: "person" });

describe("what is waiting", () => {
  it("is every escalation nobody has decided, and nothing else", () => {
    const runs = [
      held("a", "2026-10-24T10:00:00Z"),
      run("b", "s", "2026-10-24T09:00:00Z", { verdict: "approve", decidedBy: "review" }),
      decided("c", "2026-10-24T08:00:00Z", "approve"),
      run("d", "s", "2026-10-24T07:00:00Z", { verdict: "block", decidedBy: "review" }),
      run("e", "s", "2026-10-24T06:00:00Z", { reviewFailed: true }),
      run("f", "s", "2026-10-24T05:00:00Z", { decidedBy: "no_review" }),
    ];
    expect(waitingRuns(runs).map((r) => r.runId)).toEqual(["a"]);
  });

  it("puts the hold that has waited longest first, by when it began where that is known", () => {
    const a = { run: held("a", "2026-10-24T10:00:00Z"), heldSince: null };
    const b = { run: held("b", "2026-10-24T09:00:00Z"), heldSince: null };
    // c was last written to later than a, but its hold began before both.
    const c = { run: held("c", "2026-10-24T11:00:00Z"), heldSince: "2026-10-24T08:00:00Z" };
    expect(oldestFirst([a, b, c]).map((i) => i.run.runId)).toEqual(["c", "b", "a"]);
  });

  it("orders runs that began together the same way every time", () => {
    const a = { run: held("a", "2026-10-24T10:00:00Z"), heldSince: null };
    const b = { run: held("b", "2026-10-24T10:00:00Z"), heldSince: null };
    expect(oldestFirst([b, a]).map((i) => i.run.runId)).toEqual(["a", "b"]);
    expect(oldestFirst([a, b]).map((i) => i.run.runId)).toEqual(["a", "b"]);
  });
});

describe("recently decided", () => {
  const runs = [
    decided("old", "2026-10-24T01:00:00Z", "approve"),
    held("held", "2026-10-24T12:00:00Z"),
    decided("new", "2026-10-24T11:00:00Z", "block"),
    run("review", "s", "2026-10-24T13:00:00Z", { verdict: "approve", decidedBy: "review" }),
    decided("mid", "2026-10-24T05:00:00Z", "approve"),
  ];

  it("is the runs a person decided, newest first, and no others", () => {
    expect(recentlyDecided(runs, new Set()).map((r) => r.runId)).toEqual(["new", "mid", "old"]);
  });

  it("stops at the limit, and leaves out what the page already shows", () => {
    expect(recentlyDecided(runs, new Set(), 2).map((r) => r.runId)).toEqual(["new", "mid"]);
    expect(recentlyDecided(runs, new Set(["new"])).map((r) => r.runId)).toEqual(["mid", "old"]);
  });

  it("says what the person decided: a reject reads as a block in the list", () => {
    expect(decidedLabel(decided("x", "2026-10-24T01:00:00Z", "approve"))).toBe("Approved");
    expect(decidedLabel(decided("x", "2026-10-24T01:00:00Z", "block"))).toBe("Rejected");
  });
});

describe("the confirmation", () => {
  const result = (money: "captured" | "voided" | "held") => ({
    status: "enforced" as const,
    money,
    decidedBy: "person" as const,
  });

  it("says what happened to the money, with the amount", () => {
    expect(confirmationText(result("captured"), 10999)).toBe(
      "Approved. $109.99 was captured and the seller paid.",
    );
    expect(confirmationText(result("voided"), 10999)).toBe(
      "Rejected. The hold on $109.99 was released and nobody was paid.",
    );
  });

  it("copes with an amount it doesn't know, and with a decision someone else made first", () => {
    expect(confirmationText(result("voided"), null)).toBe(
      "Rejected. The hold on the purchase was released and nobody was paid.",
    );
    expect(confirmationText(null, 10999)).toMatch(/already decided/);
  });

  it("doesn't say the money moved when the server says it is still held", () => {
    expect(confirmationText(result("held"), 10999)).toMatch(/hasn't moved/);
  });
});
