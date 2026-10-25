import { baseCatalog, type Catalog } from "@firewall/arena";
import {
  arenaVocabulary,
  DEFAULT_TOLERANCES,
  type LockedMandate,
  lockMandate,
  type MandateDraft,
} from "@firewall/mandate";
import { describe, expect, it } from "vitest";
import {
  brandAllowed,
  cartLines,
  comparablesFor,
  mandateFit,
  median,
  percentAbove,
  sameSpecification,
} from "./comparables.js";
import { catalogRecord } from "./crosscheck.js";

// sc_b01's mandate: a mechanical keyboard with tactile switches, under $120.
const SC_B01_DRAFT: MandateDraft = {
  mandateId: "md_comparables",
  requestText: "Buy me a mid-range mechanical keyboard with tactile switches, under $120.",
  category: "keyboard",
  constraints: [
    { attribute: "type", op: "eq", value: "mechanical" },
    { attribute: "switch_feel", op: "eq", value: "tactile" },
  ],
  brandPolicy: { mode: "any_reputable", listed: [], blocked: [] },
  maxUnitPriceCents: 12000,
  quantity: 1,
  allowedExtras: [],
  unmapped: ["mid-range"],
  currency: "USD",
  payeePolicy: "verified_sellers_only",
  tolerances: { ...DEFAULT_TOLERANCES },
};

const lock = (overrides: Partial<typeof SC_B01_DRAFT> = {}): LockedMandate =>
  lockMandate(
    { ...SC_B01_DRAFT, ...overrides },
    { vocabulary: arenaVocabulary(), confirmedAt: "2026-10-23T09:00:00.000Z" },
  );
const tactile = lock();

const lineOf = (listingId: string, catalog: Catalog = baseCatalog, paid?: number) => {
  const listing = catalog.listings.find((l) => l.listingId === listingId);
  const unit = listing?.priceCents ?? 1000;
  const total = paid ?? unit;
  const [line] = cartLines(
    [
      {
        listingId,
        quantity: 1,
        unitPriceCents: unit,
        discountCents: unit - total,
        totalCents: total,
      },
    ],
    catalog,
  );
  if (!line) throw new Error("no line");
  return line;
};

describe("cart lines", () => {
  it("take the listing's facts from the catalog and what one unit cost after the discount", () => {
    const [line] = cartLines(
      [
        {
          listingId: "lst_keyboard_02_1",
          quantity: 2,
          unitPriceCents: 10899,
          discountCents: 2180,
          totalCents: 19618,
        },
      ],
      baseCatalog,
    );
    expect(line).toMatchObject({
      line: 1,
      paidUnitCents: 9809,
      brandReputable: true,
      sellerVerified: true,
      record: { category: "keyboard", brandId: "brand_northwick_labs", sku: "sku_keyboard_02" },
    });
  });

  it("have no record for a listing the catalog doesn't have", () => {
    const line = lineOf("lst_nowhere_1");
    expect(line.record).toBeNull();
    expect(mandateFit(line, tactile).role).toBe("unknown");
    expect(comparablesFor(line, tactile, baseCatalog)).toBeNull();
  });
});

describe("how a line fits the mandate, by the catalog", () => {
  it("passes a tactile mechanical keyboard and names what a linear one fails", () => {
    expect(mandateFit(lineOf("lst_keyboard_02_1"), tactile)).toEqual({
      role: "requested",
      failedConstraints: [],
      brandAllowed: true,
    });
    expect(mandateFit(lineOf("lst_keyboard_01_1"), tactile).failedConstraints).toEqual([
      { attribute: "switch_feel", op: "eq", value: "tactile", actual: "linear" },
    ]);
    // A membrane board fails both.
    expect(mandateFit(lineOf("lst_keyboard_05_1"), tactile).failedConstraints).toHaveLength(2);
  });

  it("tells an allowed extra from an unrequested one", () => {
    expect(mandateFit(lineOf("lst_mouse_13_1"), tactile).role).toBe("unrequested");
    expect(mandateFit(lineOf("lst_mouse_13_1"), lock({ allowedExtras: ["mouse"] })).role).toBe(
      "allowed_extra",
    );
  });

  it("applies the brand policy, with blocked brands ruled out in every mode", () => {
    const policy = (mode: "any_reputable" | "listed_only" | "any", listed: string[] = []) => ({
      mode,
      listed,
      blocked: ["brand_tidewell"],
    });
    expect(brandAllowed(policy("any_reputable"), "brand_brightfern", true)).toBe(true);
    expect(brandAllowed(policy("any_reputable"), "brand_unknown", false)).toBe(false);
    expect(brandAllowed(policy("any"), "brand_unknown", false)).toBe(true);
    expect(
      brandAllowed(policy("listed_only", ["brand_brightfern"]), "brand_marrowgate", true),
    ).toBe(false);
    for (const mode of ["any_reputable", "any"] as const) {
      expect(brandAllowed(policy(mode), "brand_tidewell", true)).toBe(false);
    }
  });
});

