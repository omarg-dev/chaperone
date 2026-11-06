import type { Catalog } from "@firewall/arena";
import type { Event } from "@firewall/events";
import { z } from "zod";
import { catalogRecord } from "./crosscheck.js";
import type { FlagKind } from "./facts.js";
import type { ReviewerView } from "./reviewer-view.js";
import { STEERING_FLAGS } from "./verdict.js";

// What Gate 3 knows about how the agent got to its cart, worked out in code from the arena's own
// record of the run: the calls the agent made to the marketplace, in order, and what each one
// served or changed. Pure: no model, no network, no event log.
//
// It reads the arena lane only. That lane is what the marketplace served and was asked, written
// by the arena itself, so it is the same whichever agent shopped (our own, or one behind the SDK).
// From each event it keeps the tool, the listing it concerned (and the catalog's record of that
// listing), the quantities, and where the call sits in the order. It does not keep:
//  - what the marketplace served as page content (titles, descriptions, Q&A, reviews, search hit
//    titles): that is seller text, and only Gate 1 reads it;
//  - what the agent typed (a search's words, a coupon code) or said (its turns' text and
//    reasoning): the agent is a model that read seller text, and may be repeating it;
//  - an error's message, which can repeat what the agent typed.
// Wall-clock time stays in the event log (the gate3_started event has each step's offset): a
// duration in the auditor's request would make the same case a different request every run, and a
// recording keeps answering only the same request. The order and the step numbers carry "when".

export const STEP_TOOLS = [
  "search",
  "view_listing",
  "read_reviews",
  "add_to_cart",
  "remove_from_cart",
  "apply_coupon",
  "checkout",
] as const;
export type StepTool = (typeof STEP_TOOLS)[number];

const TOOL_OF_EVENT: Record<string, StepTool> = {
  search: "search",
  listing_viewed: "view_listing",
  reviews_viewed: "read_reviews",
  cart_updated: "add_to_cart",
  coupon_applied: "apply_coupon",
  checkout: "checkout",
};

export interface TraceListing {
  listingId: string;
  // The catalog's product name, never the page's title.
  name: string;
  category: string;
  brandId: string;
  sellerId: string;
  sellerVerified: boolean;
  priceCents: number;
}

export interface TraceStep {
  // 1-based, in the order the marketplace saw the calls.
  step: number;
  eventId: string;
  tool: StepTool;
  // The marketplace refused the call.
  failed: boolean;
  listing: TraceListing | null;
  // Milliseconds since the run began, for the log only (see above).
  atMs: number;
  // A search's filters and what it returned, as listing IDs. Never its words.
  search: {
    category: string | null;
    maxPriceCents: number | null;
    hasWords: boolean;
    resultListingIds: string[];
  } | null;
  quantity: number | null;
  // add_to_cart that took a listing out of the cart.
  removal: boolean;
  coupon: { percentOff: number; listingIds: string[] } | null;
  // Steering Gate 1 flagged in what this call served, by kind.
  flagged: FlagKind[];
}

// A page Gate 1 flagged as steering, read before a cart line was added.
export interface Exposure {
  step: number;
  eventId: string;
  // Null when the steering was in a search's results, which name no one listing.
  listingId: string | null;
  tool: StepTool;
  kinds: FlagKind[];
  // The flagged page is the cart line's own listing's.
  ownListing: boolean;
  // Another listing of the very same product as the cart line's.
  sameProduct: boolean;
  // Listing pages the agent opened between reading it and adding the line.
  listingsOpenedAfter: number;
  // The first listing page the agent opened after reading it is the cart line's.
  nextListingOpened: boolean;
}

export interface Choice {
  line: number;
  listingId: string;
  // The step that put it in the cart (its last add), or null when the trace has none.
  addedAtStep: number | null;
  // The step that first opened its page and its reviews, before it was added.
  openedAtStep: number | null;
  reviewsReadAtStep: number | null;
  // The first search that listed it, before it was added.
  foundInSearchAtStep: number | null;
  // Other listings' pages the agent opened before adding it, and how many of those were of the
  // same category.
  otherListingsOpened: number;
  otherSameCategoryOpened: number;
  exposures: Exposure[];
}

const searchEvent = z.object({
  request: z.object({
    text: z.string().optional(),
    category: z.string().optional(),
    maxPriceCents: z.number().optional(),
  }),
  result: z.array(z.object({ listingId: z.string() })).optional(),
});
const listingRequest = z.object({ request: z.object({ listingId: z.string() }) });
const cartRequest = z.object({
  request: z.object({
    listingId: z.string().optional(),
    quantity: z.number().optional(),
    remove: z.string().optional(),
  }),
});
const couponEvent = z.object({
  result: z.object({
    coupon: z.object({ percentOff: z.number(), listingIds: z.array(z.string()) }),
  }),
});

const steersFlag = (kind: FlagKind) => STEERING_FLAGS.includes(kind);

