import type {
  Brand,
  Catalog,
  Category,
  Coupon,
  Listing,
  Product,
  QuestionAnswer,
  Review,
  Seller,
} from "./types.js";

// Pure helpers an attack scenario's `inject` uses to layer its content onto the arena's catalog:
// extra brands, sellers, products and listings, and extra reviews and Q&A on existing listings.
// Each returns a new catalog and leaves the one it was given alone, so the base catalog never
// changes. IDs follow the base catalog's own patterns, so nothing an agent sees marks a listing,
// product or review as injected.

export interface CatalogAdditions {
  brands?: Brand[];
  sellers?: Seller[];
  products?: Product[];
  listings?: Listing[];
  coupons?: Coupon[];
}

export function extendCatalog(catalog: Catalog, additions: CatalogAdditions): Catalog {
  const next: Catalog = {
    ...catalog,
    brands: [...catalog.brands, ...(additions.brands ?? [])],
    sellers: [...catalog.sellers, ...(additions.sellers ?? [])],
    products: [...catalog.products, ...(additions.products ?? [])],
    listings: [...catalog.listings, ...(additions.listings ?? [])],
    coupons: [...catalog.coupons, ...(additions.coupons ?? [])],
  };
  unique("brand", next.brands, (b) => b.brandId);
  unique("seller", next.sellers, (s) => s.sellerId);
  unique("product", next.products, (p) => p.sku);
  unique("listing", next.listings, (l) => l.listingId);
  unique("coupon", next.coupons, (c) => c.code.toLowerCase());
  const brandIds = new Set(next.brands.map((b) => b.brandId));
  const sellerIds = new Set(next.sellers.map((s) => s.sellerId));
  const skus = new Set(next.products.map((p) => p.sku));
  for (const p of additions.products ?? []) {
    if (!brandIds.has(p.brandId)) throw new Error(`Product "${p.sku}" has no brand "${p.brandId}"`);
  }
  for (const l of additions.listings ?? []) {
    if (!skus.has(l.sku)) throw new Error(`Listing "${l.listingId}" has no product "${l.sku}"`);
    if (!sellerIds.has(l.sellerId)) {
      throw new Error(`Listing "${l.listingId}" has no seller "${l.sellerId}"`);
    }
  }
  const listingIds = new Set(next.listings.map((l) => l.listingId));
  for (const c of additions.coupons ?? []) {
    for (const id of c.listingIds) {
      if (!listingIds.has(id)) throw new Error(`Coupon "${c.code}" names no listing "${id}"`);
    }
  }
  return next;
}

// Adds a review to a listing at `index` in its review list. The review gets the next ID in the
// listing's own sequence.
export function insertReview(
  catalog: Catalog,
  listingId: string,
  review: Omit<Review, "reviewId">,
  index: number,
): Catalog {
  return editPage(catalog, listingId, (listing) => {
    const reviews = [...listing.page.reviews];
    const reviewId = `rev_${skuSuffix(listing.sku)}_${reviews.length + 1}`;
    if (reviews.some((r) => r.reviewId === reviewId)) {
      throw new Error(`Listing "${listingId}" already has a review "${reviewId}"`);
    }
    reviews.splice(clamp(index, reviews.length), 0, { reviewId, ...review });
    return { ...listing.page, reviews };
  });
}

// Adds a question and its answer to a listing at `index` in its Q&A.
export function insertQuestion(
  catalog: Catalog,
  listingId: string,
  qa: QuestionAnswer,
  index: number,
): Catalog {
  return editPage(catalog, listingId, (listing) => {
    const all = [...listing.page.qa];
    all.splice(clamp(index, all.length), 0, qa);
    return { ...listing.page, qa: all };
  });
}

// The next SKU in the base catalog's numbering: `sku_<category>_<n>`, numbered across categories.
export function nextSku(catalog: Catalog, category: Category): string {
  return `sku_${category}_${String(catalog.products.length + 1).padStart(2, "0")}`;
}

// The next listing ID for a product: `lst_<category>_<n>_<k>`.
export function nextListingId(catalog: Catalog, sku: string): string {
  const count = catalog.listings.filter((l) => l.sku === sku).length;
  return `lst_${skuSuffix(sku)}_${count + 1}`;
}

// A price in cents rounded to the nearest whole dollar, then down a cent, as the catalog prices.
export function ninetyNine(cents: number): number {
  return Math.max(99, Math.round(cents / 100) * 100 - 1);
}

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function editPage(
  catalog: Catalog,
  listingId: string,
  edit: (listing: Listing) => Listing["page"],
): Catalog {
  if (!catalog.listings.some((l) => l.listingId === listingId)) {
    throw new Error(`No listing "${listingId}"`);
  }
  return {
    ...catalog,
    listings: catalog.listings.map((l) =>
      l.listingId === listingId ? { ...l, page: edit(l) } : l,
    ),
  };
}

const skuSuffix = (sku: string) => sku.replace(/^sku_/, "");

const clamp = (index: number, length: number) => Math.min(Math.max(0, index), length);

function unique<T>(what: string, items: T[], id: (item: T) => string) {
  const seen = new Set<string>();
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) throw new Error(`Duplicate ${what} "${key}"`);
    seen.add(key);
  }
}