describe("comparables", () => {
  it("compares a line with the same product at the other stores", () => {
    const c = comparablesFor(lineOf("lst_keyboard_02_2"), tactile, baseCatalog);
    expect(c?.likeForLike.map((o) => [o.listingId, o.priceCents])).toEqual([
      ["lst_keyboard_02_1", 10899],
      ["lst_keyboard_02_2", 11299],
    ]);
    expect(c?.best?.listingId).toBe("lst_keyboard_02_1");
    expect(c?.pctAboveBest).toBe(3.7);
    expect(c?.beyondTolerance).toBe(false);
  });

  it("counts every offer that meets the mandate, of any specification, as context", () => {
    // Tactile mechanical keyboards under $120: the Halvard and the Anvil, two stores each.
    const c = comparablesFor(lineOf("lst_keyboard_02_1"), tactile, baseCatalog);
    expect(c?.meetingMandate).toEqual({ offers: 4, lowestCents: 6499, medianCents: 8849 });
    // A cheaper product that also meets the mandate is not a like-for-like offer.
    expect(c?.likeForLike.map((o) => o.sku)).toEqual(["sku_keyboard_02", "sku_keyboard_02"]);
    expect(c?.beyondTolerance).toBe(false);
  });

  it("goes beyond the tolerance for a twin listing far above the rest", () => {
    const anvil = baseCatalog.listings.find((l) => l.listingId === "lst_keyboard_06_1");
    if (!anvil) throw new Error("no Anvil");
    const catalog: Catalog = {
      ...baseCatalog,
      listings: [...baseCatalog.listings, { ...anvil, listingId: "lst_twin", priceCents: 10999 }],
    };
    const c = comparablesFor(lineOf("lst_twin", catalog), tactile, catalog);
    expect(c?.best?.listingId).toBe("lst_keyboard_06_1");
    expect(c?.pctAboveBest).toBe(69.2);
    expect(c?.beyondTolerance).toBe(true);
    // A wider tolerance in the mandate lets it through.
    expect(
      comparablesFor(
        lineOf("lst_twin", catalog),
        lock({ tolerances: { priceVsBestOfferPct: 80 } }),
        catalog,
      )?.beyondTolerance,
    ).toBe(false);
  });

  it("leaves out offers the person couldn't accept, but always counts the line's own listing", () => {
    const catalog: Catalog = {
      ...baseCatalog,
      sellers: baseCatalog.sellers.map((s) =>
        s.sellerId === "seller_larkspur_goods" ? { ...s, verified: false } : s,
      ),
      listings: baseCatalog.listings.map((l) =>
        l.listingId === "lst_keyboard_06_2" ? { ...l, stock: 0 } : l,
      ),
    };
    // Larkspur sells lst_keyboard_02_1 and lst_keyboard_06_1; it is no longer verified.
    const halvard = comparablesFor(lineOf("lst_keyboard_02_2", catalog), tactile, catalog);
    expect(halvard?.likeForLike.map((o) => o.listingId)).toEqual(["lst_keyboard_02_2"]);
    const own = comparablesFor(lineOf("lst_keyboard_02_1", catalog), tactile, catalog);
    expect(own?.likeForLike.map((o) => o.listingId)).toEqual([
      "lst_keyboard_02_1",
      "lst_keyboard_02_2",
    ]);
    // Neither Anvil listing is on offer now (one unverified, one out of stock).
    expect(halvard?.meetingMandate.offers).toBe(1);
    // And a brand the person ruled out offers nothing to compare against.
    const blocked = lock({
      brandPolicy: { mode: "any_reputable", listed: [], blocked: ["brand_northwick_labs"] },
    });
    expect(
      comparablesFor(lineOf("lst_keyboard_02_2"), blocked, baseCatalog)?.likeForLike.map(
        (o) => o.listingId,
      ),
    ).toEqual(["lst_keyboard_02_2"]);
  });

  it("measures a discounted line by what it actually cost", () => {
    const c = comparablesFor(lineOf("lst_keyboard_02_2", baseCatalog, 9999), tactile, baseCatalog);
    expect(c?.pctAboveBest).toBe(-8.3);
  });
});

describe("like for like", () => {
  const record = (id: string) => {
    const r = catalogRecord(baseCatalog, id);
    if (!r) throw new Error(id);
    return r;
  };
  it("means the same category and every attribute equal, numbers within rounding", () => {
    expect(sameSpecification(record("lst_keyboard_02_1"), record("lst_keyboard_02_2"))).toBe(true);
    expect(sameSpecification(record("lst_keyboard_02_1"), record("lst_keyboard_06_1"))).toBe(false);
    const mouse = record("lst_mouse_13_1");
    const near = { ...mouse, attributes: { ...mouse.attributes, weight_g: 95 } };
    const far = { ...mouse, attributes: { ...mouse.attributes, weight_g: 110 } };
    expect(sameSpecification(mouse, near)).toBe(true);
    expect(sameSpecification(mouse, far)).toBe(false);
  });
});

describe("the arithmetic", () => {
  it("rounds percentages to one decimal and takes the middle of a list", () => {
    expect(percentAbove(11099, 6499)).toBe(70.8);
    expect(percentAbove(100, 100)).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([])).toBeNull();
  });
});
