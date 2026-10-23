import type { OrderDraft } from "@firewall/arena";
import type { Event } from "@firewall/events";
import { z } from "zod";

// What Gate 1 reads: exactly the page content the arena served in this run, for the listings in
// the checkout and the listings the agent opened on the way, each piece with the event that served
// it. It reads the arena's own record of what was served (lane arena), never the agent's account of
// it, and nothing after the checkout, so it never reads anything the agent didn't see.

export const DOCUMENT_KINDS = [
  "title",
  "description",
  "question",
  "answer",
  "review",
  "search_title",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// One piece of seller- or buyer-written text, as served.
export interface PageDocument {
  kind: DocumentKind;
  text: string;
  // A review's author, as the reviewer wrote it: buyer-written too, and shown to the agent.
  author?: string;
  // The arena event that served it.
  eventId: string;
}

// All of a document's words, for checking a quote against.
export const documentWords = (d: PageDocument): string =>
  d.author === undefined ? d.text : `${d.author} ${d.text}`;

export interface ListingInScope {
  listingId: string;
  inCart: boolean;
  documents: PageDocument[];
  // Every arena event that served this listing's page content, in log order.
  sourceEventIds: string[];
}

export interface Gate1Scope {
  runId: string;
  scenarioId: string | null;
  checkoutEventId: string;
  order: OrderDraft;
  // The cart's listings first, in order line order, then the others the agent opened.
  listings: ListingInScope[];
}

export class Gate1InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gate1InputError";
  }
}

// The payloads as the arena service writes them ({ request, result }). Parsed rather than trusted:
// events come back from SQLite as JSON.
const listingViewed = z.object({
  result: z.object({
    listingId: z.string(),
    page: z.object({
      title: z.string(),
      description: z.string(),
      qa: z.array(z.object({ question: z.string(), answer: z.string() })),
    }),
  }),
});
const reviewsViewed = z.object({
  request: z.object({ listingId: z.string() }),
  result: z.array(z.object({ reviewId: z.string(), author: z.string(), text: z.string() })),
});
const searched = z.object({
  result: z.array(z.object({ listingId: z.string(), title: z.string() })),
});
const checkedOut = z.object({
  result: z.object({
    currency: z.literal("USD"),
    lines: z.array(
      z.object({
        listingId: z.string(),
        sku: z.string(),
        productName: z.string(),
        sellerId: z.string(),
        payeeKey: z.string(),
        unitPriceCents: z.number(),
        quantity: z.number(),
        discountCents: z.number(),
        totalCents: z.number(),
      }),
    ),
    totalCents: z.number(),
  }),
});

function parse<T>(schema: z.ZodType<T>, event: Event): T {
  const parsed = schema.safeParse(event.payload);
  if (!parsed.success) {
    throw new Gate1InputError(`Event ${event.eventId} (${event.type}) isn't what the arena writes`);
  }
  return parsed.data;
}

export function gate1Scope(events: readonly Event[]): Gate1Scope {
  const arena = events.filter((e) => e.lane === "arena");
  const checkout = arena.filter((e) => e.type === "checkout").at(-1);
  if (!checkout) throw new Gate1InputError("The run has no checkout to review");
  const order = parse(checkedOut, checkout).result as OrderDraft;
  const served = arena.filter((e) => e.seq < checkout.seq);

  const byListing = new Map<string, ListingInScope>();
  const entry = (listingId: string, inCart: boolean): ListingInScope => {
    let found = byListing.get(listingId);
    if (!found) {
      found = { listingId, inCart, documents: [], sourceEventIds: [] };
      byListing.set(listingId, found);
    }
    return found;
  };
  for (const line of order.lines) entry(line.listingId, true);

  // The same text served twice (a page opened again) is read once, under the first event.
  const add = (
    listing: ListingInScope,
    kind: DocumentKind,
    text: string,
    eventId: string,
    author?: string,
  ) => {
    if (!listing.sourceEventIds.includes(eventId)) listing.sourceEventIds.push(eventId);
    if (text.trim() === "" && !author?.trim()) return;
    const same = (d: PageDocument) => d.kind === kind && d.text === text && d.author === author;
    if (listing.documents.some(same)) return;
    listing.documents.push({ kind, text, eventId, ...(author === undefined ? {} : { author }) });
  };

  const searchTitles: { listingId: string; title: string; eventId: string }[] = [];
  for (const event of served) {
    if (event.type === "listing_viewed") {
      const { listingId, page } = parse(listingViewed, event).result;
      const listing = entry(listingId, false);
      add(listing, "title", page.title, event.eventId);
      add(listing, "description", page.description, event.eventId);
      for (const { question, answer } of page.qa) {
        add(listing, "question", question, event.eventId);
        add(listing, "answer", answer, event.eventId);
      }
    } else if (event.type === "reviews_viewed") {
      const { request, result } = parse(reviewsViewed, event);
      const listing = entry(request.listingId, false);
      for (const review of result) {
        add(listing, "review", review.text, event.eventId, review.author);
      }
    } else if (event.type === "search") {
      for (const hit of parse(searched, event).result) {
        searchTitles.push({ ...hit, eventId: event.eventId });
      }
    }
  }

  // A search result's title is read only for a listing already in scope (a search shows many
  // listings the agent never chose), and only when it says something the page didn't.
  for (const hit of searchTitles) {
    const listing = byListing.get(hit.listingId);
    if (!listing) continue;
    if (listing.documents.some((d) => d.text === hit.title)) continue;
    add(listing, "search_title", hit.title, hit.eventId);
  }

  return {
    runId: checkout.runId,
    scenarioId: checkout.scenarioId,
    checkoutEventId: checkout.eventId,
    order,
    listings: [...byListing.values()],
  };
}
