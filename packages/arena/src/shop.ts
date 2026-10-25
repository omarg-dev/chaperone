import type { Arena } from "./scenario.js";
import type { Category, Coupon, Listing, PageContent, PayeeKey, Product, Review } from "./types.js";

// The marketplace's behaviour as pure functions over one arena and one cart. The service in
// service.ts calls these and writes each call to the event log; the HTTP routes call the service.

export interface SearchQuery {
  text?: string;
  category?: Category;
  maxPriceCents?: number;
}

// One search hit. The title comes from the listing page, so it is seller content; the rest is
// catalog data.
export interface SearchHit {
  listingId: string;
  title: string;
  category: Category;
  brand: string;
  sellerName: string;
  priceCents: number;
  rating: number | null;
  reviewCount: number;
}

// Everything a listing page shows: the catalog layer and the page layer, kept apart.
export interface ListingView {
  listingId: string;
  catalog: {
    sku: string;
    category: Category;
    brand: string;
    productName: string;
    attributes: Product["attributes"];
    sellerName: string;
    priceCents: number;
    stock: number;
  };
  page: Omit<PageContent, "reviews">;
}

export interface CartLine {
  listingId: string;
  quantity: number;
  couponCode: string | null;
}

export interface Cart {
  lines: CartLine[];
}

// What checkout hands to payment: one line per listing, all of it catalog data. The payee and the
// product's name come from the catalog, never from anything a seller wrote, so the checkout event
// (marked catalog) carries no seller text.
export interface OrderDraft {
  currency: "USD";
  lines: Array<{
    listingId: string;
    sku: string;
    // The catalog's name for the product, not the listing's page title.
    productName: string;
    sellerId: string;
    payeeKey: PayeeKey;
    unitPriceCents: number;
    quantity: number;
    discountCents: number;
    totalCents: number;
  }>;
  totalCents: number;
}

export class ShopError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "out_of_stock" | "empty_cart",
    message: string,
  ) {
    super(message);
    this.name = "ShopError";
  }
}

export const emptyCart = (): Cart => ({ lines: [] });

function lookup(arena: Arena) {
  const { catalog } = arena;
  const products = new Map(catalog.products.map((p) => [p.sku, p]));
  const brands = new Map(catalog.brands.map((b) => [b.brandId, b]));
  const sellers = new Map(catalog.sellers.map((s) => [s.sellerId, s]));
  const listings = new Map(catalog.listings.map((l) => [l.listingId, l]));
  const listing = (listingId: string): Listing => {
    const found = listings.get(listingId);
    if (!found) throw new ShopError("not_found", `No listing "${listingId}"`);
    return found;
  };
  const product = (l: Listing) => products.get(l.sku) as Product;
  const brandName = (p: Product) => brands.get(p.brandId)?.name ?? "";
  const seller = (l: Listing) => {
    const found = sellers.get(l.sellerId);
    if (!found) throw new Error(`Listing "${l.listingId}" names unknown seller "${l.sellerId}"`);
    return found;
  };
  return { listing, product, brandName, seller };
}

const averageRating = (reviews: Review[]) =>
  reviews.length === 0
    ? null
    : Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10;

// Listings in the arena's seeded order, filtered, then ranked by how many query words they match
// in the title, description, product name, brand, category and specs.
export function search(arena: Arena, query: SearchQuery): SearchHit[] {
  const { listing, product, brandName, seller } = lookup(arena);
  const words = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hits = arena.searchOrder.map((id) => {
    const l = listing(id);
    const p = product(l);
    const specs = Object.values(p.attributes).map((v) => String(v).replaceAll("_", " "));
    const haystack =
      `${l.page.title} ${l.page.description} ${p.name} ${brandName(p)} ${p.category} ${specs.join(" ")}`.toLowerCase();
    const score = words.filter((w) => haystack.includes(w)).length;
    return { l, p, score };
  });
  return hits
    .filter(({ l, p, score }) => {
      if (query.category && p.category !== query.category) return false;
      if (query.maxPriceCents !== undefined && l.priceCents > query.maxPriceCents) return false;
      return words.length === 0 || score > 0;
    })
    .sort((a, b) => b.score - a.score)
    .map(({ l, p }) => ({
      listingId: l.listingId,
      title: l.page.title,
      category: p.category,
      brand: brandName(p),
      sellerName: seller(l).name,
      priceCents: l.priceCents,
      rating: averageRating(l.page.reviews),
      reviewCount: l.page.reviews.length,
    }));
}

