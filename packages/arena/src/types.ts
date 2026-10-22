// The arena's data model. Every listing has two layers, and the split is the point of the project:
//  - catalog data (SKU, brand, price, seller, payee) is owned by the marketplace and trusted;
//  - page content (title, description, reviews, Q&A) is written by sellers and buyers, is not
//    trusted, and is where attacks live.

export type Category = "keyboard" | "headphones" | "mouse";

export interface KeyboardAttributes {
  type: "mechanical" | "membrane";
  switch_feel: "tactile" | "linear" | "clicky" | "membrane";
  layout: "full" | "tkl" | "75" | "60";
  wireless: boolean;
}

export interface HeadphonesAttributes {
  form: "over_ear" | "on_ear" | "in_ear";
  anc: boolean;
  wireless: boolean;
}

export interface MouseAttributes {
  wireless: boolean;
  dpi: number;
  weight_g: number;
}

export type AttributeValue = string | number | boolean;

export interface Brand {
  brandId: string;
  name: string;
  // On the marketplace's list of established brands. A mandate's "any reputable brand" means these.
  reputable: boolean;
}

// The sandbox merchant account a seller is paid into. The real merchant IDs come from the
// environment at payment time; the catalog only names which account.
export const PAYEE_KEYS = [
  "seller_1",
  "seller_2",
  "seller_3",
  "seller_4",
  "attacker_1",
  "attacker_2",
] as const;
export type PayeeKey = (typeof PAYEE_KEYS)[number];

export interface Seller {
  sellerId: string;
  name: string;
  payeeKey: PayeeKey;
  // On the marketplace's verified-seller list, which Gate 0 checks the payee against.
  verified: boolean;
  // Ground truth for the eval. Never shown to the agent or the gates.
  role: "honest" | "attacker";
}

interface ProductBase {
  sku: string;
  brandId: string;
  name: string;
  // The list price the listings' prices are set around, in cents.
  basePriceCents: number;
  description: string;
}

export type Product =
  | (ProductBase & { category: "keyboard"; attributes: KeyboardAttributes })
  | (ProductBase & { category: "headphones"; attributes: HeadphonesAttributes })
  | (ProductBase & { category: "mouse"; attributes: MouseAttributes });

export interface Review {
  reviewId: string;
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
}

// Untrusted: written by sellers and buyers.
export interface PageContent {
  title: string;
  description: string;
  reviews: Review[];
  qa: QuestionAnswer[];
}

export interface Listing {
  listingId: string;
  sku: string;
  sellerId: string;
  priceCents: number;
  stock: number;
  page: PageContent;
}

export interface Coupon {
  code: string;
  // Percent off the listing price.
  percentOff: number;
  // The listings it applies to.
  listingIds: string[];
}

export interface Catalog {
  brands: Brand[];
  sellers: Seller[];
  products: Product[];
  listings: Listing[];
  coupons: Coupon[];
}
