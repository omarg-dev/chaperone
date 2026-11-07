import type { AttributeValue } from "@firewall/arena";
import { z } from "zod";
import { median, percentAbove } from "./comparables.js";
import type { CatalogRecord } from "./crosscheck.js";

// A real-market price reference for Gate 2: what the kind of product in a cart line sells for
// outside the arena, so a cart far above the real market stands out even when every listing in the
// arena is priced the same way. The arena's products are fictional, so a reference is asked by
// category and attributes only ("wireless tenkeyless mechanical keyboard, tactile switches"),
// never by an arena brand or product name.
//
// What comes back is numbers: how many products were priced and their low, median and high
// prices. Product titles, descriptions and shop names are third-party text and are never kept,
// so nothing written outside the firewall reaches the auditor through here.
//
// A reference that can't answer (no key, a refused connection, an error, too few prices) says it
// is unavailable and why; Gate 2 records that and works without it.

export interface MarketQuery {
  category: string;
  attributes: Record<string, AttributeValue>;
  // The search text, built from the category and attributes (marketQueryText).
  text: string;
}

export const MARKET_UNAVAILABLE = [
  "not_configured",
  "unreachable",
  "http_error",
  "invalid_response",
  "too_few_prices",
] as const;
export type MarketUnavailable = (typeof MARKET_UNAVAILABLE)[number];

export type MarketQuote =
  | {
      status: "available";
      source: string;
      query: string;
      // Products returned, and how many of them had a USD price for a new item in stock.
      products: number;
      pricedProducts: number;
      // Over each priced product's lowest such offer, in cents.
      lowCents: number;
      medianCents: number;
      highCents: number;
      latencyMs: number;
    }
  | {
      status: "unavailable";
      source: string;
      query: string;
      reason: MarketUnavailable;
      // For the event log and a person reading it. Never shown to the auditor.
      detail: string;
      latencyMs: number;
    };

export interface MarketReference {
  readonly source: string;
  lookup(query: MarketQuery): Promise<MarketQuote>;
}

// Fewer priced products than this and a median says little: the reference reports itself
// unavailable rather than give a number to lean on.
export const MIN_MARKET_PRICES = 3;

// Words for the attributes the arena's categories have, in the terms a real shop would use. An
// attribute with no entry (a keyboard's membrane switch feel, a mouse's DPI) adds nothing.
const PHRASES: Record<string, (value: AttributeValue) => string | null> = {
  type: (v) => (v === "mechanical" ? "mechanical" : v === "membrane" ? "membrane" : null),
  switch_feel: (v) =>
    v === "tactile" || v === "linear" || v === "clicky" ? `${v} switches` : null,
  layout: (v) =>
    ({ full: "full-size", tkl: "tenkeyless", "75": "75%", "60": "60%" })[String(v)] ?? null,
  wireless: (v) => (v === true ? "wireless" : "wired"),
  form: (v) => ({ over_ear: "over-ear", on_ear: "on-ear", in_ear: "in-ear" })[String(v)] ?? null,
  anc: (v) => (v === true ? "noise cancelling" : null),
  weight_g: (v) => (typeof v === "number" ? `${v} g` : null),
  dpi: () => null,
};
const NOUNS: Record<string, string> = {
  keyboard: "keyboard",
  headphones: "headphones",
  mouse: "mouse",
};
// The order words go in, so the noun comes after the words that describe it.
const BEFORE_NOUN = ["wireless", "layout", "type", "form", "anc"];

export function marketQueryText(category: string, attributes: Record<string, AttributeValue>) {
  const phrase = (key: string) => {
    const value = attributes[key];
    return value === undefined ? null : (PHRASES[key]?.(value) ?? null);
  };
  const before = BEFORE_NOUN.map(phrase).filter((p): p is string => p !== null);
  const after = Object.keys(attributes)
    .filter((k) => !BEFORE_NOUN.includes(k))
    .sort()
    .map(phrase)
    .filter((p): p is string => p !== null);
  const noun = NOUNS[category] ?? category;
  const head = [...before, noun].join(" ");
  return after.length > 0 ? `${head}, ${after.join(", ")}` : head;
}

export const marketQueryFor = (record: CatalogRecord): MarketQuery => ({
  category: record.category,
  attributes: record.attributes,
  text: marketQueryText(record.category, record.attributes),
});

// Where a cart line's price sits against a quote, recorded for the person to read. It decides
// nothing (decided Nov 7): a category search's median isn't like-for-like, since "wired over-ear
// headphones" runs from $6 to $1,700, so honest mid-range listings sat far above it. Paying more
// than needed for the same product is Gate 2's like-for-like check, inside the marketplace.
export interface MarketCheck {
  quote: MarketQuote;
  pctAboveMedian: number | null;
}

