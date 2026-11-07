import { describe, expect, it } from "vitest";
import type { Judgement, ReasonCode } from "./auditor.js";
import type { CartLine, Comparables, MandateFit } from "./comparables.js";
import {
  decideGate2,
  GATE2_CONFIDENCE,
  type LineReview,
  type MandateStatus,
} from "./gate2-verdict.js";
import type { MarketCheck, MarketQuote } from "./market.js";

// Gate 2's rule, on hand-built facts. No model, no catalog, no event log.

const intact: MandateStatus = { status: "intact", eventId: "ev_mandate" };
const evidence = {
  checkoutEventId: "ev_checkout",
  inputsEventId: "ev_inputs",
  marketEventId: "ev_market",
  judgementEventId: "ev_judgement",
  gate1VerdictEventId: "ev_gate1",
};
const REFS: Record<string, string> = { E1: "ev_checkout", E2: "ev_mandate", E6: "ev_page" };
const eventIdOf = (ref: string) => REFS[ref];

const unavailable: MarketQuote = {
  status: "unavailable",
  source: "channel3",
  query: "q",
  reason: "not_configured",
  detail: "",
  latencyMs: 0,
};

function line(
  n: number,
  overrides: {
    fit?: Partial<MandateFit>;
    pctAboveBest?: number;
    market?: MarketCheck;
    steering?: LineReview["steering"];
    category?: string;
  } = {},
): LineReview {
  const pct = overrides.pctAboveBest ?? 0;
  const cartLine = {
    line: n,
    listingId: `lst_${n}`,
    quantity: 1,
    unitPriceCents: 10000,
    discountCents: 0,
    totalCents: 10000,
    paidUnitCents: 10000,
    record: { category: overrides.category ?? "keyboard", brandId: "brand_x" },
    brandReputable: true,
    sellerVerified: true,
  } as unknown as CartLine;
  const comparables = {
    likeForLike: [],
    best: { listingId: "lst_best", sku: "s", brandId: "b", sellerId: "x", priceCents: 6000 },
    pctAboveBest: pct,
    tolerancePct: 15,
    beyondTolerance: pct > 15,
    meetingMandate: { offers: 3, lowestCents: 6000, medianCents: 8000 },
  } as Comparables;
  return {
    line: cartLine,
    fit: { role: "requested", failedConstraints: [], brandAllowed: true, ...overrides.fit },
    comparables,
    market: overrides.market ?? {
      quote: unavailable,
      pctAboveMedian: null,
    },
    steering: overrides.steering ?? [],
  };
}

const judged = (
  verdict: Judgement["verdict"],
  findings: [number, ReasonCode, string[]?][],
  confidence = 0.9,
): Judgement => ({
  verdict,
  confidence,
  explanation: "",
  findings: findings.map(([line, code, refs]) => ({
    line,
    code,
    evidence: (refs ?? ["E1"]) as never,
  })),
});

const decide = (
  lines: LineReview[],
  judgement: Judgement | null,
  mandate: MandateStatus = intact,
) =>
  decideGate2({
    mandate,
    lines,
    judgement,
    failure: judgement ? null : "api_error",
    eventIdOf,
    evidence,
  });
const summary = (d: ReturnType<typeof decide>) =>
  d.findings.map((f) => [f.line, f.code, f.by, f.verdict, f.confidence]);

const linear = {
  failedConstraints: [
    { attribute: "switch_feel", op: "eq" as const, value: "tactile", actual: "linear" },
  ],
};

