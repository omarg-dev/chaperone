// What a run's events say, as the run view shows it. Pure: events in, a model out, so the mapping
// has unit tests over real logs (fixtures/, written by `pnpm --filter @firewall/eval
// record-run-fixtures`) and the React side only draws.
//
// Where each event comes from, by lane and type:
//   human   mandate_requested, mandate_edited, mandate_confirmed, human_decision (provenance user)
//   mandate mandate_locked: the terms the person confirmed, with the hash the gates verify
//   agent   agent_started, model_turn, tool_call, tool_result, run_finished
//   arena   run_started, listing_viewed and reviews_viewed (seller_content), cart_updated, checkout
//   payments payment_call: create_order, authorize_order (the hold), capture, payout, void, ...
//   gate0   verdict (checks)          gate1  gate1_started, gate1_facts, verdict
//   gate2   gate2_started, gate2_market, gate2_judgement, verdict
//   review  review_started, review_finished, review_failed, escalated, enforced
//
// Two rules the screen depends on, kept here so they can be tested:
//  - Seller-written text (a page, a review, and the quotes Gate 1 copied from them) only ever
//    appears in items of the "seller" zone, never in a title, a line or a gate's reason.
//  - Red (the "attacker" state) is only given to a run whose money reached an attacker.

import type { GateState, ZoneKind } from "../design";
import { list, num, type Obj, obj, type Payee, type RunEvent, str } from "./events";

export type Verdict = "approve" | "escalate" | "block";
export type GateName = "gate0" | "gate1" | "gate2";

// ---------------------------------------------------------------------------------------------
// The model

export interface Segment {
  text: string;
  // Gate 1 copied this passage as evidence.
  marked: boolean;
}

// One piece of what a seller wrote, as the arena served it. `label` is ours ("Description",
// "Review, 4 of 5"); `by` and `segments` are the seller's (or a reviewer's) words.
export interface ServedBlock {
  label: string;
  by: string | null;
  segments: Segment[];
}

export interface ServedPage {
  listingId: string;
  productName: string;
  blocks: ServedBlock[];
}

export interface CheckResult {
  passed: boolean;
  rule: string;
  reason: string;
}

export interface Gate1Quote {
  // What the extractor says the passage does, in our words ("Says another item is required").
  flag: string;
  quote: string;
  productName: string;
}

export interface FactRow {
  label: string;
  value: string;
}

export interface Gate2Line {
  productName: string;
  // How the line stands against the mandate and the market, as plain facts.
  rows: FactRow[];
}

interface ItemBase {
  id: string;
  at: string;
  zone: ZoneKind;
  // Items of one group share a row of the timeline.
  group: string;
  // From this row down, how the spine is drawn: the money's route is dashed until the hold.
  spine?: "money";
}

export type RunItem = ItemBase &
  (
    | {
        // Catalog zone: what the person and the agent did, in our words.
        kind: "step";
        tag: string;
        title: string;
        lines: string[];
        // What the person wrote, kept in their own words.
        quote?: string;
      }
    | {
        // Route zone: the hold.
        kind: "hold";
        amountCents: number;
      }
    | {
        // Route zone: a gate, with what it read.
        kind: "gate";
        gate: GateName;
        label: string;
        verdict: Verdict;
        reads: {
          catalog: boolean;
          seller: "never" | "quarantine";
          facts: "reads" | "writes" | "none";
        };
        // The typed facts Gate 1 passed on, and its cost and timing.
        facts: FactRow[];
        costUsd: number;
        latencyMs: number;
      }
    | {
        // Route zone: the tree's own verdict.
        kind: "review";
        config: string;
        verdict: Verdict | null;
      }
    | {
        // Route zone: gates that didn't run because the review ended earlier.
        kind: "skipped";
        text: string;
      }
    | {
        // Catalog zone: what Gate 0 read and found.
        kind: "gate0_card";
        verdict: Verdict;
        title: string;
        checks: CheckResult[];
        costUsd: number;
        latencyMs: number;
      }
    | {
        // Catalog zone: what Gate 2 read (the catalog and Gate 1's facts) and judged.
        kind: "gate2_card";
        verdict: Verdict;
        title: string;
        explanation: string | null;
        lines: Gate2Line[];
        notes: string[];
        costUsd: number;
        latencyMs: number;
      }
    | {
        // Seller zone: what Gate 1 read again, in quarantine, and the passages it copied.
        kind: "gate1_card";
        verdict: Verdict;
        title: string;
        crosses: string;
        quotes: Gate1Quote[];
        discountCodes: string[];
      }
    | {
        // Seller zone: what the arena served the agent.
        kind: "served";
        title: string;
        pages: ServedPage[];
      }
  );

export type TimelineKind = RunItem["kind"];

export interface MandateTerm {
  label: string;
  value: string;
}

export interface CartLine {
  listingId: string;
  productName: string;
  sellerName: string | null;
  payeeKey: string;
  quantity: number;
  totalCents: number;
}

export interface Payout {
  payeeKey: string;
  sellerName: string;
  amountCents: number;
  attacker: boolean;
}

export type MoneyState = "none" | "held" | "captured" | "voided";

export interface RunMoney {
  state: MoneyState;
  // What the hold or the capture is for, in cents; null when nothing was held.
  amountCents: number | null;
  // After the platform's fee, which is what the sellers split.
  netCents: number | null;
  payouts: Payout[];
  paidToAttackerCents: number;
}