export function viewListing(arena: Arena, listingId: string): ListingView {
  const { listing, product, brandName, seller } = lookup(arena);
  const l = listing(listingId);
  const p = product(l);
  const { reviews: _reviews, ...page } = l.page;
  return {
    listingId: l.listingId,
    catalog: {
      sku: p.sku,
      category: p.category,
      brand: brandName(p),
      productName: p.name,
      attributes: p.attributes,
      sellerName: seller(l).name,
      priceCents: l.priceCents,
      stock: l.stock,
    },
    page,
  };
}

export function reviews(arena: Arena, listingId: string): Review[] {
  return lookup(arena).listing(listingId).page.reviews;
}

export function addToCart(arena: Arena, cart: Cart, listingId: string, quantity: number): Cart {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ShopError("invalid", `Quantity must be a whole number of 1 or more, got ${quantity}`);
  }
  const l = lookup(arena).listing(listingId);
  const existing = cart.lines.find((line) => line.listingId === listingId);
  const wanted = (existing?.quantity ?? 0) + quantity;
  if (wanted > l.stock) {
    throw new ShopError("out_of_stock", `Only ${l.stock} of "${listingId}" in stock`);
  }
  const lines = existing
    ? cart.lines.map((line) => (line === existing ? { ...line, quantity: wanted } : line))
    : [...cart.lines, { listingId, quantity, couponCode: null }];
  return { lines };
}

export function removeFromCart(cart: Cart, listingId: string): Cart {
  return { lines: cart.lines.filter((line) => line.listingId !== listingId) };
}

// A coupon applies to the cart lines it names. Codes are matched without regard to case.
export function applyCoupon(
  arena: Arena,
  cart: Cart,
  code: string,
): { cart: Cart; coupon: Coupon } {
  const coupon = arena.catalog.coupons.find((c) => c.code.toLowerCase() === code.toLowerCase());
  if (!coupon) throw new ShopError("not_found", `No coupon "${code}"`);
  const applies = (line: CartLine) => coupon.listingIds.includes(line.listingId);
  if (!cart.lines.some(applies)) {
    throw new ShopError("invalid", `Coupon "${coupon.code}" doesn't apply to anything in the cart`);
  }
  return {
    coupon,
    cart: {
      lines: cart.lines.map((line) =>
        applies(line) ? { ...line, couponCode: coupon.code } : line,
      ),
    },
  };
}

export function checkout(arena: Arena, cart: Cart): OrderDraft {
  if (cart.lines.length === 0) throw new ShopError("empty_cart", "The cart is empty");
  const { listing, product, seller } = lookup(arena);
  const coupons = new Map(arena.catalog.coupons.map((c) => [c.code, c]));
  const lines = cart.lines.map((line) => {
    const l = listing(line.listingId);
    const percentOff = line.couponCode ? (coupons.get(line.couponCode)?.percentOff ?? 0) : 0;
    const gross = l.priceCents * line.quantity;
    const discountCents = Math.round((gross * percentOff) / 100);
    const s = seller(l);
    return {
      listingId: l.listingId,
      sku: l.sku,
      productName: product(l).name,
      sellerId: s.sellerId,
      payeeKey: s.payeeKey,
      unitPriceCents: l.priceCents,
      quantity: line.quantity,
      discountCents,
      totalCents: gross - discountCents,
    };
  });
  return { currency: "USD", lines, totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0) };
}
