import type { AttributeValue } from "@firewall/arena";
import type { AttributeSpec } from "@firewall/mandate";
import {
  attributeValue,
  type FlagKind,
  MAX_ITEMS,
  type ModelFacts,
  NOT_STATED,
  type PriceKind,
  type UrgencyKind,
} from "./facts.js";
import { cleanCode, cleanSnippet, verifiedQuote } from "./sanitize.js";
import {
  type DocumentKind,
  documentWords,
  type ListingInScope,
  type PageDocument,
} from "./sources.js";
import { tripwireHits } from "./tripwires.js";

// The model's answer, made into facts the rest of the firewall can rely on: each tied to the event
// that served the text it came from, each quote checked against that text and cleaned, each code
// cleaned, and the tripwires' flags added beside the model's. Pure: no model, no I/O.

// Where a fact came from. Null when the model named a document that doesn't exist; the fact is
// kept (dropping a flag would only help an attacker), and its evidence falls back to the listing's
// source events.
export interface Evidence {
  sourceEventId: string | null;
  documentKind: DocumentKind | null;
}

export interface Flag extends Evidence {
  kind: FlagKind;
  // Who raised it: the model reading the page, or a code tripwire matching its words.
  detectedBy: "extractor" | "tripwire";
  tripwire?: string;
  quote: string | null;
}

export interface ListingFacts {
  category: { value: string } & Evidence;
  brand: { value: string } & Evidence;
  seller: { value: string } & Evidence;
  attributes: ({ attribute: string; value: AttributeValue } & Evidence)[];
  prices: ({ kind: PriceKind; cents: number } & Evidence)[];
  requiredItems: ({ category: string; quote: string | null } & Evidence)[];
  urgency: ({ kind: UrgencyKind; amount: number | null; quote: string | null } & Evidence)[];
  discountCodes: ({ code: string; percentOff: number | null } & Evidence)[];
  flags: Flag[];
  // Quotes the model gave that weren't the named document's own words, and so were dropped.
  quotesDropped: number;
  // Other attribute claims whose value isn't one the attribute takes, dropped the same way.
  valuesDropped: number;
}

// The facts for a page with nothing on it to read, and the base the tripwires add to.
export const NO_FACTS: Omit<ListingFacts, "flags" | "quotesDropped" | "valuesDropped"> = {
  category: { value: "not_stated", sourceEventId: null, documentKind: null },
  brand: { value: "not_stated", sourceEventId: null, documentKind: null },
  seller: { value: "not_stated", sourceEventId: null, documentKind: null },
  attributes: [],
  prices: [],
  requiredItems: [],
  urgency: [],
  discountCodes: [],
};

// The tripwires' flags for every document of a listing, one per tripwire per document.
export function tripwireFlags(listing: ListingInScope): Flag[] {
  return listing.documents.flatMap((doc) =>
    tripwireHits(documentWords(doc)).map((hit) => ({
      kind: hit.kind,
      detectedBy: "tripwire" as const,
      tripwire: hit.name,
      quote: cleanSnippet(hit.match),
      sourceEventId: doc.eventId,
      documentKind: doc.kind,
    })),
  );
}

// `attributes` is the vocabulary's attributes by name (attributesByName), which the claimed values
// are checked against.
export function refineFacts(
  model: ModelFacts | null,
  listing: ListingInScope,
  attributes: ReadonlyMap<string, AttributeSpec>,
): ListingFacts {
  const flags = tripwireFlags(listing);
  if (!model) return { ...NO_FACTS, flags, quotesDropped: 0, valuesDropped: 0 };

  const docAt = (n: number | null): PageDocument | undefined =>
    n === null ? undefined : listing.documents[n - 1];
  const evidence = (n: number | null): Evidence => {
    const doc = docAt(n);
    return { sourceEventId: doc?.eventId ?? null, documentKind: doc?.kind ?? null };
  };
  let quotesDropped = 0;
  let valuesDropped = 0;
  const quoteFrom = (quote: string, n: number): string | null => {
    const doc = docAt(n);
    const checked = doc ? verifiedQuote(quote, documentWords(doc)) : null;
    if (checked === null && quote.trim() !== "") quotesDropped += 1;
    return checked;
  };
  const capped = <T>(items: T[]) => items.slice(0, MAX_ITEMS);

  const facts: ListingFacts = {
    category: { value: model.category.value, ...evidence(model.category.source) },
    brand: { value: model.brand.value, ...evidence(model.brand.source) },
    seller: { value: model.seller.value, ...evidence(model.seller.source) },
    attributes: [
      ...Object.entries(model.attributes).flatMap(([attribute, claim]) => {
        const spec = attributes.get(attribute);
        if (!spec || claim.value === null || claim.value === NOT_STATED) return [];
        const value = attributeValue(spec, String(claim.value));
        return value === null ? [] : [{ attribute, value, ...evidence(claim.source) }];
      }),
      ...capped(model.otherAttributeClaims).flatMap((a) => {
        const spec = attributes.get(a.attribute);
        const value = spec ? attributeValue(spec, a.value) : null;
        if (value === null) {
          valuesDropped += 1;
          return [];
        }
        return [{ attribute: a.attribute, value, ...evidence(a.source) }];
      }),
    ],
    prices: capped(model.prices).map((p) => ({
      kind: p.kind,
      cents: p.cents,
      ...evidence(p.source),
    })),
    requiredItems: capped(model.requiredItems).map((r) => ({
      category: r.category,
      quote: quoteFrom(r.quote, r.source),
      ...evidence(r.source),
    })),
    urgency: capped(model.urgency).map((u) => ({
      kind: u.kind,
      amount: u.amount,
      quote: quoteFrom(u.quote, u.source),
      ...evidence(u.source),
    })),
    discountCodes: capped(model.discountCodes).flatMap((d) => {
      const code = cleanCode(d.code);
      return code ? [{ code, percentOff: d.percentOff, ...evidence(d.source) }] : [];
    }),
    flags: [
      ...capped(model.flags).map((f) => ({
        kind: f.kind,
        detectedBy: "extractor" as const,
        quote: quoteFrom(f.quote, f.source),
        ...evidence(f.source),
      })),
      ...flags,
    ],
    quotesDropped: 0,
    valuesDropped: 0,
  };
  facts.quotesDropped = quotesDropped;
  facts.valuesDropped = valuesDropped;
  return facts;
}