export type Outcome =
  | "in_progress"
  | "approved"
  | "approved_by_person"
  | "blocked"
  | "rejected_by_person"
  | "waiting"
  | "firewall_off"
  | "attacker_paid"
  | "review_failed"
  | "no_checkout";

export interface Headline {
  outcome: Outcome;
  // The state pill, or null when there is no verdict to show (the firewall was off, nothing yet).
  pill: { state: GateState; label: string } | null;
  // Text for a run with no pill.
  badge: string | null;
  title: string;
  lede: string | null;
}

export type Exit = "capture" | "person" | "void";

export interface RunModel {
  runId: string | null;
  scenarioId: string | null;
  startedAt: string | null;
  seed: string | null;
  request: string | null;
  terms: MandateTerm[];
  mandateHash: string | null;
  agentModel: string | null;
  headline: Headline;
  money: RunMoney;
  cart: CartLine[];
  // The escalation is waiting for the person, who can still approve or reject it.
  awaitingPerson: boolean;
  // More events will arrive without anyone acting: poll until this goes false.
  live: boolean;
  // Which exit the money took at the foot of the route, or null while it is still on its way.
  exit: Exit | null;
  // The firewall configurations that reviewed this checkout before the last one (an eval run
  // reviews the same checkout under off, gate0 and full).
  earlierReviews: string[];
  costUsd: number;
  items: RunItem[];
}

// ---------------------------------------------------------------------------------------------
// Words

const FLAG_LABELS: Record<string, string> = {
  addresses_assistant: "Speaks to an AI or assistant",
  directs_purchase_elsewhere: "Tells the reader to buy something else",
  claims_item_required: "Says another item is required",
  urgency_pressure: "Pushes the reader to buy now",
  checkout_instructions: "Gives instructions for checking out or paying",
  imitates_system_text: "Poses as a system message",
};

const FINDING_LABELS: Record<string, string> = {
  matches_mandate: "Matches the mandate",
  wrong_product: "Wrong product",
  unrequested_item: "Not asked for",
  overpriced: "Priced above its like-for-like offers",
  steered_by_seller_content: "Steered by what the page said",
  auditor_unsure: "The auditor was unsure",
};

export const flagLabel = (kind: string): string =>
  FLAG_LABELS[kind] ?? capitalise(kind.replace(/_/g, " "));

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const gateName = (gate: string) => gate.replace(/^gate/, "Gate ");

const words = (id: string) => id.replace(/^brand_/, "").replace(/_/g, " ");

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A gate's reason as a sentence for the screen: the listing's id becomes its product's name and
// the trailing [code] a gate adds for its own bookkeeping goes.
export function tidyReason(reason: string, names: ReadonlyMap<string, string>): string {
  const named = reason
    .replace(/\s*\[[a-z_]+\]$/, "")
    // A listing's id, bare or in parentheses, becomes its product's name.
    .replace(/\b(?:lst|sku)_[a-z0-9_]+\b/g, (id) => names.get(id) ?? id)
    // The flag and finding codes a gate quotes become words.
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (code) =>
      code in FLAG_LABELS || code in FINDING_LABELS ? code.replace(/_/g, " ") : code,
    );
  const text = named.trim();
  // A sentence that opens with an id (brand_x, seller_y) is left as the id is written.
  return /^\S*_/.test(text) ? text : capitalise(text);
}

// ---------------------------------------------------------------------------------------------
// Seller text, marked

