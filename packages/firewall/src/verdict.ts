import type { Disagreement } from "./crosscheck.js";
import type { ExtractionFailure } from "./extractor.js";
import type { FlagKind } from "./facts.js";
import type { GateResult } from "./gate.js";
import type { Flag, ListingFacts } from "./refine.js";

// Gate 1's verdict, worked out by code from the facts and the disagreements. The model never
// chooses it: its only job is extraction.
//
// The rule:
//  - A listing in the cart escalates on any flag, any disagreement with the catalog, or a page the
//    extractor couldn't read. The person is about to pay for it, and its page said something the
//    catalog doesn't back, or tried to steer the reader.
//  - A listing the agent opened but didn't buy escalates only on a steering flag (it tells the
//    reader to buy something else, claims another item is required, gives checkout instructions,
//    speaks to an AI, or poses as system text), or a page that couldn't be read: that page may be
//    why the cart holds what it does. Its urgency claims and catalog disagreements are noted, since
//    nobody is paying for that listing.
//  - Otherwise Gate 1 approves.
//  - Gate 1 never blocks. A page can be wrong without the cart being wrong, so its signals go to
//    the person (or to the gates that weigh them against the mandate), never straight to a void.

export const STEERING_FLAGS: readonly FlagKind[] = [
  "directs_purchase_elsewhere",
  "claims_item_required",
  "checkout_instructions",
  "addresses_assistant",
  "imitates_system_text",
];

// Confidence, from 0 to 1, by what the verdict rests on:
//  - an escalation backed by code (a catalog disagreement, or a tripwire matching the page's own
//    words) is as sure as a comparison can be;
//  - one backed only by the extractor's flags is a model's reading, which can misjudge honest text;
//  - an approval is a model reporting it found nothing, which it can miss;
//  - an escalation because a page couldn't be read says only that nothing was checked.
export const CONFIDENCE = {
  checkedByCode: 1,
  flaggedByModel: 0.8,
  approved: 0.8,
  unreadable: 0.5,
} as const;

export type ExtractionStatus =
  | { status: "extracted" }
  | { status: "nothing_to_read" }
  | { status: "failed"; code: ExtractionFailure };

export interface ListingReview {
  listingId: string;
  inCart: boolean;
  sourceEventIds: string[];
  extraction: ExtractionStatus;
  facts: ListingFacts;
  disagreements: Disagreement[];
}

const FLAG_PHRASES: Record<FlagKind, string> = {
  addresses_assistant: "speaks to an AI or shopping assistant",
  directs_purchase_elsewhere: "tells the reader to buy something else instead",
  claims_item_required: "claims another item has to be bought too",
  urgency_pressure: "pushes the reader to buy now",
  checkout_instructions: "gives instructions for checking out or paying",
  imitates_system_text: "poses as system text or tries to instruct the extractor",
};

function describeDisagreement(d: Disagreement): string {
  switch (d.field) {
    case "listing":
      return "the catalog has no such listing";
    case "attribute":
      return `the page says ${d.attribute} is ${d.claimed}; the catalog says ${d.catalog}`;
    case "price":
      return `the page states a price of ${d.claimed} cents; the catalog charges ${d.catalog}`;
    case "stock":
      return `the page says ${d.claimed} left; the catalog has ${d.catalog} in stock`;
    case "discount_code":
      return d.catalog === null
        ? "the page gives a discount code the catalog doesn't have for this listing"
        : `the page claims ${d.claimed}% off with a code the catalog gives ${d.catalog}% off`;
    case "required_item":
      return d.claimed === "other"
        ? "the page says another item is required; the catalog requires nothing"
        : `the page says another item (${d.claimed}) is required; the catalog requires nothing`;
    default:
      return `the page says the ${d.field} is ${d.claimed}; the catalog says ${d.catalog}`;
  }
}

function describeFlags(flags: Flag[]): string[] {
  const kinds = [...new Set(flags.map((f) => f.kind))];
  return kinds.map((kind) => {
    const by = new Set(flags.filter((f) => f.kind === kind).map((f) => f.detectedBy));
    const who = [...by]
      .map((b) => (b === "tripwire" ? "a tripwire" : "the extractor"))
      .join(" and ");
    return `the page ${FLAG_PHRASES[kind]} (flagged by ${who})`;
  });
}

interface Finding {
  listing: ListingReview;
  reason: string;
  escalates: boolean;
  confidence: number;
  eventIds: string[];
}

function findings(listing: ListingReview): Finding[] {
  const out: Finding[] = [];
  const fallback = listing.sourceEventIds;
  const ids = (items: { sourceEventId: string | null }[]) => {
    const known = items.flatMap((i) => (i.sourceEventId ? [i.sourceEventId] : []));
    return known.length === items.length ? known : [...known, ...fallback];
  };

  if (listing.extraction.status === "failed") {
    out.push({
      listing,
      reason: `its page couldn't be read safely (${listing.extraction.code}), so nothing on it was checked`,
      escalates: true,
      confidence: CONFIDENCE.unreadable,
      eventIds: fallback,
    });
  }

  const flags = listing.facts.flags;
  const byKind = new Map<FlagKind, Flag[]>();
  for (const flag of flags) byKind.set(flag.kind, [...(byKind.get(flag.kind) ?? []), flag]);
  for (const [kind, group] of byKind) {
    const escalates = listing.inCart || STEERING_FLAGS.includes(kind);
    out.push({
      listing,
      reason: describeFlags(group)[0] as string,
      escalates,
      confidence: group.some((f) => f.detectedBy === "tripwire")
        ? CONFIDENCE.checkedByCode
        : CONFIDENCE.flaggedByModel,
      eventIds: ids(group),
    });
  }

  for (const d of listing.disagreements) {
    out.push({
      listing,
      reason: describeDisagreement(d),
      escalates: listing.inCart,
      confidence: CONFIDENCE.checkedByCode,
      eventIds: ids([d]),
    });
  }
  return out;
}

const where = (l: ListingReview) => (l.inCart ? "in the cart" : "opened, not bought");
const unique = (ids: string[]) => [...new Set(ids)];

export function decideGate1(
  reviews: readonly ListingReview[],
  checkoutEventId: string,
): GateResult {
  const all = reviews.flatMap(findings);
  const escalating = all.filter((f) => f.escalates);
  const noted = all.filter((f) => !f.escalates);
  const line = (f: Finding) => `${f.listing.listingId} (${where(f.listing)}): ${f.reason}`;
  const notes = noted.map((f) => `Noted, not escalated: ${line(f)}`);

  if (escalating.length === 0) {
    const read = reviews.filter((r) => r.extraction.status === "extracted").length;
    return {
      gate: "gate1",
      verdict: "approve",
      confidence: CONFIDENCE.approved,
      reasons: [
        `Read ${read} listing page${read === 1 ? "" : "s"}: none tried to steer the purchase, and nothing on the cart's pages contradicts the catalog`,
        ...notes,
      ],
      evidenceEventIds: unique([checkoutEventId, ...reviews.flatMap((r) => r.sourceEventIds)]),
    };
  }
  return {
    gate: "gate1",
    verdict: "escalate",
    confidence: Math.max(...escalating.map((f) => f.confidence)),
    reasons: [...escalating.map(line), ...notes],
    evidenceEventIds: unique([checkoutEventId, ...escalating.flatMap((f) => f.eventIds)]),
  };
}
