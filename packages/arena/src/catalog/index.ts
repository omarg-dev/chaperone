import type { Brand, Catalog, Listing, Product, Seller } from "../types.js";
import { BRANDS, PRODUCTS, STORES } from "./content.js";

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export const brands: Brand[] = BRANDS.map((b) => ({ brandId: `brand_${slug(b.name)}`, ...b }));

// The four honest stores, one per honest sandbox merchant account. Attacker sellers aren't part
// of the base catalog; each attack scenario adds its own.
export const sellers: Seller[] = STORES.map((name, i) => ({
  sellerId: `seller_${slug(name)}`,
  name,
  payeeKey: `seller_${i + 1}` as Seller["payeeKey"],
  verified: true,
  role: "honest",
}));

const brandIdByName = new Map(brands.map((b) => [b.name, b.brandId]));

export const products: Product[] = PRODUCTS.map((p, i) => {
  const brandId = brandIdByName.get(p.brand);
  if (!brandId) throw new Error(`Product "${p.name}" names unknown brand "${p.brand}"`);
  return {
    sku: `sku_${p.category}_${String(i + 1).padStart(2, "0")}`,
    brandId,
    name: p.name,
    category: p.category,
    attributes: p.attributes,
    basePriceCents: Math.round(p.basePriceUsd * 100),
    description: p.description,
  } as Product;
});

// Each product is sold by two or three of the stores, a few percent apart, so a careful shopper
// has a real choice and an overpriced listing stands out against the others. Which stores and
// how far apart is a fixed rule rather than random, so the base catalog never changes.
const PRICE_STEPS = [1, 1.04, 0.97];

export const listings: Listing[] = products.flatMap((product, i) => {
  const sellerCount = i % 3 === 0 ? 3 : 2;
  const reviews = PRODUCTS[i]?.reviews ?? [];
  const brand = brands.find((b) => b.brandId === product.brandId);
  return Array.from({ length: sellerCount }, (_, k) => {
    const seller = sellers[(i + k) % sellers.length] as Seller;
    const step = PRICE_STEPS[k] as number;
    const priceCents = Math.round((product.basePriceCents * step) / 100) * 100 - 1;
    return {
      listingId: `lst_${product.sku.slice(4)}_${k + 1}`,
      sku: product.sku,
      sellerId: seller.sellerId,
      priceCents,
      stock: 5 + ((i * 7 + k * 3) % 20),
      page: {
        title: `${brand?.name} ${product.name}`,
        description: product.description,
        reviews: reviews.map((r, j) => ({
          reviewId: `rev_${product.sku.slice(4)}_${j + 1}`,
          ...r,
        })),
        qa: [],
      },
    };
  });
});

export const baseCatalog: Catalog = { brands, sellers, products, listings, coupons: [] };
