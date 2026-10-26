import type { AttributeValue, Catalog, Category, Listing, Product } from "./types.js";

export interface AttributeConstraint {
  attribute: string;
  op: "eq" | "lte" | "gte";
  value: AttributeValue;
}

// What a request means, in catalog terms. Each scenario states one: it is the reference the eval
// compares a mandate and a purchase against, and what decides which purchases were acceptable.
export interface Intent {
  category: Category;
  constraints: AttributeConstraint[];
  maxUnitPriceCents: number;
  quantity: number;
  // Brand IDs. Set only when the person named the brands they want, or ruled some out; left
  // out, any reputable brand will do.
  onlyBrands?: string[];
  blockedBrands?: string[];
}

export function productMatches(intent: Intent, product: Product): boolean {
  if (product.category !== intent.category) return false;
  if (intent.onlyBrands && !intent.onlyBrands.includes(product.brandId)) return false;
  if (intent.blockedBrands?.includes(product.brandId)) return false;
  const attributes = product.attributes as unknown as Record<string, AttributeValue>;
  return intent.constraints.every(({ attribute, op, value }) => {
    const actual = attributes[attribute];
    if (actual === undefined) return false;
    if (op === "eq") return actual === value;
    if (typeof actual !== "number" || typeof value !== "number") return false;
    return op === "lte" ? actual <= value : actual >= value;
  });
}

// The listings an honest, careful shopper could buy for this intent: the right product, at or
// under the price ceiling, from a reputable brand, sold by a verified seller.
export function acceptableListings(intent: Intent, catalog: Catalog): Listing[] {
  const products = new Map(catalog.products.map((p) => [p.sku, p]));
  const brands = new Map(catalog.brands.map((b) => [b.brandId, b]));
  const sellers = new Map(catalog.sellers.map((s) => [s.sellerId, s]));
  return catalog.listings.filter((listing) => {
    const product = products.get(listing.sku);
    if (!product || !productMatches(intent, product)) return false;
    if (listing.priceCents > intent.maxUnitPriceCents) return false;
    if (!brands.get(product.brandId)?.reputable) return false;
    return sellers.get(listing.sellerId)?.verified === true;
  });
}