// Splits a text around the passages Gate 1 copied from it. The extractor's quotes are copied
// verbatim and checked in code, so a plain search finds them; one that isn't there marks nothing.
export function markQuotes(text: string, quotes: readonly string[]): Segment[] {
  const spans: [number, number][] = [];
  for (const quote of quotes) {
    if (!quote) continue;
    const at = text.indexOf(quote);
    if (at >= 0) spans.push([at, at + quote.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const segments: Segment[] = [];
  let from = 0;
  for (const [start, end] of merged) {
    if (start > from) segments.push({ text: text.slice(from, start), marked: false });
    segments.push({ text: text.slice(start, end), marked: true });
    from = end;
  }
  if (from < text.length) segments.push({ text: text.slice(from), marked: false });
  return segments.length > 0 ? segments : [{ text, marked: false }];
}

// ---------------------------------------------------------------------------------------------
// Mandate terms

export function mandateTerms(mandate: Obj): MandateTerm[] {
  const terms: MandateTerm[] = [];
  const category = str(mandate.category);
  if (category) terms.push({ label: "Buying", value: capitalise(category) });

  const must = list(mandate.constraints).map((raw) => {
    const c = obj(raw);
    const name = String(c.attribute ?? "").replace(/_/g, " ");
    const value = String(c.value ?? "");
    if (c.op === "lte") return `${name} at most ${value}`;
    if (c.op === "gte") return `${name} at least ${value}`;
    return `${name}: ${value}`;
  });
  if (must.length > 0) terms.push({ label: "Must have", value: must.join(", ") });

  const max = num(mandate.maxUnitPriceCents);
  if (max !== null) terms.push({ label: "Budget", value: `Up to ${dollars(max)} each` });

  const quantity = num(mandate.quantity);
  if (quantity !== null) {
    terms.push({ label: "Quantity", value: quantity === 1 ? "1 item" : `${quantity} items` });
  }

  const brands = obj(mandate.brandPolicy);
  const listed = list(brands.listed).map((b) => words(String(b)));
  const blocked = list(brands.blocked).map((b) => words(String(b)));
  const brandText =
    brands.mode === "listed_only"
      ? `Only ${listed.join(", ")}`
      : brands.mode === "any"
        ? "Any brand"
        : "Reputable brands";
  terms.push({
    label: "Brands",
    value: blocked.length > 0 ? `${brandText}, not ${blocked.join(", ")}` : brandText,
  });

  if (mandate.payeePolicy === "verified_sellers_only") {
    terms.push({ label: "Paying", value: "Verified sellers only" });
  }
  const extras = list(mandate.allowedExtras).map(String);
  if (extras.length > 0) terms.push({ label: "Extras allowed", value: extras.join(", ") });
  const unmapped = list(mandate.unmapped).map(String);
  if (unmapped.length > 0) terms.push({ label: "Not captured", value: unmapped.join(", ") });
  return terms;
}

// ---------------------------------------------------------------------------------------------
// The run

const STALE_MS = 10 * 60 * 1000;

interface Listing {
  listingId: string;
  productName: string;
  sellerName: string | null;
  priceCents: number | null;
}

interface ToolGroup {
  turnId: string | null;
  toolName: string;
  at: string;
  callIds: string[];
  inputs: Obj[];
}

const verdictOf = (value: unknown): Verdict | null =>
  value === "approve" || value === "escalate" || value === "block" ? value : null;

export function buildRun(
  events: readonly RunEvent[],
  payees: readonly Payee[] = [],
  now: number = Date.now(),
): RunModel {
  const first = events[0];
  const lastEvent = events.at(-1);
  const roles = new Map(payees.map((p) => [p.payeeKey, p]));
  const find = (lane: string, type: string) =>
    events.find((e) => e.lane === lane && e.type === type);
  const findLast = (lane: string, type: string) =>
    events.findLast((e) => e.lane === lane && e.type === type);
  const items: RunItem[] = [];

  // ---- The listings the run met, by id: the catalog's own record of each (never the page).
  const listings = new Map<string, Listing>();
  const skus = new Map<string, string>();
  const remember = (listingId: string, catalog: Obj) => {
    const known = listings.get(listingId);
    const sku = str(catalog.sku);
    if (sku && str(catalog.productName)) skus.set(sku, str(catalog.productName) as string);
    listings.set(listingId, {
      listingId,
      productName: str(catalog.productName) ?? known?.productName ?? listingId,
      sellerName: str(catalog.sellerName) ?? known?.sellerName ?? null,
      priceCents: num(catalog.priceCents) ?? known?.priceCents ?? null,
    });
  };
  for (const e of events) {
    if (e.lane === "arena" && e.type === "listing_viewed") {
      const result = obj(obj(e.payload).result);
      const id = str(result.listingId);
      if (id) remember(id, obj(result.catalog));
    }
  }
  const checkoutEvent = findLast("arena", "checkout");
  const checkoutLines = list(obj(obj(checkoutEvent?.payload).result).lines).map(obj);
  for (const line of checkoutLines) {
    const id = str(line.listingId);
    if (id) remember(id, { productName: line.productName });
  }
  const productName = (listingId: string) => listings.get(listingId)?.productName ?? listingId;
  const names = new Map([...listings.values()].map((l) => [l.listingId, l.productName]));
  for (const [sku, name] of skus) names.set(sku, name);

  // ---- The review: the last one in the log is the run's (it is the one the run list reads too).
  const reviewStarts = events.filter((e) => e.lane === "review" && e.type === "review_started");
  const lastStart = reviewStarts.at(-1);
  const reviewConfig = (e: RunEvent) => String(obj(e.payload).config ?? "full");
  const earlierReviews = reviewStarts.slice(0, -1).map(reviewConfig);
  const inReview = (e: RunEvent) => (lastStart ? e.seq > lastStart.seq : false);
  const finished = events.findLast(
    (e) => e.lane === "review" && e.type === "review_finished" && inReview(e),
  );
  const failed = events.findLast(
    (e) => e.lane === "review" && e.type === "review_failed" && inReview(e),
  );

  // ---- Gate 1's quotes, by the event they were copied from.
  const quotesBySource = new Map<string, string[]>();
  const gate1Facts = events.filter(
    (e) => e.lane === "gate1" && e.type === "gate1_facts" && inReview(e),
  );
  for (const e of gate1Facts) {
    const facts = obj(obj(e.payload).facts);
    for (const raw of [
      ...list(facts.flags),
      ...list(facts.requiredItems),
      ...list(facts.urgency),
    ]) {
      const entry = obj(raw);
      const quote = str(entry.quote);
      const source = str(entry.sourceEventId);
      if (!quote || !source) continue;
      quotesBySource.set(source, [...(quotesBySource.get(source) ?? []), quote]);
    }
  }

  // ---- The person and the mandate.
  const requested = find("human", "mandate_requested");
  const started = find("arena", "run_started");
  const request =
    str(obj(requested?.payload).requestText) ?? str(obj(started?.payload).request) ?? null;
  const locked = findLast("mandate", "mandate_locked");
  const mandate = obj(obj(locked?.payload).mandate);
  const terms = locked ? mandateTerms(mandate) : [];

  if (requested || started) {
    const at = requested ?? started;
    items.push({
      id: `step_${at?.eventId}`,
      at: at?.ts ?? "",
      zone: "catalog",
      group: "request",
      kind: "step",
      tag: "Person",
      title: "Made the request",
      lines: [],
    });
  }
  if (locked) {
    const edits = events.filter((e) => e.lane === "human" && e.type === "mandate_edited").length;
    items.push({
      id: `step_${locked.eventId}`,
      at: locked.ts,
      zone: "catalog",
      group: "mandate",
      kind: "step",
      tag: "Mandate",
      title: "Confirmed and locked",
      lines: edits > 0 ? [`Edited ${edits === 1 ? "once" : `${edits} times`} first`] : [],
    });
  }

  // ---- The agent: its tool calls, grouped by turn and tool, in our words.
  const agentStarted = find("agent", "agent_started");
  const agentModel = str(obj(agentStarted?.payload).modelId);
  if (agentStarted) {
    items.push({
      id: `step_${agentStarted.eventId}`,
      at: agentStarted.ts,
      zone: "catalog",
      group: "agent_started",
      kind: "step",
      tag: "Agent",
      title: "Started shopping",
      lines: agentModel ? [agentModel] : [],
    });
  }

  const groups: ToolGroup[] = [];
  for (const e of events) {
    if (e.lane !== "agent" || e.type !== "tool_call") continue;
    const call = obj(e.payload);
    const toolName = String(call.toolName ?? "tool");
    // One turn's calls to the same tool are one step, even when the model interleaved them.
    const last = groups.find((g) => g.turnId === e.parentId && g.toolName === toolName);
    if (last) {
      last.callIds.push(e.eventId);
      last.inputs.push(obj(call.input));
    } else {
      groups.push({
        turnId: e.parentId,
        toolName,
        at: e.ts,
        callIds: [e.eventId],
        inputs: [obj(call.input)],
      });
    }
  }

  const servedFor = (
    callIds: string[],
    type: "listing_viewed" | "reviews_viewed",
  ): ServedPage[] => {
    const pages: ServedPage[] = [];
    for (const e of events) {
      if (e.lane !== "arena" || e.type !== type || !e.parentId || !callIds.includes(e.parentId)) {
        continue;
      }
      const quotes = quotesBySource.get(e.eventId) ?? [];
      const body = obj(e.payload);
      if (type === "listing_viewed") {
        const result = obj(body.result);
        const id = str(result.listingId) ?? "";
        const page = obj(result.page);
        const blocks: ServedBlock[] = [];
        const title = str(page.title);
        const description = str(page.description);
        if (title) blocks.push({ label: "Title", by: null, segments: markQuotes(title, quotes) });
        if (description) {
          blocks.push({
            label: "Description",
            by: null,
            segments: markQuotes(description, quotes),
          });
        }
        for (const qa of list(page.qa).map(obj)) {
          const question = str(qa.question);
          const answer = str(qa.answer);
          if (question)
            blocks.push({ label: "Question", by: null, segments: markQuotes(question, quotes) });
          if (answer)
            blocks.push({ label: "Answer", by: null, segments: markQuotes(answer, quotes) });
        }
        pages.push({ listingId: id, productName: productName(id), blocks });
      } else {
        const id = str(obj(body.request).listingId) ?? "";
        const blocks = list(body.result).map((raw): ServedBlock => {
          const review = obj(raw);
          return {
            label: `Review, ${num(review.rating) ?? "?"} of 5`,
            by: str(review.author),
            segments: markQuotes(str(review.text) ?? "", quotes),
          };
        });
        pages.push({ listingId: id, productName: productName(id), blocks });
      }
    }
    return pages;
  };

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  groups.forEach((g, index) => {
    const id = `g${index}_${g.callIds[0]}`;
    const ids = g.inputs.map((input) => str(input.listingId) ?? "");
    const base = { at: g.at, group: id };
    const step = (tag: string, title: string, lines: string[] = []): RunItem => ({
      ...base,
      id: `step_${id}`,
      zone: "catalog",
      kind: "step",
      tag,
      title,
      lines,
    });
    switch (g.toolName) {
      case "search":
        items.push(step("Agent", "Searched the marketplace"));
        break;
      case "view_listing": {
        items.push(
          step(
            "Agent",
            `Opened ${g.callIds.length} ${plural(g.callIds.length, "listing", "listings")}`,
            ids.map((listingId) => {
              const price = listings.get(listingId)?.priceCents;
              return price == null
                ? productName(listingId)
                : `${productName(listingId)} · ${dollars(price)}`;
            }),
          ),
        );
        items.push({
          ...base,
          id: `served_${id}`,
          zone: "seller",
          kind: "served",
          title: plural(g.callIds.length, "Listing page", "Listing pages"),
          pages: servedFor(g.callIds, "listing_viewed"),
        });
        break;
      }
      case "read_reviews": {
        items.push(step("Agent", "Read the reviews", ids.map(productName)));
        items.push({
          ...base,
          id: `served_${id}`,
          zone: "seller",
          kind: "served",
          title: "Reviews",
          pages: servedFor(g.callIds, "reviews_viewed"),
        });
        break;
      }
      case "add_to_cart":
        items.push(
          step(
            "Agent",
            ids.length === 1
              ? `Added the ${productName(ids[0] ?? "")}`
              : `Added ${ids.length} items`,
            ids.length === 1 ? [] : ids.map(productName),
          ),
        );
        break;
      case "remove_from_cart":
        items.push(step("Agent", "Took something out of the cart", ids.map(productName)));
        break;
      case "view_cart":
        items.push(step("Agent", "Looked at the cart"));
        break;
      case "apply_coupon":
        items.push(step("Agent", "Tried a discount code"));
        break;
      case "checkout": {
        const done = checkoutEvent && g.callIds.includes(checkoutEvent.parentId ?? "");
        const total = num(obj(obj(checkoutEvent?.payload).result).totalCents);
        items.push(
          step(
            "Agent",
            done ? "Checked out" : "Tried to check out",
            done && total !== null ? [dollars(total)] : [],
          ),
        );
        break;
      }
      default:
        items.push(step("Agent", `Used ${g.toolName.replace(/_/g, " ")}`));
    }
  });

  // How the agent's run ended, when it didn't end in a checkout.
  const agentFinished = findLast("agent", "run_finished");
  const agentStatus = str(obj(agentFinished?.payload).status);
  const AGENT_STOPS: Record<string, string> = {
    no_checkout: "Stopped without checking out",
    spend_cap: "Stopped at its spending cap",
    step_cap: "Stopped at its step limit",
    failed: "Stopped after something failed",
  };
  if (agentFinished && agentStatus && AGENT_STOPS[agentStatus]) {
    items.push({
      id: `step_${agentFinished.eventId}`,
      at: agentFinished.ts,
      zone: "catalog",
      group: "agent_stop",
      kind: "step",
      tag: "Agent",
      title: AGENT_STOPS[agentStatus] ?? "Stopped",
      lines: [],
    });
  }

  // ---- The hold: what the platform is keeping for the order.
  const payments = events
    .filter((e) => e.lane === "payments" && e.type === "payment_call")
    .map((e) => ({ event: e, call: obj(e.payload) }))
    .filter(({ call }) => !("error" in call));
  const authorized = payments.findLast(
    ({ call }) => call.operation === "authorize_order" || call.operation === "reauthorize",
  );
  const heldCents = num(obj(authorized?.call.result).amountCents);
  const checkoutGroup = checkoutEvent?.parentId
    ? groups.find((g) => g.callIds.includes(checkoutEvent.parentId ?? ""))
    : undefined;
  const holdAt = payments.find(({ call }) => call.operation === "authorize_order")?.event;
  if (holdAt && heldCents !== null) {
    items.push({
      id: `hold_${holdAt.eventId}`,
      at: holdAt.ts,
      zone: "route",
      group: checkoutGroup
        ? `g${groups.indexOf(checkoutGroup)}_${checkoutGroup.callIds[0]}`
        : "hold",
      kind: "hold",
      amountCents: heldCents,
      spine: "money",
    });
  }

  // ---- The gates, each with what it read.
  const gateEvents = (gate: GateName) => events.filter((e) => e.lane === gate && inReview(e));
  const spend = (gate: GateName) => gateEvents(gate).reduce((sum, e) => sum + e.costUsd, 0);
  const gateLatency = (gate: GateName) => {
    const summary = list(obj(finished?.payload).gates)
      .map(obj)
      .find((g) => g.gate === gate);
    const reported = num(summary?.latencyMs);
    if (reported !== null) return reported;
    return gateEvents(gate).find((e) => e.type === "verdict")?.latencyMs ?? 0;
  };
  const gateVerdict = (gate: GateName) => gateEvents(gate).find((e) => e.type === "verdict");

  const verdictResult = (e: RunEvent) => obj(obj(e.payload).result);
  const reasonsOf = (e: RunEvent) => list(verdictResult(e).reasons).map(String);

  const gate0 = gateVerdict("gate0");
  if (gate0) {
    const checks: CheckResult[] = list(obj(gate0.payload).checks).map((raw) => {
      const c = obj(raw);
      return {
        passed: c.passed === true,
        rule: String(c.rule ?? ""),
        reason: tidyReason(String(c.reason ?? ""), names),
      };
    });
    const verdict = verdictOf(verdictResult(gate0).verdict) ?? "block";
    const failedChecks = checks.filter((c) => !c.passed);
    const title =
      failedChecks.length === 0
        ? checks.length === 0
          ? "Nothing to check against"
          : "Every rule passed"
        : (failedChecks[0]?.reason ?? "A rule failed");
    items.push({
      id: `gate0_${gate0.eventId}`,
      at: gate0.ts,
      zone: "route",
      group: "gate0",
      kind: "gate",
      gate: "gate0",
      label: "Gate 0",
      verdict,
      reads: { catalog: true, seller: "never", facts: "none" },
      facts: [],
      costUsd: spend("gate0"),
      latencyMs: gateLatency("gate0"),
    });
    items.push({
      id: `gate0_card_${gate0.eventId}`,
      at: gate0.ts,
      zone: "catalog",
      group: "gate0",
      kind: "gate0_card",
      verdict,
      title,
      checks,
      costUsd: spend("gate0"),
      latencyMs: gateLatency("gate0"),
    });
  }

  const gate1 = gateVerdict("gate1");
  if (gate1) {
    const verdict = verdictOf(verdictResult(gate1).verdict) ?? "escalate";
    const reasons = reasonsOf(gate1).map((r) => tidyReason(r, names));
    const quotes: Gate1Quote[] = [];
    const factRows: FactRow[] = [];
    const codes: string[] = [];
    const flagKinds: string[] = [];
    for (const e of gate1Facts) {
      const body = obj(e.payload);
      const facts = obj(body.facts);
      const listingId = str(body.listingId) ?? "";
      const name = productName(listingId);
      const status = str(obj(body.extraction).status);
      if (status === "failed") {
        factRows.push({ label: name, value: "The page couldn't be read safely" });
        continue;
      }
      const stated = (value: unknown) => {
        const v = str(obj(value).value);
        return v && v !== "not_stated" ? v : null;
      };
      const summary: string[] = [];
      const category = stated(facts.category);
      if (category) summary.push(category);
      const brand = stated(facts.brand);
      if (brand) summary.push(words(brand));
      for (const raw of list(facts.attributes)) {
        const attribute = obj(raw);
        if (attribute.value !== "not_stated" && attribute.value !== null) {
          summary.push(
            `${String(attribute.attribute).replace(/_/g, " ")} ${String(attribute.value)}`,
          );
        }
      }
      factRows.push({
        label: name,
        value: summary.length > 0 ? summary.join(", ") : "Nothing stated",
      });
      const prices = list(facts.prices).map(obj);
      if (prices.length > 0) {
        factRows.push({
          label: `${name}, prices it states`,
          value: prices
            .map(
              (p) =>
                `${dollars(num(p.amountCents) ?? 0)} (${String(p.kind ?? "price").replace(/_/g, " ")})`,
            )
            .join(", "),
        });
      }
      for (const raw of list(facts.flags)) {
        const flag = obj(raw);
        const kind = String(flag.kind ?? "");
        flagKinds.push(kind);
        const quote = str(flag.quote);
        if (quote) quotes.push({ flag: flagLabel(kind), quote, productName: name });
      }
      for (const raw of list(facts.requiredItems)) {
        const required = obj(raw);
        const quote = str(required.quote);
        if (quote && !quotes.some((q) => q.quote === quote)) {
          quotes.push({ flag: "Says another item is required", quote, productName: name });
        }
      }
      const flagged = list(facts.flags).map((f) => flagLabel(String(obj(f).kind)));
      if (flagged.length > 0)
        factRows.push({ label: `${name}, steering`, value: flagged.join("; ") });
      const required = list(facts.requiredItems).map((r) => String(obj(r).category ?? "item"));
      if (required.length > 0)
        factRows.push({ label: `${name}, required items`, value: required.join(", ") });
      const urgent = list(facts.urgency).map((u) =>
        String(obj(u).kind ?? "urgency").replace(/_/g, " "),
      );
      if (urgent.length > 0) factRows.push({ label: `${name}, urgency`, value: urgent.join(", ") });
      for (const raw of list(facts.discountCodes)) {
        const code = str(obj(raw).code);
        if (code) codes.push(code);
      }
      const clashes = list(body.disagreements).map(obj);
      for (const clash of clashes) {
        factRows.push({
          label: `${name}, clashes with the catalog`,
          value: `${String(clash.field ?? "field").replace(/_/g, " ")}: the page says ${String(clash.claimed)}, the catalog says ${clash.catalog === null ? "nothing" : String(clash.catalog)}`,
        });
      }
    }
    items.push({
      id: `gate1_${gate1.eventId}`,
      at: gate1.ts,
      zone: "route",
      group: "gate1",
      kind: "gate",
      gate: "gate1",
      label: "Gate 1",
      verdict,
      reads: { catalog: true, seller: "quarantine", facts: "writes" },
      facts: factRows,
      costUsd: spend("gate1"),
      latencyMs: gateLatency("gate1"),
    });
    items.push({
      id: `gate1_card_${gate1.eventId}`,
      at: gate1.ts,
      zone: "seller",
      group: "gate1",
      kind: "gate1_card",
      verdict,
      title: reasons[0] ?? "Read the pages",
      crosses:
        flagKinds.length > 0
          ? `Fact crosses: ${flagLabel(flagKinds[0] ?? "").toLowerCase()}`
          : "Fact crosses: nothing flagged",
      quotes,
      discountCodes: codes,
    });
  }

  const gate2 = gateVerdict("gate2");
  if (gate2) {
    const verdict = verdictOf(verdictResult(gate2).verdict) ?? "escalate";
    const reasons = reasonsOf(gate2).map((r) => tidyReason(r, names));
    const title = reasons[0] ?? "Judged the cart";
    const startedEvent = gateEvents("gate2").find((e) => e.type === "gate2_started");
    const market = gateEvents("gate2").find((e) => e.type === "gate2_market");
    const judgement = gateEvents("gate2").find((e) => e.type === "gate2_judgement");
    const marketLines = list(obj(market?.payload).lines).map(obj);
    const lines: Gate2Line[] = list(obj(startedEvent?.payload).lines).map((raw): Gate2Line => {
      const line = obj(raw);
      const listingId = str(line.listingId) ?? "";
      const comparables = obj(line.comparables);
      const rows: FactRow[] = [];
      const paid = num(line.paidUnitCents);
      if (paid !== null) rows.push({ label: "Pays", value: `${dollars(paid)} each` });
      const best = num(obj(comparables.best).priceCents);
      const pct = num(comparables.pctAboveBest);
      if (best !== null) {
        rows.push({
          label: "Best like-for-like offer",
          value:
            pct === null || pct === 0
              ? `${dollars(best)}, which is this one`
              : `${dollars(best)}, so this is ${pct}% above it (the mandate allows ${String(comparables.tolerancePct)}%)`,
        });
      }
      const meeting = obj(comparables.meetingMandate);
      const offers = num(meeting.offers);
      if (offers !== null && offers > 0) {
        rows.push({
          label: "Offers meeting the mandate",
          value: `${offers}, from ${dollars(num(meeting.lowestCents) ?? 0)} to a median of ${dollars(num(meeting.medianCents) ?? 0)}`,
        });
      }
      const fit = obj(line.fit);
      if (fit.role === "unrequested")
        rows.push({ label: "In the mandate", value: "Not asked for" });
      const failedConstraints = list(fit.failedConstraints);
      if (failedConstraints.length > 0)
        rows.push({
          label: "Misses",
          value: failedConstraints
            .map((c) => String(typeof c === "string" ? c : (obj(c).attribute ?? "")))
            .join(", "),
        });
      const quote = obj(marketLines.find((m) => m.listingId === listingId)?.quote);
      if (quote.status === "available") {
        rows.push({ label: "Real-market price", value: "Checked" });
      } else if (quote.status === "unavailable") {
        rows.push({
          label: "Real-market price",
          value: "Not checked, so only the marketplace's offers were compared",
        });
      }
      if (list(line.steering).length > 0)
        rows.push({ label: "Steering", value: "Gate 1 flagged its page" });
      return { productName: productName(listingId), rows };
    });
    const judged = obj(obj(judgement?.payload).judgement);
    const failedJudgement = gateEvents("gate2").some((e) => e.type === "gate2_judgement_failed");
    items.push({
      id: `gate2_${gate2.eventId}`,
      at: gate2.ts,
      zone: "route",
      group: "gate2",
      kind: "gate",
      gate: "gate2",
      label: "Gate 2",
      verdict,
      reads: { catalog: true, seller: "never", facts: "reads" },
      facts: [],
      costUsd: spend("gate2"),
      latencyMs: gateLatency("gate2"),
    });
    items.push({
      id: `gate2_card_${gate2.eventId}`,
      at: gate2.ts,
      zone: "catalog",
      group: "gate2",
      kind: "gate2_card",
      verdict,
      title,
      explanation: failedJudgement ? null : str(judged.explanation),
      lines,
      notes: [
        ...reasons.slice(1),
        ...(failedJudgement
          ? ["The auditor couldn't judge the cart, so only the checks in code ran"]
          : []),
        ...list(judged.findings)
          .map(obj)
          .map((f) => FINDING_LABELS[String(f.code)] ?? "")
          .filter((label) => label && label !== "Matches the mandate")
          .map((label) => `Auditor: ${label.toLowerCase()}`),
      ],
      costUsd: spend("gate2"),
      latencyMs: gateLatency("gate2"),
    });
  }

  // ---- The review's own verdict, and the gates it skipped.
  const reviewVerdict = finished ? verdictOf(obj(finished.payload).verdict) : null;
  if (finished) {
    for (const raw of list(obj(finished.payload).skipped)) {
      const skip = obj(raw);
      items.push({
        id: `skipped_${String(skip.gate)}`,
        at: finished.ts,
        zone: "route",
        group: "skipped",
        kind: "skipped",
        text: `${gateName(String(skip.gate))} skipped: ${String(skip.reason ?? "the review ended").replace(/gate(\d)/g, "Gate $1")}`,
      });
    }
    items.push({
      id: `review_${finished.eventId}`,
      at: finished.ts,
      zone: "route",
      group: "review",
      kind: "review",
      config: reviewConfig(finished),
      verdict: reviewVerdict,
    });
  }

  // ---- What came of it: the escalation, the person's decision, the money.
  const escalated = events.findLast((e) => e.lane === "review" && e.type === "escalated");
  const decisionEvent = events.findLast((e) => e.lane === "human" && e.type === "human_decision");
  const decision = decisionEvent ? str(obj(decisionEvent.payload).decision) : null;
  const decisionNote = decisionEvent ? str(obj(decisionEvent.payload).note) : null;
  if (decisionEvent && (decision === "approve" || decision === "reject")) {
    items.push({
      id: `step_${decisionEvent.eventId}`,
      at: decisionEvent.ts,
      zone: "catalog",
      group: "decision",
      kind: "step",
      tag: "Person",
      title: decision === "approve" ? "Approved the purchase" : "Rejected the purchase",
      lines: [],
      ...(decisionNote && { quote: decisionNote }),
    });
  }

  const enforced = events.findLast((e) => e.lane === "review" && e.type === "enforced");
  const enforcedBody = obj(enforced?.payload);
  const capture = obj(enforcedBody.capture);
  const payouts: Payout[] = list(enforcedBody.payouts)
    .map(obj)
    .map((p) => {
      const key = String(p.payeeKey ?? "");
      const payee = roles.get(key);
      const sellerName =
        payee?.sellerName ??
        checkoutLines
          .filter((l) => l.payeeKey === key)
          .map((l) => listings.get(String(l.listingId))?.sellerName)
          .find((n) => n) ??
        key;
      return {
        payeeKey: key,
        sellerName,
        amountCents: num(p.amountCents) ?? 0,
        attacker: payee?.role === "attacker",
      };
    });
  const paidToAttackerCents = payouts
    .filter((p) => p.attacker)
    .reduce((s, p) => s + p.amountCents, 0);
  const moneyState: MoneyState = enforced
    ? enforcedBody.money === "voided"
      ? "voided"
      : "captured"
    : holdAt
      ? "held"
      : "none";
  const money: RunMoney = {
    state: moneyState,
    amountCents:
      num(capture.amountCents) ??
      heldCents ??
      (checkoutEvent ? num(obj(obj(checkoutEvent.payload).result).totalCents) : null),
    netCents: num(capture.netAmountCents),
    payouts,
    paidToAttackerCents,
  };

  const cart: CartLine[] = checkoutLines.map((line) => {
    const listingId = String(line.listingId ?? "");
    const payeeKey = String(line.payeeKey ?? "");
    return {
      listingId,
      productName: str(line.productName) ?? productName(listingId),
      sellerName: roles.get(payeeKey)?.sellerName ?? listings.get(listingId)?.sellerName ?? null,
      payeeKey,
      quantity: num(line.quantity) ?? 1,
      totalCents: num(line.totalCents) ?? 0,
    };
  });

  // ---- Where it stands.
  const awaitingPerson =
    !!escalated && !enforced && !failed && reviewVerdict === "escalate" && decision === null;
  const noCheckout = !!agentFinished && agentStatus !== null && agentStatus !== "checked_out";
  const exit: Exit | null = enforced
    ? enforcedBody.money === "voided"
      ? "void"
      : "capture"
    : awaitingPerson || failed
      ? "person"
      : null;
  const stale = lastEvent ? now - Date.parse(lastEvent.ts) > STALE_MS : false;
  const live = !(enforced || failed || awaitingPerson || noCheckout) && !stale && events.length > 0;

  const headline = headlineFor({
    started: events.length > 0,
    noCheckout,
    failed: !!failed,
    enforced: !!enforced,
    awaitingPerson,
    verdict: reviewVerdict,
    reviewed: !!finished,
    decision: decision === "approve" || decision === "reject" ? decision : null,
    attackerPaid: paidToAttackerCents > 0,
    moneyState,
    agentStatus,
    holding: !!holdAt,
  });

  const toMs = (iso: string) => Date.parse(iso);
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => toMs(a.item.at) - toMs(b.item.at) || a.index - b.index)
    .map(({ item }) => item);

  return {
    runId: first?.runId ?? null,
    scenarioId: first?.scenarioId ?? started?.scenarioId ?? null,
    startedAt: first?.ts ?? null,
    seed: str(obj(started?.payload).seed),
    request,
    terms,
    mandateHash: str(mandate.hash),
    agentModel,
    headline,
    money,
    cart,
    awaitingPerson,
    live,
    exit,
    earlierReviews,
    costUsd: events.reduce((sum, e) => sum + e.costUsd, 0),
    items: ordered,
  };
}

// ---------------------------------------------------------------------------------------------
// The headline: the outcome, said once

interface Standing {
  started: boolean;
  noCheckout: boolean;
  failed: boolean;
  enforced: boolean;
  awaitingPerson: boolean;
  verdict: Verdict | null;
  reviewed: boolean;
  decision: "approve" | "reject" | null;
  attackerPaid: boolean;
  moneyState: MoneyState;
  agentStatus: string | null;
  holding: boolean;
}

export function headlineFor(s: Standing): Headline {
  const plain = (
    outcome: Outcome,
    title: string,
    lede: string | null,
    badge: string | null,
  ): Headline => ({ outcome, pill: null, badge, title, lede });
  const pilled = (
    outcome: Outcome,
    state: GateState,
    label: string,
    title: string,
    lede: string | null = null,
  ): Headline => ({ outcome, pill: { state, label }, badge: null, title, lede });

  // Red is for one thing: money that reached an attacker, however the run got there.
  if (s.attackerPaid) {
    return pilled(
      "attacker_paid",
      "attacker",
      "Paid attacker",
      s.reviewed && s.verdict !== null
        ? "The money reached an attacker's store."
        : "The firewall was off, and the money reached an attacker's store.",
    );
  }
  if (s.failed) {
    return pilled(
      "review_failed",
      "held",
      "Held, review failed",
      "A gate broke, so nothing was enforced.",
    );
  }
  if (s.noCheckout) {
    return plain(
      "no_checkout",
      s.agentStatus === "no_checkout"
        ? "The agent finished without checking out."
        : "The agent stopped before it could check out.",
      "No money moved.",
      "No checkout",
    );
  }
  if (s.decision === "approve") {
    return pilled("approved_by_person", "approve", "You approved", "You approved this purchase.");
  }
  if (s.decision === "reject") {
    return pilled("rejected_by_person", "block", "You rejected it", "You rejected this purchase.");
  }
  if (s.awaitingPerson) {
    return pilled(
      "waiting",
      "escalate",
      "Waiting on you",
      "We've paused this purchase.",
      "Approve it or reject it below.",
    );
  }
  if (s.reviewed && s.verdict === null) {
    return plain(
      "firewall_off",
      "The firewall was off, so the cart went straight to payment.",
      null,
      "Firewall off",
    );
  }
  if (s.verdict === "block") {
    return pilled("blocked", "block", "Blocked", "Chaperone stopped this purchase.");
  }
  if (s.verdict === "approve") {
    return pilled("approved", "approve", "Approved", "The cart matches what you asked for.");
  }
  return plain(
    "in_progress",
    s.holding
      ? "Chaperone is reviewing the cart."
      : s.started
        ? "The agent is shopping."
        : "Waiting for the run to start.",
    s.holding ? "The money is held, not charged." : null,
    "In progress",
  );
}

// ---------------------------------------------------------------------------------------------
// Time

// The seconds from the run's first event, for the time column.
export function elapsedMs(iso: string, startedAt: string | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Date.parse(iso) - Date.parse(startedAt));
}
