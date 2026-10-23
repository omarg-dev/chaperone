import { baseCatalog, type Catalog } from "@firewall/arena";
import { describe, expect, it } from "vitest";
import { type CatalogRecord, catalogRecord, crossCheck } from "./crosscheck.js";
import { type ListingFacts, NO_FACTS } from "./refine.js";

// Halvard TKL, sold by Larkspur Goods: a tactile, tenkeyless, wireless mechanical keyboard.
const HALVARD = "lst_keyboard_02_1";
const at = { sourceEventId: "ev_page", documentKind: "description" as const };
const facts = (over: Partial<ListingFacts>): ListingFacts => ({
  ...NO_FACTS,
  flags: [],
  quotesDropped: 0,
  valuesDropped: 0,
  ...over,
});
const record = catalogRecord(baseCatalog, HALVARD) as CatalogRecord;

describe("catalogRecord", () => {
  it("is the marketplace's own record of the listing", () => {
    expect(record).toMatchObject({
      listingId: HALVARD,
      category: "keyboard",
      brandId: "brand_northwick_labs",
      sellerId: "seller_larkspur_goods",
      attributes: { type: "mechanical", switch_feel: "tactile", layout: "tkl", wireless: true },
      coupons: [],
    });
  });

  it("is null for a listing the catalog doesn't have", () => {
    expect(catalogRecord(baseCatalog, "lst_nowhere")).toBeNull();
  });
});

describe("crossCheck", () => {
  it("finds nothing when the page agrees with the catalog or says nothing", () => {
    expect(crossCheck(facts({}), record)).toEqual([]);
    const agreeing = facts({
      category: { value: "keyboard", ...at },
      brand: { value: "brand_northwick_labs", ...at },
      seller: { value: "seller_larkspur_goods", ...at },
      attributes: [
        { attribute: "switch_feel", value: "tactile", ...at },
        { attribute: "wireless", value: true, ...at },
      ],
      prices: [{ kind: "selling_price", cents: record.priceCents, ...at }],
      urgency: [{ kind: "limited_stock", amount: record.stock + 3, quote: null, ...at }],
    });
    expect(crossCheck(agreeing, record)).toEqual([]);
  });

  it("flags a claimed attribute the catalog contradicts, with its evidence", () => {
    const linear = facts({ attributes: [{ attribute: "switch_feel", value: "linear", ...at }] });
    expect(crossCheck(linear, record)).toEqual([
      {
        field: "attribute",
        attribute: "switch_feel",
        claimed: "linear",
        catalog: "tactile",
        ...at,
      },
    ]);
  });

  it("leaves attributes of other categories to the category check", () => {
    const anc = facts({ attributes: [{ attribute: "anc", value: true, ...at }] });
    expect(crossCheck(anc, record)).toEqual([]);
  });

  it("flags a different category, brand or seller, and one the catalog doesn't list", () => {
    const wrong = facts({
      category: { value: "mouse", ...at },
      brand: { value: "unlisted_brand", ...at },
      seller: { value: "seller_ember_market", ...at },
    });
    expect(crossCheck(wrong, record).map((d) => [d.field, d.claimed, d.catalog])).toEqual([
      ["category", "mouse", "keyboard"],
      ["brand", "unlisted_brand", "brand_northwick_labs"],
      ["seller", "seller_ember_market", "seller_larkspur_goods"],
    ]);
  });

  it("allows a stated price within 5% of the catalog's (prices vary per seed), not beyond", () => {
    const near = facts({
      prices: [{ kind: "selling_price", cents: record.priceCents - 300, ...at }],
    });
    expect(crossCheck(near, record)).toEqual([]);
    const far = facts({ prices: [{ kind: "selling_price", cents: 8999, ...at }] });
    expect(crossCheck(far, record)).toMatchObject([{ field: "price", claimed: 8999 }]);
    const was = facts({ prices: [{ kind: "reference_price", cents: 19999, ...at }] });
    expect(crossCheck(was, record)).toEqual([]);
  });

  it("flags a stock claim lower than the catalog's stock", () => {
    const scarce = facts({ urgency: [{ kind: "limited_stock", amount: 2, quote: null, ...at }] });
    expect(crossCheck(scarce, record)).toMatchObject([
      { field: "stock", claimed: 2, catalog: record.stock },
    ]);
    const deadline = facts({ urgency: [{ kind: "deadline", amount: 2, quote: null, ...at }] });
    expect(crossCheck(deadline, record)).toEqual([]);
  });

  it("flags a discount code the catalog doesn't have, or a wrong percentage for one it does", () => {
    const withCoupon: Catalog = {
      ...baseCatalog,
      coupons: [{ code: "Welcome10", percentOff: 10, listingIds: [HALVARD] }],
    };
    const couponed = catalogRecord(withCoupon, HALVARD) as CatalogRecord;
    const codes = facts({
      discountCodes: [
        { code: "WELCOME10", percentOff: 10, ...at },
        { code: "WELCOME10", percentOff: 40, ...at },
        { code: "FLASH40", percentOff: 40, ...at },
      ],
    });
    expect(crossCheck(codes, couponed).map((d) => [d.claimed, d.catalog])).toEqual([
      [40, 10],
      ["FLASH40", null],
    ]);
  });

  it("flags every claimed required item, since the catalog requires none", () => {
    const required = facts({ requiredItems: [{ category: "other", quote: null, ...at }] });
    expect(crossCheck(required, record)).toMatchObject([
      { field: "required_item", claimed: "other", catalog: null },
    ]);
  });

  it("flags a listing the catalog doesn't have", () => {
    expect(crossCheck(facts({}), null)).toMatchObject([{ field: "listing" }]);
  });
});
