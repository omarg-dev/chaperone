import { describe, expect, it } from "vitest";
import type { Disagreement } from "./crosscheck.js";
import { type Flag, NO_FACTS } from "./refine.js";
import { CONFIDENCE, decideGate1, type ListingReview } from "./verdict.js";

const review = (over: Partial<ListingReview> & { flags?: Flag[] } = {}): ListingReview => {
  const { flags = [], ...rest } = over;
  return {
    listingId: "lst_a",
    inCart: true,
    sourceEventIds: ["ev_page_a"],
    extraction: { status: "extracted" },
    facts: { ...NO_FACTS, flags, quotesDropped: 0, valuesDropped: 0 },
    disagreements: [],
    ...rest,
  };
};
const flag = (kind: Flag["kind"], detectedBy: Flag["detectedBy"] = "extractor"): Flag => ({
  kind,
  detectedBy,
  quote: "seller words",
  sourceEventId: "ev_review",
  documentKind: "review",
});
const linear: Disagreement = {
  field: "attribute",
  attribute: "switch_feel",
  claimed: "tactile",
  catalog: "linear",
  sourceEventId: "ev_page_a",
  documentKind: "description",
};

describe("decideGate1", () => {
  it("approves when nothing was flagged and nothing disagrees", () => {
    const result = decideGate1([review(), review({ listingId: "lst_b", inCart: false })], "ev_co");
    expect(result).toMatchObject({
      gate: "gate1",
      verdict: "approve",
      confidence: CONFIDENCE.approved,
    });
    expect(result.evidenceEventIds).toEqual(["ev_co", "ev_page_a"]);
  });

  it("escalates on any flag on a listing in the cart, urgency included", () => {
    const result = decideGate1([review({ flags: [flag("urgency_pressure")] })], "ev_co");
    expect(result.verdict).toBe("escalate");
    expect(result.confidence).toBe(CONFIDENCE.flaggedByModel);
    expect(result.evidenceEventIds).toEqual(["ev_co", "ev_review"]);
  });

  it("escalates on a catalog disagreement on a listing in the cart, as surely as code can", () => {
    const result = decideGate1([review({ disagreements: [linear] })], "ev_co");
    expect(result).toMatchObject({ verdict: "escalate", confidence: CONFIDENCE.checkedByCode });
    expect(result.reasons).toEqual([
      "lst_a (in the cart): the page says switch_feel is tactile; the catalog says linear",
    ]);
  });

  it("escalates on a steering flag on a listing the agent opened but didn't buy", () => {
    const opened = review({
      listingId: "lst_b",
      inCart: false,
      flags: [flag("directs_purchase_elsewhere")],
    });
    const result = decideGate1([review(), opened], "ev_co");
    expect(result.verdict).toBe("escalate");
    expect(result.reasons[0]).toBe(
      "lst_b (opened, not bought): the page tells the reader to buy something else instead (flagged by the extractor)",
    );
  });

  it("only notes urgency and disagreements on a listing nobody is paying for", () => {
    const opened = review({
      listingId: "lst_b",
      inCart: false,
      flags: [flag("urgency_pressure")],
      disagreements: [linear],
    });
    const result = decideGate1([review(), opened], "ev_co");
    expect(result.verdict).toBe("approve");
    expect(result.reasons.slice(1)).toEqual([
      "Noted, not escalated: lst_b (opened, not bought): the page pushes the reader to buy now (flagged by the extractor)",
      "Noted, not escalated: lst_b (opened, not bought): the page says switch_feel is tactile; the catalog says linear",
    ]);
  });

  it("escalates when a page couldn't be read, in the cart or not", () => {
    for (const inCart of [true, false]) {
      const result = decideGate1(
        [review({ inCart, extraction: { status: "failed", code: "refused" } })],
        "ev_co",
      );
      expect(result).toMatchObject({ verdict: "escalate", confidence: CONFIDENCE.unreadable });
    }
  });

  it("is backed by code when a tripwire raised the flag", () => {
    const result = decideGate1(
      [review({ flags: [flag("imitates_system_text", "tripwire")] })],
      "ev_co",
    );
    expect(result.confidence).toBe(CONFIDENCE.checkedByCode);
    expect(result.reasons[0]).toContain("flagged by a tripwire");
  });

  it("never blocks, however much is wrong", () => {
    const everything = review({
      flags: [flag("addresses_assistant", "tripwire"), flag("claims_item_required")],
      disagreements: [linear],
      extraction: { status: "failed", code: "invalid_output" },
    });
    expect(decideGate1([everything], "ev_co").verdict).toBe("escalate");
  });

  it("writes its reasons from enum values and the catalog, never from a quote", () => {
    const result = decideGate1(
      [review({ flags: [flag("addresses_assistant"), flag("checkout_instructions")] })],
      "ev_co",
    );
    expect(result.reasons.join("\n")).not.toContain("seller words");
  });
});
