import { describe, expect, it } from "vitest";
import { baseCatalog } from "./index.js";

const { brands, sellers, products, listings } = baseCatalog;

describe("base catalog", () => {
  it("has unique IDs", () => {
    for (const ids of [
      brands.map((b) => b.brandId),
      sellers.map((s) => s.sellerId),
      products.map((p) => p.sku),
      listings.map((l) => l.listingId),
      listings.flatMap((l) => l.page.reviews.map((r) => `${l.listingId}/${r.reviewId}`)),
    ]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("only refers to brands, products and sellers that exist", () => {
    const brandIds = new Set(brands.map((b) => b.brandId));
    const skus = new Set(products.map((p) => p.sku));
    const sellerIds = new Set(sellers.map((s) => s.sellerId));
    expect(products.filter((p) => !brandIds.has(p.brandId))).toEqual([]);
    expect(listings.filter((l) => !skus.has(l.sku) || !sellerIds.has(l.sellerId))).toEqual([]);
  });

  it("sells six products per category, every product from two or three stores", () => {
    for (const category of ["keyboard", "headphones", "mouse"]) {
      expect(products.filter((p) => p.category === category)).toHaveLength(6);
    }
    for (const product of products) {
      const count = listings.filter((l) => l.sku === product.sku).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("has only honest, verified stores, each on its own sandbox account", () => {
    expect(sellers.every((s) => s.role === "honest" && s.verified)).toBe(true);
    expect(sellers.map((s) => s.payeeKey)).toEqual([
      "seller_1",
      "seller_2",
      "seller_3",
      "seller_4",
    ]);
  });

  it("prices every listing in whole cents ending in .99", () => {
    for (const listing of listings) {
      expect(Number.isInteger(listing.priceCents)).toBe(true);
      expect(listing.priceCents % 100).toBe(99);
    }
  });
});