export function stepsOf(
  events: readonly Event[],
  catalog: Catalog,
  gate1: ReviewerView,
): TraceStep[] {
  const checkout = events.filter((e) => e.lane === "arena" && e.type === "checkout").at(-1);
  if (!checkout) return [];
  const start = Date.parse(events[0]?.ts ?? checkout.ts);
  const listingOf = (listingId: string | undefined): TraceListing | null => {
    const record = listingId === undefined ? null : catalogRecord(catalog, listingId);
    if (!record) return null;
    const product = catalog.products.find((p) => p.sku === record.sku);
    const seller = catalog.sellers.find((s) => s.sellerId === record.sellerId);
    return {
      listingId: record.listingId,
      name: product?.name ?? record.sku,
      category: record.category,
      brandId: record.brandId,
      sellerId: record.sellerId,
      sellerVerified: seller?.verified ?? false,
      priceCents: record.priceCents,
    };
  };
  const flaggedAt = new Map<string, FlagKind[]>();
  for (const listing of gate1.listings) {
    for (const flag of listing.flags) {
      if (flag.sourceEventId === null || !steersFlag(flag.kind)) continue;
      const kinds = flaggedAt.get(flag.sourceEventId) ?? [];
      if (!kinds.includes(flag.kind)) kinds.push(flag.kind);
      flaggedAt.set(flag.sourceEventId, kinds);
    }
  }

  const steps: TraceStep[] = [];
  for (const event of events) {
    if (event.lane !== "arena" || event.seq > checkout.seq) continue;
    const failed = event.type.endsWith("_failed");
    const tool = TOOL_OF_EVENT[failed ? event.type.slice(0, -"_failed".length) : event.type];
    if (!tool) continue;
    const base = {
      step: steps.length + 1,
      eventId: event.eventId,
      tool,
      failed,
      listing: null as TraceListing | null,
      atMs: Math.max(0, Date.parse(event.ts) - start),
      search: null as TraceStep["search"],
      quantity: null as number | null,
      removal: false,
      coupon: null as TraceStep["coupon"],
      flagged: flaggedAt.get(event.eventId) ?? [],
    };
    if (tool === "search") {
      const parsed = searchEvent.safeParse(event.payload);
      if (parsed.success) {
        base.search = {
          category: parsed.data.request.category ?? null,
          maxPriceCents: parsed.data.request.maxPriceCents ?? null,
          hasWords: (parsed.data.request.text ?? "").trim() !== "",
          resultListingIds: failed ? [] : (parsed.data.result ?? []).map((r) => r.listingId),
        };
      }
    } else if (tool === "view_listing" || tool === "read_reviews") {
      const parsed = listingRequest.safeParse(event.payload);
      if (parsed.success) base.listing = listingOf(parsed.data.request.listingId);
    } else if (tool === "add_to_cart") {
      const parsed = cartRequest.safeParse(event.payload);
      if (parsed.success) {
        const { listingId, quantity, remove } = parsed.data.request;
        base.removal = remove !== undefined;
        base.listing = listingOf(remove ?? listingId);
        base.quantity = quantity ?? null;
        if (base.removal) base.tool = "remove_from_cart";
      }
    } else if (tool === "apply_coupon") {
      const parsed = couponEvent.safeParse(event.payload);
      if (parsed.success && !failed) base.coupon = parsed.data.result.coupon;
    }
    steps.push(base);
  }
  return steps;
}

// The trace's account of each checkout line: how it got into the cart, what the agent read before,
// and any steering it had read on the way.
export function choicesOf(
  steps: readonly TraceStep[],
  lines: readonly { line: number; listingId: string }[],
  catalog: Catalog,
): Choice[] {
  const ok = steps.filter((s) => !s.failed);
  return lines.map(({ line, listingId }) => {
    const record = catalogRecord(catalog, listingId);
    const adds = ok.filter((s) => s.tool === "add_to_cart" && s.listing?.listingId === listingId);
    const added = adds.at(-1) ?? null;
    const before = added ? ok.filter((s) => s.step < added.step) : [];
    const first = (tool: StepTool) =>
      before.find((s) => s.tool === tool && s.listing?.listingId === listingId)?.step ?? null;
    const opened = before.filter(
      (s) => s.tool === "view_listing" && s.listing && s.listing.listingId !== listingId,
    );
    const openedIds = [...new Set(opened.map((s) => s.listing?.listingId))];
    const sameCategory = openedIds.filter(
      (id) => catalogRecord(catalog, id ?? "")?.category === record?.category,
    );
    const exposures: Exposure[] = before
      .filter((s) => s.flagged.length > 0)
      .map((s) => {
        const exposed = s.listing ?? null;
        const exposedRecord = exposed ? catalogRecord(catalog, exposed.listingId) : null;
        const afterwards = before.filter((o) => o.step > s.step && o.tool === "view_listing");
        return {
          step: s.step,
          eventId: s.eventId,
          listingId: exposed?.listingId ?? null,
          tool: s.tool,
          kinds: s.flagged,
          ownListing: exposed?.listingId === listingId,
          sameProduct:
            exposedRecord !== null &&
            record !== null &&
            exposedRecord.sku === record.sku &&
            exposed?.listingId !== listingId,
          listingsOpenedAfter: afterwards.length,
          nextListingOpened: afterwards[0]?.listing?.listingId === listingId,
        };
      });
    return {
      line,
      listingId,
      addedAtStep: added?.step ?? null,
      openedAtStep: first("view_listing"),
      reviewsReadAtStep: first("read_reviews"),
      foundInSearchAtStep:
        before.find((s) => s.tool === "search" && s.search?.resultListingIds.includes(listingId))
          ?.step ?? null,
      otherListingsOpened: openedIds.length,
      otherSameCategoryOpened: sameCategory.length,
      exposures,
    };
  });
}
