import type { Catalog } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import type { LockedMandate, TokenCounts } from "@firewall/mandate";
import { AuditError, type AuditResult, type AuditView, type IntentAuditor } from "./auditor.js";
import {
  type CartLine,
  type CheckoutLine,
  type Comparables,
  cartLines,
  comparablesFor,
  mandateFit,
} from "./comparables.js";
import type { GateResult } from "./gate.js";
import { decideGate2, type Gate2Finding, type LineReview } from "./gate2-verdict.js";
import { type MarketReference, marketCheck, marketQueryFor } from "./market.js";
import type { ReviewerView } from "./reviewer-view.js";
import { checkoutOf, mandateOf, Refs } from "./run-inputs.js";
import { STEERING_FLAGS } from "./verdict.js";

// Gate 2, the intent auditor, over one run's event log. It reads:
//  - the locked mandate, through lockedMandateOf, which verifies its hash;
//  - the checkout's numbers (listing, quantity, prices), and each listing's facts from the
//    catalog, never the checkout's line titles, which are the sellers' page titles;
//  - Gate 1's result through factsForReviewers only, never an arena page event;
//  - comparable offers from the catalog, and a real-market reference when one answers, which is
//    recorded and noted on the verdict but never shown to the auditor or acted on.
// It computes the comparables and the price checks in code, asks the auditor for its judgement,
// decides the verdict by rule (gate2-verdict.ts), and writes every step to the gate2 lane:
//  - gate2_started (system): what it read, by event ID and hash, and everything it computed;
//  - gate2_market (system): each line's market quote, or why there was none, with the lookups'
//    latency;
//  - gate2_judgement (system) with the auditor's answer, or gate2_judgement_failed with why, each
//    with the call's tokens, cost and latency;
//  - verdict (system): the gate's result and findings, with the gate's totals and latency.

export interface Gate2Options {
  log: EventLog;
  auditor: IntentAuditor;
  market: MarketReference;
  // What Gate 1 handed on for this run: its reviewer view, and the event holding its verdict.
  gate1: { reviewerView: ReviewerView; verdictEventId: string };
  now?: () => number;
}

export interface Gate2Run {
  result: GateResult;
  findings: Gate2Finding[];
  lines: LineReview[];
  // What the auditor was shown, when it was asked.
  view: AuditView | null;
  audit: AuditResult | null;
  verdictEventId: string;
  tokens: TokenCounts | null;
  costUsd: number;
  latencyMs: number;
}

export class Gate2InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gate2InputError";
  }
}

const comparablesSummary = (c: Comparables | null) =>
  c && {
    likeForLike: {
      offers: c.likeForLike.length,
      bestCents: c.best?.priceCents ?? null,
      bestListingId: c.best?.listingId ?? null,
      paidVsBestPct: c.pctAboveBest,
      tolerancePct: c.tolerancePct,
      beyondTolerance: c.beyondTolerance,
    },
    meetingMandate: c.meetingMandate,
  };