describe("Gate 2's verdict", () => {
  it("approves when the catalog, the prices and the auditor all agree the cart matches", () => {
    const d = decide([line(1)], judged("approve", [[1, "matches_mandate"]]));
    expect(d.result.verdict).toBe("approve");
    expect(d.result.confidence).toBe(GATE2_CONFIDENCE.approved);
    expect(d.result.reasons[1]).toMatch(
      /no real-market price for line 1 \(channel3: not_configured\)/,
    );
  });

  it("blocks a run with no usable mandate, whatever else is true", () => {
    const missing = decide([line(1)], judged("approve", [[1, "matches_mandate"]]), {
      status: "missing",
      problems: [],
    });
    expect(missing.result.verdict).toBe("block");
    const altered = decide([], null, {
      status: "altered",
      eventId: "ev_mandate",
      problems: ["hash mismatch"],
    });
    expect(altered.result).toMatchObject({ verdict: "block", confidence: 1 });
    expect(altered.result.reasons[0]).toContain("(hash mismatch)");
  });

  describe("on price", () => {
    it("escalates beyond the tolerance with no market data, even when the auditor approved", () => {
      const d = decide(
        [line(1, { pctAboveBest: 40 })],
        judged("approve", [[1, "matches_mandate"]]),
      );
      expect(d.result.verdict).toBe("escalate");
      expect(summary(d)).toEqual([[1, "overpriced_vs_comparables", "code", "escalate", 1]]);
    });

    it("never blocks on price alone, even when the auditor says block", () => {
      const d = decide(
        [line(1, { pctAboveBest: 200 })],
        judged("block", [[1, "overpriced_vs_comparables"]]),
      );
      expect(d.result.verdict).toBe("escalate");
      expect(summary(d)).toEqual([
        [1, "overpriced_vs_comparables", "both", "escalate", 1],
        [null, "auditor_unsure", "auditor", "escalate", 0.7],
      ]);
    });

    it("approves a price far above the real market, and notes the quote (decided Nov 7)", () => {
      const quote: MarketQuote = {
        status: "available",
        source: "stand-in",
        query: "q",
        products: 9,
        pricedProducts: 8,
        lowCents: 3000,
        medianCents: 5000,
        highCents: 9000,
        latencyMs: 0,
      };
      const market = { quote, pctAboveMedian: 100 };
      const d = decide([line(1, { market })], judged("approve", [[1, "matches_mandate"]]));
      expect(d.result.verdict).toBe("approve");
      expect(summary(d)).toEqual([]);
      expect(d.result.reasons[1]).toBe(
        "Noted, not escalated: line 1 (lst_1): the real market sells this kind of product for 3000 cents to 9000 cents, median 5000 cents over 8 products (stand-in); this line is 100% above the median",
      );
      expect(d.result.evidenceEventIds).toContain("ev_market");
    });

    it("notes a line below the market median the same way", () => {
      const quote: MarketQuote = {
        status: "available",
        source: "stand-in",
        query: "q",
        products: 9,
        pricedProducts: 8,
        lowCents: 3000,
        medianCents: 5000,
        highCents: 9000,
        latencyMs: 0,
      };
      const d = decide(
        [line(1, { market: { quote, pctAboveMedian: -20 } })],
        judged("approve", [[1, "matches_mandate"]]),
      );
      expect(d.result.verdict).toBe("approve");
      expect(d.result.reasons[1]).toMatch(/this line is 20% below the median$/);
    });
  });

  describe("on whether it's the right product", () => {
    it("blocks when the auditor and the catalog agree a requirement is missing", () => {
      const d = decide(
        [line(1, { fit: linear })],
        judged("block", [[1, "attribute_mismatch", ["E1", "E2"]]]),
      );
      expect(d.result).toMatchObject({ verdict: "block", confidence: 1 });
      expect(summary(d)).toEqual([[1, "attribute_mismatch", "both", "block", 1]]);
      expect(d.result.reasons[0]).toContain(
        "its switch_feel is linear, where the mandate requires tactile",
      );
      expect(d.result.evidenceEventIds).toEqual(
        expect.arrayContaining(["ev_checkout", "ev_mandate", "ev_inputs", "ev_judgement"]),
      );
    });

    it("blocks a cart with nothing of the requested category, when the auditor says wrong product", () => {
      const d = decide(
        [line(1, { fit: { role: "unrequested" }, category: "mouse" })],
        judged("block", [[1, "wrong_product"]]),
      );
      expect(d.result.verdict).toBe("block");
    });

    it("only escalates a mismatch the catalog doesn't confirm", () => {
      const d = decide([line(1)], judged("block", [[1, "wrong_product"]]));
      expect(d.result.verdict).toBe("escalate");
      expect(summary(d)).toEqual([
        [1, "wrong_product", "auditor", "escalate", 0.7],
        [null, "auditor_unsure", "auditor", "escalate", 0.7],
      ]);
    });

    it("escalates when the auditor calls a line fine that the catalog says isn't", () => {
      const d = decide([line(1, { fit: linear })], judged("approve", [[1, "matches_mandate"]]));
      expect(summary(d)).toEqual([[1, "attribute_mismatch", "code", "escalate", 1]]);
      expect(d.result.reasons[0]).toContain("the auditor didn't judge it a mismatch");
    });

    it("doesn't block on the catalog alone when there is no judgement", () => {
      const d = decide([line(1, { fit: linear })], null);
      expect(d.result.verdict).toBe("escalate");
      expect(summary(d)).toEqual([
        [1, "attribute_mismatch", "code", "escalate", 1],
        [null, "auditor_unsure", "code", "escalate", 0.5],
      ]);
    });
  });

  describe("on extras, brands and steering", () => {
    it("escalates, never blocks, an unrequested item next to the requested one", () => {
      const d = decide(
        [line(1), line(2, { fit: { role: "unrequested" }, category: "mouse" })],
        judged("block", [
          [1, "matches_mandate"],
          [2, "wrong_product"],
          [2, "unrequested_item"],
        ]),
      );
      expect(d.result.verdict).toBe("escalate");
      expect(summary(d)).toEqual([
        [2, "wrong_product", "auditor", "escalate", 0.7],
        [2, "unrequested_item", "both", "escalate", 1],
        [null, "auditor_unsure", "auditor", "escalate", 0.7],
      ]);
    });

    it("lets an allowed extra through", () => {
      const d = decide(
        [line(1), line(2, { fit: { role: "allowed_extra" }, category: "mouse" })],
        judged("approve", [
          [1, "matches_mandate"],
          [2, "matches_mandate"],
        ]),
      );
      expect(d.result.verdict).toBe("approve");
    });

    it("escalates a brand the policy rules out, and a brand concern only the auditor has", () => {
      const ruledOut = decide(
        [line(1, { fit: { brandAllowed: false } })],
        judged("approve", [[1, "matches_mandate"]]),
      );
      expect(summary(ruledOut)).toEqual([[1, "brand_concern", "code", "escalate", 1]]);
      const auditorOnly = decide([line(1)], judged("escalate", [[1, "brand_concern"]]));
      expect(summary(auditorOnly)).toEqual([[1, "brand_concern", "auditor", "escalate", 0.7]]);
    });

    it("escalates a line Gate 1 flagged as steering, even when the auditor approved", () => {
      const d = decide(
        [line(1, { steering: [{ kind: "claims_item_required", sourceEventId: "ev_page" }] })],
        judged("approve", [[1, "matches_mandate"]]),
      );
      expect(summary(d)).toEqual([[1, "steered_by_seller_content", "code", "escalate", 1]]);
      expect(d.result.evidenceEventIds).toEqual(expect.arrayContaining(["ev_page", "ev_gate1"]));
    });
  });

  describe("on an unsure or missing judgement", () => {
    it("escalates an approval below the confidence floor", () => {
      const d = decide([line(1)], judged("approve", [[1, "matches_mandate"]], 0.4));
      expect(summary(d)).toEqual([[null, "auditor_unsure", "auditor", "escalate", 0.5]]);
    });

    it("escalates a line the auditor gave no finding for", () => {
      const d = decide([line(1), line(2)], judged("approve", [[1, "matches_mandate"]]));
      expect(summary(d)).toEqual([[2, "auditor_unsure", "auditor", "escalate", 0.5]]);
    });

    it("escalates when the auditor asks for the person with no concern named", () => {
      const d = decide([line(1)], judged("escalate", [[1, "matches_mandate"]]));
      expect(summary(d)).toEqual([[null, "auditor_unsure", "auditor", "escalate", 0.7]]);
    });

    it("escalates when there is no judgement at all", () => {
      const d = decide([line(1)], null);
      expect(d.result).toMatchObject({ verdict: "escalate", confidence: 0.5 });
      expect(d.result.reasons[0]).toContain("couldn't judge the cart (api_error)");
    });

    it("drops refs the auditor cited that don't exist", () => {
      const d = decide([line(1)], judged("escalate", [[1, "brand_concern", ["E1", "E99"]]]));
      expect(d.findings[0]?.eventIds).toEqual(["ev_checkout", "ev_inputs"]);
    });
  });
});
