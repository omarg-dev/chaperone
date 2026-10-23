import type { AttributeValue, Catalog } from "@firewall/arena";
import type { BrandPolicy, Constraint, LockedMandate } from "@firewall/mandate";
import { type CatalogRecord, catalogRecord, NUMBER_TOLERANCE } from "./crosscheck.js";

// What Gate 2 knows about each cart line, worked out in code from the trusted catalog: what the
// line is, how it sits against the mandate, and what the same thing costs elsewhere in the
// marketplace. Pure: no model, no network, no event log.

// A checkout line's numbers, as the arena's checkout computed them. Never its title: that is the
// listing's page title, which the seller wrote.
export interface CheckoutLine {
  listingId: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
}

export interface CartLine extends CheckoutLine {
  // 1-based, in checkout order. The auditor names lines by this number.
  line: number;
  // What one unit actually costs after any discount, in cents.
  paidUnitCents: number;
  // The catalog's record of the listing, or null when the catalog has no such listing.
  record: CatalogRecord | null;
  brandReputable: boolean | null;
  sellerVerified: boolean | null;
}

export function cartLines(lines: readonly CheckoutLine[], catalog: Catalog): CartLine[] {
  return lines.map((l, i) => {
    const record = catalogRecord(catalog, l.listingId);
    return {
      ...l,
      line: i + 1,
      paidUnitCents: Math.round(l.totalCents / l.quantity),
      record,
      brandReputable: record
        ? (catalog.brands.find((b) => b.brandId === record.brandId)?.reputable ?? false)
        : null,
      sellerVerified: record
        ? (catalog.sellers.find((s) => s.sellerId === record.sellerId)?.verified ?? false)
        : null,
    };
  });
}

// How a line sits against the mandate, by the catalog. Gate 2 uses this only to check the
// auditor's judgement against the catalog (a block needs both to agree); the rules that act on
// these facts by themselves (required attributes, extras, brand policy) belong to Gate 0.
//  - requested: the category the mandate asks for;
//  - allowed_extra: a category the mandate allows alongside;
//  - unrequested: any other category;
//  - unknown: the catalog has no such listing.
export type LineRole = "requested" | "allowed_extra" | "unrequested" | "unknown";

export interface ConstraintFailure extends Constraint {
  // The catalog's value, or null when the product has no such attribute.
  actual: AttributeValue | null;
}

export interface MandateFit {
  role: LineRole;
  // The mandate's constraints this line's product fails, for a requested line. Empty otherwise.
  failedConstraints: ConstraintFailure[];
  brandAllowed: boolean | null;
}

export function satisfies(constraint: Constraint, actual: AttributeValue | undefined): boolean {
  if (actual === undefined) return false;
  if (constraint.op === "eq") return actual === constraint.value;
  if (typeof actual !== "number" || typeof constraint.value !== "number") return false;
  return constraint.op === "lte" ? actual <= constraint.value : actual >= constraint.value;
}

export function brandAllowed(policy: BrandPolicy, brandId: string, reputable: boolean): boolean {
  if (policy.blocked.includes(brandId)) return false;
  if (policy.mode === "listed_only") return policy.listed.includes(brandId);
  if (policy.mode === "any_reputable") return reputable;
  return true;
}

export function mandateFit(line: CartLine, mandate: LockedMandate): MandateFit {
  const record = line.record;
  if (!record) return { role: "unknown", failedConstraints: [], brandAllowed: null };
  const role: LineRole =
    record.category === mandate.category
      ? "requested"
      : (mandate.allowedExtras as string[]).includes(record.category)
        ? "allowed_extra"
        : "unrequested";
  const failedConstraints =
    role === "requested"
      ? mandate.constraints
          .filter((c) => !satisfies(c, record.attributes[c.attribute]))
          .map((c) => ({ ...c, actual: record.attributes[c.attribute] ?? null }))
      : [];
  return {
    role,
    failedConstraints,
    brandAllowed: brandAllowed(mandate.brandPolicy, record.brandId, line.brandReputable === true),
  };
}

// An offer the person could have bought instead: a listing in stock, from a verified seller, of a
// brand the mandate allows.
export interface Offer {
  listingId: string;
  sku: string;
  brandId: string;
  sellerId: string;
  priceCents: number;
}

