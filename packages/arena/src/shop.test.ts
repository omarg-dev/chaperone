import { describe, expect, it } from "vitest";
import { baseCatalog } from "./catalog/index.js";
import { buildArena } from "./scenario.js";
import { BENIGN_SCENARIOS } from "./scenarios/benign.js";
import {
  addToCart,
  applyCoupon,
  checkout,
  emptyCart,
  removeFromCart,
  reviews,
  ShopError,
  search,
  viewListing,
} from "./shop.js";
import type { Catalog } from "./types.js";

const scenario = BENIGN_SCENARIOS[0];
if (!scenario) throw new Error("No benign scenarios");

// A base arena plus one coupon on the first keyboard listing.
const withCoupon: Catalog = {
  ...baseCatalog,
  coupons: [{ code: "SAVE10", percentOff: 10, listingIds: ["lst_keyboard_01_1"] }],
};
const arena = buildArena(scenario, "1", withCoupon);
const listingId = "lst_keyboard_01_1";

describe("search", () => {
  it("returns every listing when there's no query, in the seeded order", () => {
    expect(search(arena, {}).map((h) => h.listingId)).toEqual(arena.searchOrder);
  });

  it("filters by category and price", () => {
    const hits = search(arena, { category: "mouse", maxPriceCents: 5000 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.category === "mouse" && h.priceCents <= 5000)).toBe(true);
  });

  const skuOf = (listingId: string) =>
    arena.catalog.listings.find((l) => l.listingId === listingId)?.sku;

  it("matches words in titles, descriptions and specs, best matches first", () => {
    const hits = search(arena, { text: "tactile keyboard" });
    expect(hits.every((h) => h.category === "keyboard")).toBe(true);
    // The two tactile keyboards have four listings between them; matching both words puts them
    // ahead of the keyboards that only match "keyboard".
    const top = new Set(hits.slice(0, 4).map((h) => skuOf(h.listingId)));
    expect(top).toEqual(new Set(["sku_keyboard_02", "sku_keyboard_06"]));
  });

  it("matches specs written with spaces", () => {
    // Three over-ear models, seven listings; "over_ear" in the specs matches "over ear".
    const top = new Set(
      search(arena, { text: "over ear" })
        .slice(0, 7)
        .map((h) => skuOf(h.listingId)),
    );
    expect(top).toEqual(new Set(["sku_headphones_09", "sku_headphones_10", "sku_headphones_11"]));
  });

  it("finds nothing for words no listing has", () => {
    expect(search(arena, { text: "toaster" })).toEqual([]);
  });

  it("summarises ratings", () => {
    const hit = search(arena, {}).find((h) => h.listingId === listingId);
    expect(hit?.reviewCount).toBeGreaterThan(0);
    expect(hit?.rating).toBeGreaterThanOrEqual(1);
  });
});

describe("listings and reviews", () => {
  it("shows the catalog and page layers apart, without the reviews", () => {
    const view = viewListing(arena, listingId);
    expect(view.catalog.sku).toBe("sku_keyboard_01");
    expect(view.catalog.attributes).toHaveProperty("switch_feel");
    expect(view.page).not.toHaveProperty("reviews");
  });

  it("serves reviews separately", () => {
    expect(reviews(arena, listingId).length).toBeGreaterThan(0);
  });

  it("refuses an unknown listing", () => {
    expect(() => viewListing(arena, "lst_nope")).toThrow(ShopError);
  });
});

describe("cart and checkout", () => {
  it("adds, merges quantities and removes", () => {
    let cart = addToCart(arena, emptyCart(), listingId, 1);
    cart = addToCart(arena, cart, listingId, 2);
    expect(cart.lines).toEqual([{ listingId, quantity: 3, couponCode: null }]);
    expect(removeFromCart(cart, listingId).lines).toEqual([]);
  });

  it("refuses bad quantities and more than the stock", () => {
    expect(() => addToCart(arena, emptyCart(), listingId, 0)).toThrow(/Quantity/);
    expect(() => addToCart(arena, emptyCart(), listingId, 1000)).toThrow(/in stock/);
  });

  it("applies a coupon to the lines it names, ignoring case", () => {
    const cart = addToCart(arena, emptyCart(), listingId, 1);
    expect(applyCoupon(arena, cart, "save10").cart.lines[0]?.couponCode).toBe("SAVE10");
  });

  it("refuses a coupon that doesn't exist or doesn't apply", () => {
    const other = addToCart(arena, emptyCart(), "lst_mouse_13_1", 1);
    expect(() => applyCoupon(arena, other, "SAVE10")).toThrow(/doesn't apply/);
    expect(() => applyCoupon(arena, other, "FREE")).toThrow(/No coupon/);
  });

  it("checks out with the payee from the catalog and the discount applied", () => {
    const cart = applyCoupon(arena, addToCart(arena, emptyCart(), listingId, 2), "SAVE10").cart;
    const order = checkout(arena, cart);
    const price = viewListing(arena, listingId).catalog.priceCents;
    const discount = Math.round((price * 2 * 10) / 100);
    expect(order).toMatchObject({
      currency: "USD",
      totalCents: price * 2 - discount,
      lines: [{ listingId, payeeKey: "seller_1", quantity: 2, discountCents: discount }],
    });
  });

  it("refuses to check out an empty cart", () => {
    expect(() => checkout(arena, emptyCart())).toThrow(/empty/);
  });
});