export function marketCheck(paidUnitCents: number, quote: MarketQuote): MarketCheck {
  if (quote.status !== "available") return { quote, pctAboveMedian: null };
  return { quote, pctAboveMedian: percentAbove(paidUnitCents, quote.medianCents) };
}

// Channel3, a sponsor's real product search: POST /v1/search with the key in x-api-key.
//
// This calls the HTTP API with fetch rather than through @channel3/sdk. The SDK fills every
// setting it isn't given from the environment (CHANNEL3_API_KEY, and the language, country,
// currency and unit headers), the same trap as the model SDKs (CLAUDE.md, "Model clients are
// configured explicitly"), and one search is a single POST whose response this file parses anyway.

export const CHANNEL3_SOURCE = "channel3";
export const CHANNEL3_BASE_URL = "https://api.trychannel3.com";
const CHANNEL3_LIMIT = 20;
const CHANNEL3_TIMEOUT_MS = 10_000;

export interface Channel3Config {
  // Null when FIREWALL_CHANNEL3_API_KEY isn't set: the reference is then unavailable.
  apiKey: string | null;
}

// Reads only the app's own variable, never CHANNEL3_API_KEY, which the SDK would fall back to.
export function channel3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Channel3Config {
  return { apiKey: env.FIREWALL_CHANNEL3_API_KEY?.trim() || null };
}

export interface Channel3Options extends Channel3Config {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  limit?: number;
  timeoutMs?: number;
  now?: () => number;
}

// The parts of a search response this reads. Everything else, titles included, is dropped.
const searchResponse = z.object({
  products: z.array(
    z.object({
      offers: z
        .array(
          z.object({
            price: z.object({ price: z.number(), currency: z.string() }),
            availability: z.string().optional(),
            condition: z.string().nullish(),
          }),
        )
        .optional(),
    }),
  ),
});

// The request body for one query. Exported so a test can pin its shape.
export function channel3SearchBody(query: MarketQuery, limit = CHANNEL3_LIMIT) {
  return {
    query: query.text,
    limit,
    // Stated, not left to the account's defaults: prices are compared in US dollars.
    config: { country: "US", currency: "USD" },
  };
}

export function createChannel3Market(options: Channel3Options): MarketReference {
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? CHANNEL3_BASE_URL).replace(/\/+$/, "");
  const limit = options.limit ?? CHANNEL3_LIMIT;
  const timeoutMs = options.timeoutMs ?? CHANNEL3_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());

  return {
    source: CHANNEL3_SOURCE,
    async lookup(query) {
      const started = now();
      const unavailable = (reason: MarketUnavailable, detail: string): MarketQuote => ({
        status: "unavailable",
        source: CHANNEL3_SOURCE,
        query: query.text,
        reason,
        detail,
        latencyMs: Math.round(now() - started),
      });
      if (!options.apiKey) {
        return unavailable("not_configured", "FIREWALL_CHANNEL3_API_KEY isn't set");
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/search`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": options.apiKey },
          body: JSON.stringify(channel3SearchBody(query, limit)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return unavailable("unreachable", `The request didn't get through: ${String(error)}`);
      }
      if (!response.ok) {
        return unavailable("http_error", `Channel3 answered ${response.status}`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        return unavailable("invalid_response", `The answer isn't JSON: ${String(error)}`);
      }
      const parsed = searchResponse.safeParse(body);
      if (!parsed.success) {
        return unavailable("invalid_response", "The answer isn't a search response");
      }

      // Each product's lowest USD price for a new item in stock, in cents.
      const prices = parsed.data.products.flatMap((p) => {
        const usable = (p.offers ?? []).filter(
          (o) =>
            o.price.currency === "USD" &&
            o.price.price > 0 &&
            (o.availability === undefined || o.availability === "InStock") &&
            (o.condition == null || o.condition === "new"),
        );
        return usable.length > 0
          ? [Math.round(Math.min(...usable.map((o) => o.price.price)) * 100)]
          : [];
      });
      if (prices.length < MIN_MARKET_PRICES) {
        return unavailable(
          "too_few_prices",
          `${prices.length} of ${parsed.data.products.length} products had a usable price; ${MIN_MARKET_PRICES} are needed`,
        );
      }
      return {
        status: "available",
        source: CHANNEL3_SOURCE,
        query: query.text,
        products: parsed.data.products.length,
        pricedProducts: prices.length,
        lowCents: Math.min(...prices),
        medianCents: median(prices) as number,
        highCents: Math.max(...prices),
        latencyMs: Math.round(now() - started),
      };
    },
  };
}
