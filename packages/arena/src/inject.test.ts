import { describe, expect, it } from "vitest";
import { baseCatalog } from "./catalog/index.js";
import {
  extendCatalog,
  insertQuestion,
  insertReview,
  nextListingId,
  nextSku,
  ninetyNine,
} from "./inject.js";
import type { Listing, Product, Seller } from "./types.js";

const store: Seller = {
  sellerId: "seller_test_store",
  name: "Test Store",
  payeeKey: "attacker_1",
  verified: false,
  role: "attacker",
};
const brand = { brandId: "brand_test", name: "Test", reputable: false };
const product: Product = {
  sku: "sku_mouse_19",
  brandId: "brand_test",
  name: "Test Mouse",
  category: "mouse",
  attributes: { wireless: true, dpi: 1000, weight_g: 80 },
  basePriceCents: 999,
  description: "",
};
const listing: Listing = {
  listingId: "lst_mouse_19_1",
  sku: "sku_mouse_19",
  sellerId: "seller_test_store",
  priceCents: 999,
  stock: 1,
  page: { title: "", description: "", reviews: [], qa: [] },
};
const halvard = "lst_keyboard_02_1";

describe("extendCatalog", () => {
  it("adds brands, sellers, products and listings, leaving the original alone", () => {
    const before = structuredClone(baseCatalog);
    const extended = extendCatalog(baseCatalog, {
      brands: [brand],
      sellers: [store],
      products: [product],
      listings: [listing],
    });
    expect(baseCatalog).toEqual(before);
    expect(extended.sellers.at(-1)).toEqual(store);
    expect(extended.listings.at(-1)).toEqual(listing);
    expect(extended.listings).toHaveLength(baseCatalog.listings.length + 1);
  });

  it("refuses a duplicate ID", () => {
    const [honest] = baseCatalog.sellers;
    expect(() => extendCatalog(baseCatalog, { sellers: [honest as Seller] })).toThrow(/Duplicate/);
  });

  it("refuses a listing or product that names something missing", () => {
    expect(() => extendCatalog(baseCatalog, { listings: [listing] })).toThrow(/no product/);
    expect(() => extendCatalog(baseCatalog, { products: [product], listings: [listing] })).toThrow(
      /no brand/,
    );
    expect(() =>
      extendCatalog(baseCatalog, { brands: [brand], products: [product], listings: [listing] }),
    ).toThrow(/no seller/);
  });
});

describe("insertReview and insertQuestion", () => {
  const review = { author: "A. B.", rating: 2 as const, text: "Injected" };

  it("puts a review at the given position with the next ID in the listing's sequence", () => {
    const before = structuredClone(baseCatalog);
    const catalog = insertReview(baseCatalog, halvard, review, 1);
    const reviews = catalog.listings.find((l) => l.listingId === halvard)?.page.reviews ?? [];
    expect(reviews).toHaveLength(4);
    expect(reviews[1]).toEqual({ reviewId: "rev_keyboard_02_4", ...review });
    expect(baseCatalog).toEqual(before);
  });

  it("clamps the position to the list", () => {
    const catalog = insertReview(baseCatalog, halvard, review, 99);
    expect(catalog.listings.find((l) => l.listingId === halvard)?.page.reviews.at(-1)?.text).toBe(
      "Injected",
    );
  });

  it("touches only the listing it names", () => {
    const catalog = insertQuestion(baseCatalog, halvard, { question: "Q?", answer: "A." }, 0);
    const changed = catalog.listings.filter(
      (l, i) => JSON.stringify(l) !== JSON.stringify(baseCatalog.listings[i]),
    );
    expect(changed.map((l) => l.listingId)).toEqual([halvard]);
    expect(changed[0]?.page.qa).toEqual([{ question: "Q?", answer: "A." }]);
  });

  it("refuses an unknown listing", () => {
    expect(() => insertReview(baseCatalog, "lst_nope", review, 0)).toThrow(/No listing/);
  });
});

describe("IDs and prices", () => {
  it("continues the base catalog's numbering", () => {
    expect(nextSku(baseCatalog, "accessory")).toBe("sku_accessory_19");
    expect(nextListingId(baseCatalog, "sku_keyboard_02")).toBe("lst_keyboard_02_3");
    expect(nextListingId(baseCatalog, "sku_keyboard_19")).toBe("lst_keyboard_19_1");
  });

  it("rounds prices to .99", () => {
    expect(ninetyNine(4321)).toBe(4299);
    expect(ninetyNine(4389)).toBe(4399);
    expect(ninetyNine(10)).toBe(99);
  });
});
