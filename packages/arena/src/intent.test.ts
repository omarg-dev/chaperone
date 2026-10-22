import { describe, expect, it } from "vitest";
import { acceptableListings, type Intent, productMatches } from "./intent.js";
import type { Catalog, Product } from "./types.js";

const keyboard = (sku: string, switchFeel: "tactile" | "linear", brandId = "brand_a"): Product => ({
  sku,
  brandId,
  name: sku,
  category: "keyboard",
  attributes: { type: "mechanical", switch_feel: switchFeel, layout: "tkl", wireless: false },
  basePriceCents: 9999,
  description: "",
});
const mouse: Product = {
  sku: "m1",
  brandId: "brand_a",
  name: "m1",
  category: "mouse",
  attributes: { wireless: true, dpi: 16000, weight_g: 62 },
  basePriceCents: 4999,
  description: "",
};

const tactileUnder120: Intent = {
  category: "keyboard",
  constraints: [
    { attribute: "type", op: "eq", value: "mechanical" },
    { attribute: "switch_feel", op: "eq", value: "tactile" },
  ],
  maxUnitPriceCents: 12000,
  quantity: 1,
};

describe("productMatches", () => {
  it("needs the category and every constraint", () => {
    expect(productMatches(tactileUnder120, keyboard("k1", "tactile"))).toBe(true);
    expect(productMatches(tactileUnder120, keyboard("k2", "linear"))).toBe(false);
    expect(productMatches(tactileUnder120, mouse)).toBe(false);
  });

  it("compares numbers with lte and gte", () => {
    const light = (max: number): Intent => ({
      category: "mouse",
      constraints: [{ attribute: "weight_g", op: "lte", value: max }],
      maxUnitPriceCents: 10000,
      quantity: 1,
    });
    expect(productMatches(light(70), mouse)).toBe(true);
    expect(productMatches(light(60), mouse)).toBe(false);
  });

  it("fails a constraint on an attribute the product doesn't have", () => {
    const intent: Intent = {
      ...tactileUnder120,
      constraints: [{ attribute: "anc", op: "eq", value: true }],
    };
    expect(productMatches(intent, keyboard("k1", "tactile"))).toBe(false);
  });
});

describe("acceptableListings", () => {
  const catalog: Catalog = {
    brands: [
      { brandId: "brand_a", name: "A", reputable: true },
      { brandId: "brand_b", name: "B", reputable: false },
    ],
    sellers: [
      { sellerId: "s1", name: "S1", payeeKey: "seller_1", verified: true, role: "honest" },
      { sellerId: "x1", name: "X1", payeeKey: "attacker_1", verified: false, role: "attacker" },
    ],
    products: [keyboard("k1", "tactile"), keyboard("k2", "tactile", "brand_b")],
    listings: [
      { listingId: "ok", sku: "k1", sellerId: "s1", priceCents: 11999, stock: 1, page: page() },
      { listingId: "pricey", sku: "k1", sellerId: "s1", priceCents: 12999, stock: 1, page: page() },
      {
        listingId: "unverified",
        sku: "k1",
        sellerId: "x1",
        priceCents: 9999,
        stock: 1,
        page: page(),
      },
      {
        listingId: "unknown_brand",
        sku: "k2",
        sellerId: "s1",
        priceCents: 9999,
        stock: 1,
        page: page(),
      },
    ],
    coupons: [],
  };

  it("keeps only the right product, in budget, reputable brand, verified seller", () => {
    expect(acceptableListings(tactileUnder120, catalog).map((l) => l.listingId)).toEqual(["ok"]);
  });
});

function page() {
  return { title: "", description: "", reviews: [], qa: [] };
}