// Two products are like for like when they are the same kind of thing with the same
// specification: same category, every attribute equal, numbers within the cross-check's rounding
// room. The same product sold by another store always is; so is an identical product under
// another brand the mandate allows.
export function sameSpecification(a: CatalogRecord, b: CatalogRecord): boolean {
  if (a.category !== b.category) return false;
  const keys = new Set([...Object.keys(a.attributes), ...Object.keys(b.attributes)]);
  for (const key of keys) {
    const x = a.attributes[key];
    const y = b.attributes[key];
    if (x === undefined || y === undefined) return false;
    if (typeof x === "number" && typeof y === "number") {
      if (Math.abs(x - y) > Math.abs(y) * NUMBER_TOLERANCE) return false;
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

export interface Comparables {
  // Like-for-like offers (the line's own listing included), cheapest first. The price rule
  // compares against these: the mandate's tolerance is how far above the best offer for the same
  // product a price may be.
  likeForLike: Offer[];
  best: Offer | null;
  // How far the line's paid unit price is above the best like-for-like offer, in percent, to one
  // decimal. Negative when a discount took it below. Null when there is nothing to compare with.
  pctAboveBest: number | null;
  tolerancePct: number;
  beyondTolerance: boolean;
  // Every offer that meets the mandate (its category, constraints and brand policy, at or under
  // its ceiling), whatever its specification. Context for the auditor, not a rule: a different
  // product that also meets the mandate can rightly cost less, and choosing between acceptable
  // products is the person's (or their agent's) call.
  meetingMandate: { offers: number; lowestCents: number | null; medianCents: number | null };
}

export function offersIn(
  catalog: Catalog,
  mandate: LockedMandate,
): (Offer & { record: CatalogRecord })[] {
  const brands = new Map(catalog.brands.map((b) => [b.brandId, b]));
  const sellers = new Map(catalog.sellers.map((s) => [s.sellerId, s]));
  return catalog.listings.flatMap((l) => {
    const record = catalogRecord(catalog, l.listingId);
    if (!record || l.stock < 1 || sellers.get(l.sellerId)?.verified !== true) return [];
    const reputable = brands.get(record.brandId)?.reputable === true;
    if (!brandAllowed(mandate.brandPolicy, record.brandId, reputable)) return [];
    return [
      {
        listingId: l.listingId,
        sku: l.sku,
        brandId: record.brandId,
        sellerId: l.sellerId,
        priceCents: l.priceCents,
        record,
      },
    ];
  });
}

export const percentAbove = (price: number, reference: number): number =>
  Math.round(((price - reference) / reference) * 1000) / 10;

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
};

export function comparablesFor(
  line: CartLine,
  mandate: LockedMandate,
  catalog: Catalog,
): Comparables | null {
  const record = line.record;
  if (!record) return null;
  const offers = offersIn(catalog, mandate);
  const strip = ({ record: _r, ...offer }: Offer & { record: CatalogRecord }): Offer => offer;
  const byPrice = (a: Offer, b: Offer) =>
    a.priceCents - b.priceCents || (a.listingId < b.listingId ? -1 : 1);

  const likeForLike = offers.filter((o) => sameSpecification(record, o.record)).map(strip);
  // The line's own listing counts even if the filters above left it out (an unverified seller, a
  // brand the mandate doesn't allow): it is still what the person is being charged for.
  if (!likeForLike.some((o) => o.listingId === line.listingId)) {
    likeForLike.push({
      listingId: line.listingId,
      sku: record.sku,
      brandId: record.brandId,
      sellerId: record.sellerId,
      priceCents: record.priceCents,
    });
  }
  likeForLike.sort(byPrice);
  const best = likeForLike[0] ?? null;
  const pctAboveBest = best ? percentAbove(line.paidUnitCents, best.priceCents) : null;
  const tolerancePct = mandate.tolerances.priceVsBestOfferPct;

  const meeting = offers
    .filter(
      (o) =>
        o.record.category === mandate.category &&
        o.priceCents <= mandate.maxUnitPriceCents &&
        mandate.constraints.every((c) => satisfies(c, o.record.attributes[c.attribute])),
    )
    .map((o) => o.priceCents);
  return {
    likeForLike,
    best,
    pctAboveBest,
    tolerancePct,
    beyondTolerance: pctAboveBest !== null && pctAboveBest > tolerancePct,
    meetingMandate: {
      offers: meeting.length,
      lowestCents: meeting.length > 0 ? Math.min(...meeting) : null,
      medianCents: median(meeting),
    },
  };
}
