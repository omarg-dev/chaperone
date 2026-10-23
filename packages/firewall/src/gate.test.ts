import { describe, expect, it } from "vitest";
import { combineVerdicts, endsReview } from "./gate.js";

describe("combineVerdicts", () => {
  it("approves only when every gate approves", () => {
    expect(combineVerdicts([])).toBe("approve");
    expect(combineVerdicts([{ verdict: "approve" }, { verdict: "approve" }])).toBe("approve");
  });

  it("escalates when any gate escalates and none blocks", () => {
    expect(combineVerdicts([{ verdict: "approve" }, { verdict: "escalate" }])).toBe("escalate");
  });

  it("blocks when any gate blocks, whatever the others said", () => {
    expect(
      combineVerdicts([{ verdict: "escalate" }, { verdict: "block" }, { verdict: "approve" }]),
    ).toBe("block");
  });
});

describe("endsReview", () => {
  it("is true only for a block", () => {
    expect(endsReview({ verdict: "block" })).toBe(true);
    expect(endsReview({ verdict: "escalate" })).toBe(false);
    expect(endsReview({ verdict: "approve" })).toBe(false);
  });
});