// What the auditor is shown. Everything here is the catalog's, the person's or code's: the
// checkout's line titles, page events and Gate 1's quotes are never read into it.
export function auditView(input: {
  mandate: LockedMandate;
  mandateEventId: string;
  checkoutEventId: string;
  totalCents: number;
  lines: readonly LineReview[];
  gate1: { reviewerView: ReviewerView; verdictEventId: string };
  inputsEventId: string;
}): { view: AuditView; eventIdOf: (ref: string) => string | undefined } {
  const refs = new Refs();
  const checkout = refs.ref(input.checkoutEventId, "the checkout: the cart's lines and prices");
  const mandateRef = refs.ref(input.mandateEventId, "the mandate the person confirmed");
  const computed = refs.ref(
    input.inputsEventId,
    "the firewall's computed comparables and price checks",
  );
  const gate1Ref = refs.ref(input.gate1.verdictEventId, "Gate 1's verdict");
  const page = "a listing page the agent was served (its facts are in gate1)";
  const { mandate } = input;
  const g1 = input.gate1.reviewerView;

  const data = {
    mandate: {
      evidence: mandateRef,
      request: mandate.requestText,
      category: mandate.category,
      constraints: mandate.constraints,
      brandPolicy: mandate.brandPolicy,
      maxUnitPriceCents: mandate.maxUnitPriceCents,
      quantity: mandate.quantity,
      allowedExtras: mandate.allowedExtras,
      notExpressible: mandate.unmapped,
      priceToleranceVsBestOfferPct: mandate.tolerances.priceVsBestOfferPct,
    },
    cart: {
      evidence: checkout,
      totalCents: input.totalCents,
      lines: input.lines.map(({ line, comparables }) => ({
        line: line.line,
        listingId: line.listingId,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        paidUnitCents: line.paidUnitCents,
        catalog: line.record && {
          sku: line.record.sku,
          category: line.record.category,
          brandId: line.record.brandId,
          brandReputable: line.brandReputable,
          sellerId: line.record.sellerId,
          sellerVerified: line.sellerVerified,
          attributes: line.record.attributes,
        },
        comparables: comparables && { evidence: computed, ...comparablesSummary(comparables) },
      })),
    },
    gate1: {
      evidence: gate1Ref,
      verdict: g1.result.verdict,
      confidence: g1.result.confidence,
      reasons: g1.result.reasons,
      listings: g1.listings.map((l) => ({
        ...l,
        flags: l.flags.map(({ sourceEventId, ...f }) => ({
          ...f,
          evidence: refs.refOrNull(sourceEventId, page),
        })),
        disagreements: l.disagreements.map(({ sourceEventId, ...d }) => ({
          ...d,
          evidence: refs.refOrNull(sourceEventId, page),
        })),
      })),
    },
    evidenceRefs: refs.described,
  };
  return {
    view: { data, refs: refs.all(), lines: input.lines.length },
    eventIdOf: refs.eventIdOf,
  };
}

const lineRecord = (l: LineReview) => ({
  line: l.line.line,
  listingId: l.line.listingId,
  quantity: l.line.quantity,
  unitPriceCents: l.line.unitPriceCents,
  paidUnitCents: l.line.paidUnitCents,
  catalog: l.line.record,
  brandReputable: l.line.brandReputable,
  sellerVerified: l.line.sellerVerified,
  fit: l.fit,
  comparables: l.comparables,
  steering: l.steering,
});

