import type { AttributeValue } from "@firewall/arena";
import type { Disagreement } from "./crosscheck.js";
import type { FlagKind, PriceKind, UrgencyKind } from "./facts.js";
import type { GateResult } from "./gate.js";
import type { ExtractionStatus, ListingReview } from "./verdict.js";

// What the gates that judge the purchase (Gate 2 and Gate 3) may learn from Gate 1. The design
// rule of the review tree is that they never see raw seller content, so this keeps only what code
// produced or checked: enum values, numbers, event IDs, and a coupon code only when it is one the
// catalog has. Quotes stay in Gate 1's events, as evidence for the person reading the review;
// they are seller text, and a short string is still long enough to carry an instruction. Pinned by
// test_reviewers_never_see_raw_seller_content.
//
// The same goes for the rest of the event log. The arena's checkout event holds only catalog data
// (each order line is named by the catalog's product name, not the listing's page title), and a
// later gate still takes the order's catalog facts from catalogRecord.

export interface ReviewerListingFacts {
  listingId: string;
  inCart: boolean;
  extraction: ExtractionStatus["status"];
  claims: {
    category: string;
    brand: string;
    seller: string;
    attributes: { attribute: string; value: AttributeValue }[];
    prices: { kind: PriceKind; cents: number }[];
    requiredItemCategories: string[];
    urgency: { kind: UrgencyKind; amount: number | null }[];
    // A code the catalog has for this listing is catalog data; any other is the page's own text,
    // and only its existence is passed on.
    catalogCouponCodes: string[];
    otherDiscountCodes: number;
  };
  flags: { kind: FlagKind; detectedBy: "extractor" | "tripwire"; sourceEventId: string | null }[];
  disagreements: Omit<Disagreement, "documentKind">[];
}

export interface ReviewerView {
  result: GateResult;
  listings: ReviewerListingFacts[];
}

export function factsForReviewers(
  result: GateResult,
  reviews: readonly ListingReview[],
): ReviewerView {
  return {
    result,
    listings: reviews.map((r) => {
      const unknownCodes = new Set(
        r.disagreements
          .filter((d) => d.field === "discount_code" && d.catalog === null)
          .map((d) => d.claimed),
      );
      return {
        listingId: r.listingId,
        inCart: r.inCart,
        extraction: r.extraction.status,
        claims: {
          category: r.facts.category.value,
          brand: r.facts.brand.value,
          seller: r.facts.seller.value,
          attributes: r.facts.attributes.map(({ attribute, value }) => ({ attribute, value })),
          prices: r.facts.prices.map(({ kind, cents }) => ({ kind, cents })),
          requiredItemCategories: r.facts.requiredItems.map((i) => i.category),
          urgency: r.facts.urgency.map(({ kind, amount }) => ({ kind, amount })),
          catalogCouponCodes: r.facts.discountCodes
            .map((d) => d.code)
            .filter((code) => !unknownCodes.has(code)),
          otherDiscountCodes: r.facts.discountCodes.filter((d) => unknownCodes.has(d.code)).length,
        },
        flags: r.facts.flags.map(({ kind, detectedBy, sourceEventId }) => ({
          kind,
          detectedBy,
          sourceEventId,
        })),
        disagreements: r.disagreements.map(({ documentKind: _kind, ...d }) =>
          d.field === "discount_code" && d.catalog === null ? { ...d, claimed: null } : d,
        ),
      };
    }),
  };
}
