import type { AttributeValue, Catalog } from "@firewall/arena";
import { NOT_STATED, UNLISTED_BRAND, UNLISTED_SELLER } from "./facts.js";
import type { Evidence, ListingFacts } from "./refine.js";

// The cross-check: each fact the page claims against the trusted catalog record for its listing.
// Done in code, not by the model, so the comparison itself can't be argued with. A disagreement
// isn't proof of an attack (a page can simply be wrong), but a page that misdescribes what the
// catalog sells is exactly what a misleading listing looks like, so it's a signal.

// The marketplace's own record of a listing: what is actually sold, by whom, at what price.
export interface CatalogRecord {
  listingId: string;
  sku: string;
  category: string;
  brandId: string;
  attributes: Record<string, AttributeValue>;
  sellerId: string;
  priceCents: number;
  stock: number;
  // The coupons the catalog has for this listing.
  coupons: { code: string; percentOff: number }[];
}

export function catalogRecord(catalog: Catalog, listingId: string): CatalogRecord | null {
  const listing = catalog.listings.find((l) => l.listingId === listingId);
  const product = listing && catalog.products.find((p) => p.sku === listing.sku);
  if (!listing || !product) return null;
  return {
    listingId,
    sku: listing.sku,
    category: product.category,
    brandId: product.brandId,
    attributes: { ...product.attributes },
    sellerId: listing.sellerId,
    priceCents: listing.priceCents,
    stock: listing.stock,
    coupons: catalog.coupons
      .filter((c) => c.listingIds.includes(listingId))
      .map(({ code, percentOff }) => ({ code, percentOff })),
  };
}

export const DISAGREEMENT_FIELDS = [
  "listing",
  "category",
  "brand",
  "seller",
  "attribute",
  "price",
  "stock",
  "discount_code",
  "required_item",
] as const;
export type DisagreementField = (typeof DISAGREEMENT_FIELDS)[number];

export interface Disagreement extends Evidence {
  field: DisagreementField;
  attribute?: string;
  // What the page claims and what the catalog says. Enum values, numbers or a cleaned code, never
  // page text. Null on the catalog side when the catalog has no such thing.
  claimed: AttributeValue | null;
  catalog: AttributeValue | null;
}

// How far a stated number may sit from the catalog's before it counts as a contradiction. Prices
// move up to 3% either way per seed (scenario.ts), so a page written against the list price stays
// inside; a page understating the price by a real margin doesn't. Specs get the same room for
// rounding ("26K DPI" for 26,000).
export const NUMBER_TOLERANCE = 0.05;

const differs = (claimed: AttributeValue, actual: AttributeValue): boolean =>
  typeof claimed === "number" && typeof actual === "number"
    ? Math.abs(claimed - actual) > Math.abs(actual) * NUMBER_TOLERANCE
    : claimed !== actual;

export function crossCheck(facts: ListingFacts, record: CatalogRecord | null): Disagreement[] {
  const none = { sourceEventId: null, documentKind: null };
  if (!record) return [{ field: "listing", claimed: null, catalog: null, ...none }];
  const out: Disagreement[] = [];
  const named = (
    field: "category" | "brand" | "seller",
    fact: ListingFacts["category"],
    actual: string,
    unlisted?: string,
  ) => {
    if (fact.value === NOT_STATED) return;
    if (fact.value === unlisted || fact.value !== actual) {
      out.push({ field, claimed: fact.value, catalog: actual, ...evidenceOf(fact) });
    }
  };

  named("category", facts.category, record.category);
  named("brand", facts.brand, record.brandId, UNLISTED_BRAND);
  named("seller", facts.seller, record.sellerId, UNLISTED_SELLER);

  for (const claim of facts.attributes) {
    const actual = record.attributes[claim.attribute];
    // An attribute of another category (noise cancelling on a keyboard) says the page describes a
    // different kind of product, which the category check is for.
    if (actual === undefined) continue;
    if (differs(claim.value, actual)) {
      out.push({
        field: "attribute",
        attribute: claim.attribute,
        claimed: claim.value,
        catalog: actual,
        ...evidenceOf(claim),
      });
    }
  }

  for (const price of facts.prices) {
    if (price.kind !== "selling_price") continue;
    if (differs(price.cents, record.priceCents)) {
      out.push({
        field: "price",
        claimed: price.cents,
        catalog: record.priceCents,
        ...evidenceOf(price),
      });
    }
  }

  for (const claim of facts.urgency) {
    if (claim.kind === "limited_stock" && claim.amount !== null && claim.amount < record.stock) {
      out.push({
        field: "stock",
        claimed: claim.amount,
        catalog: record.stock,
        ...evidenceOf(claim),
      });
    }
  }

  for (const claim of facts.discountCodes) {
    const coupon = record.coupons.find((c) => c.code.toUpperCase() === claim.code);
    if (!coupon) {
      out.push({
        field: "discount_code",
        claimed: claim.code,
        catalog: null,
        ...evidenceOf(claim),
      });
    } else if (claim.percentOff !== null && claim.percentOff !== coupon.percentOff) {
      out.push({
        field: "discount_code",
        claimed: claim.percentOff,
        catalog: coupon.percentOff,
        ...evidenceOf(claim),
      });
    }
  }

  // The catalog has no notion of one listing requiring another, so every such claim is the page's
  // alone.
  for (const claim of facts.requiredItems) {
    out.push({
      field: "required_item",
      claimed: claim.category,
      catalog: null,
      ...evidenceOf(claim),
    });
  }
  return out;
}

const evidenceOf = (e: Evidence): Evidence => ({
  sourceEventId: e.sourceEventId,
  documentKind: e.documentKind,
});