export async function runGate2(
  runId: string,
  catalog: Catalog,
  options: Gate2Options,
): Promise<Gate2Run> {
  const { log, auditor, market } = options;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const events = log.listRun(runId);
  const checkout = checkoutOf(events, (message) => new Gate2InputError(message));
  const { status, mandate } = mandateOf(events);
  const append = (
    type: string,
    parentId: string,
    payload: unknown,
    spend: { costUsd?: number; latencyMs?: number } = {},
  ): Event =>
    log.append({
      runId,
      scenarioId: checkout.event.scenarioId,
      lane: "gate2",
      type,
      provenance: "system",
      parentId,
      payload,
      ...spend,
    });
  const references = {
    checkoutEventId: checkout.event.eventId,
    mandate:
      status.status === "intact"
        ? { status: "intact", eventId: status.eventId, hash: mandate?.hash }
        : status,
    gate1VerdictEventId: options.gate1.verdictEventId,
  };

  if (!mandate || status.status !== "intact") {
    const start = append("gate2_started", checkout.event.eventId, { references, model: null });
    const { result, findings } = decideGate2({
      mandate: status,
      lines: [],
      judgement: null,
      failure: null,
      eventIdOf: () => undefined,
      evidence: {
        checkoutEventId: checkout.event.eventId,
        inputsEventId: start.eventId,
        marketEventId: null,
        judgementEventId: null,
        gate1VerdictEventId: options.gate1.verdictEventId,
      },
    });
    const latencyMs = Math.round(now() - started);
    const verdict = append(
      "verdict",
      start.eventId,
      { result, findings, model: null, calls: 0, tokens: null, costUsd: 0 },
      { latencyMs },
    );
    return {
      result,
      findings,
      lines: [],
      view: null,
      audit: null,
      verdictEventId: verdict.eventId,
      tokens: null,
      costUsd: 0,
      latencyMs,
    };
  }

  // Everything code can work out from the catalog.
  const lines: CartLine[] = cartLines(checkout.order.lines as CheckoutLine[], catalog);
  const flagsOf = (listingId: string) =>
    options.gate1.reviewerView.listings
      .filter((l) => l.listingId === listingId)
      .flatMap((l) => l.flags)
      .filter((f) => STEERING_FLAGS.includes(f.kind))
      .map(({ kind, sourceEventId }) => ({ kind, sourceEventId }));
  const reviews: LineReview[] = lines.map((line) => ({
    line,
    fit: mandateFit(line, mandate),
    comparables: comparablesFor(line, mandate, catalog),
    market: null,
    steering: flagsOf(line.listingId),
  }));
  const start = append("gate2_started", checkout.event.eventId, {
    references,
    model: auditor.model,
    market: market.source,
    lines: reviews.map(lineRecord),
  });

  // The market reference, one lookup per line the catalog knows, side by side.
  const lookupsStarted = now();
  const quotes = await Promise.all(
    reviews.map((r) => (r.line.record ? market.lookup(marketQueryFor(r.line.record)) : null)),
  );
  reviews.forEach((r, i) => {
    const quote = quotes[i];
    if (quote) {
      r.market = marketCheck(r.line.paidUnitCents, quote);
    }
  });
  const marketEvent = append(
    "gate2_market",
    start.eventId,
    {
      source: market.source,
      lines: reviews.map((r) => ({
        line: r.line.line,
        listingId: r.line.listingId,
        quote: r.market?.quote ?? null,
        pctAboveMedian: r.market?.pctAboveMedian ?? null,
      })),
    },
    { latencyMs: Math.round(now() - lookupsStarted) },
  );

  // The judgement.
  const { view, eventIdOf } = auditView({
    mandate,
    mandateEventId: status.eventId,
    checkoutEventId: checkout.event.eventId,
    totalCents: checkout.order.totalCents,
    lines: reviews,
    gate1: options.gate1,
    inputsEventId: start.eventId,
  });
  let audit: AuditResult | null = null;
  let failure: AuditError | null = null;
  try {
    audit = await auditor.audit(view);
  } catch (error) {
    if (!(error instanceof AuditError)) throw error;
    failure = error;
  }
  const judgementEvent = audit
    ? append(
        "gate2_judgement",
        start.eventId,
        {
          judgement: audit.judgement,
          model: audit.model,
          tokens: audit.tokens,
          thinkingTokens: audit.thinkingTokens,
        },
        { costUsd: audit.costUsd, latencyMs: audit.latencyMs },
      )
    : append(
        "gate2_judgement_failed",
        start.eventId,
        {
          code: failure?.code,
          error: failure?.message,
          problems: failure?.details.problems ?? [],
          tokens: failure?.details.tokens ?? null,
        },
        { costUsd: failure?.details.costUsd ?? 0, latencyMs: failure?.details.latencyMs ?? 0 },
      );

  const { result, findings } = decideGate2({
    mandate: status,
    lines: reviews,
    judgement: audit?.judgement ?? null,
    failure: failure?.code ?? null,
    eventIdOf,
    evidence: {
      checkoutEventId: checkout.event.eventId,
      inputsEventId: start.eventId,
      marketEventId: marketEvent.eventId,
      judgementEventId: judgementEvent.eventId,
      gate1VerdictEventId: options.gate1.verdictEventId,
    },
  });
  const tokens = audit?.tokens ?? failure?.details.tokens ?? null;
  const costUsd = audit?.costUsd ?? failure?.details.costUsd ?? 0;
  const latencyMs = Math.round(now() - started);
  // The call's spend is on the judgement event; the verdict carries the totals for reading.
  const verdict = append(
    "verdict",
    start.eventId,
    { result, findings, model: auditor.model, calls: 1, tokens, costUsd },
    { latencyMs },
  );
  return {
    result,
    findings,
    lines: reviews,
    view,
    audit,
    verdictEventId: verdict.eventId,
    tokens,
    costUsd,
    latencyMs,
  };
}
