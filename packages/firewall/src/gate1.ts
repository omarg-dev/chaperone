import type { Catalog } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import { attributesByName, type TokenCounts } from "@firewall/mandate";
import { catalogRecord, crossCheck } from "./crosscheck.js";
import { ExtractionError, type ExtractionResult, type ListingExtractor } from "./extractor.js";
import { extractionVocabulary } from "./facts.js";
import type { GateResult } from "./gate.js";
import { refineFacts } from "./refine.js";
import { factsForReviewers, type ReviewerView } from "./reviewer-view.js";
import { type Gate1Scope, gate1Scope, type ListingInScope } from "./sources.js";
import { decideGate1, type ExtractionStatus, type ListingReview } from "./verdict.js";

// Gate 1, the quarantined extractor, over one run's event log. It reads the page content the agent
// was served (sources.ts), has the extractor turn each listing's page into typed facts, checks
// those facts against the trusted catalog in code, decides its verdict by rule, and writes every
// step to the gate1 lane:
//  - gate1_started (system): what it is about to read, by event ID, under the checkout event;
//  - gate1_extraction_failed (system): a page the extractor couldn't read, why, and what it cost;
//  - gate1_facts (extracted): one listing's facts, its disagreements with the catalog, and the
//    call's tokens, cost and latency;
//  - verdict (system): the gate's result, with the gate's total tokens, cost and latency.
// The catalog is the run's own (the arena's), the marketplace's trusted record of every listing.

export interface Gate1Options {
  log: EventLog;
  extractor: ListingExtractor;
  now?: () => number;
}

export interface Gate1Run {
  scope: Gate1Scope;
  reviews: ListingReview[];
  result: GateResult;
  // What Gate 2 and Gate 3 may be given. Never the page text.
  reviewerView: ReviewerView;
  verdictEventId: string;
  tokens: TokenCounts;
  costUsd: number;
  latencyMs: number;
}

type Attempt =
  | { kind: "extracted"; result: ExtractionResult }
  | { kind: "failed"; error: ExtractionError }
  | { kind: "nothing_to_read" };

const ZERO: TokenCounts = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};
const addTokens = (a: TokenCounts, b: TokenCounts | undefined): TokenCounts =>
  b
    ? {
        inputTokens: a.inputTokens + b.inputTokens,
        cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
        cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
        outputTokens: a.outputTokens + b.outputTokens,
      }
    : a;

async function attempt(extractor: ListingExtractor, listing: ListingInScope): Promise<Attempt> {
  if (listing.documents.length === 0) return { kind: "nothing_to_read" };
  try {
    return { kind: "extracted", result: await extractor.extract(listing) };
  } catch (error) {
    // Anything else is a bug, not a page the extractor couldn't read.
    if (error instanceof ExtractionError) return { kind: "failed", error };
    throw error;
  }
}

export async function runGate1(
  runId: string,
  catalog: Catalog,
  options: Gate1Options,
): Promise<Gate1Run> {
  const { log, extractor } = options;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const scope = gate1Scope(log.listRun(runId));
  const attributes = attributesByName(extractionVocabulary(catalog));
  const append = (
    type: string,
    provenance: "system" | "extracted",
    parentId: string,
    payload: unknown,
    spend: { costUsd?: number; latencyMs?: number } = {},
  ): Event =>
    log.append({
      runId,
      scenarioId: scope.scenarioId,
      lane: "gate1",
      type,
      provenance,
      parentId,
      payload,
      ...spend,
    });

  const start = append("gate1_started", "system", scope.checkoutEventId, {
    checkoutEventId: scope.checkoutEventId,
    model: extractor.model,
    listings: scope.listings.map((l) => ({
      listingId: l.listingId,
      inCart: l.inCart,
      sourceEventIds: l.sourceEventIds,
      documents: l.documents.length,
    })),
  });

  // Side by side: the gate takes about as long as its slowest page.
  const attempts = await Promise.all(scope.listings.map((l) => attempt(extractor, l)));

  let tokens = ZERO;
  let cost = 0;
  const reviews: ListingReview[] = scope.listings.map((listing, i) => {
    const tried = attempts[i] as Attempt;
    let extraction: ExtractionStatus;
    let spend: { tokens?: TokenCounts; costUsd?: number; latencyMs?: number } = {};
    if (tried.kind === "failed") {
      extraction = { status: "failed", code: tried.error.code };
      spend = tried.error.details;
      append(
        "gate1_extraction_failed",
        "system",
        start.eventId,
        {
          listingId: listing.listingId,
          code: tried.error.code,
          error: tried.error.message,
          problems: tried.error.details.problems ?? [],
          tokens: spend.tokens ?? null,
        },
        { costUsd: spend.costUsd ?? 0, latencyMs: spend.latencyMs ?? 0 },
      );
      // The tripwires still ran, and their flags are still facts (below), but the call's cost is
      // on the failure, so it's counted once.
    } else {
      extraction = { status: tried.kind };
      if (tried.kind === "extracted") spend = tried.result;
    }
    tokens = addTokens(tokens, spend.tokens);
    cost += spend.costUsd ?? 0;

    const facts = refineFacts(
      tried.kind === "extracted" ? tried.result.facts : null,
      listing,
      attributes,
    );
    const disagreements = crossCheck(facts, catalogRecord(catalog, listing.listingId));
    const review: ListingReview = {
      listingId: listing.listingId,
      inCart: listing.inCart,
      sourceEventIds: listing.sourceEventIds,
      extraction,
      facts,
      disagreements,
    };
    const extracted = tried.kind === "extracted" ? tried.result : null;
    append(
      "gate1_facts",
      "extracted",
      start.eventId,
      {
        ...review,
        model: extracted?.model ?? null,
        tokens: extracted?.tokens ?? null,
        thinkingTokens: extracted?.thinkingTokens ?? null,
      },
      { costUsd: extracted?.costUsd ?? 0, latencyMs: extracted?.latencyMs ?? 0 },
    );
    return review;
  });

  const result = decideGate1(reviews, scope.checkoutEventId);
  const latencyMs = Math.round(now() - started);
  const calls = attempts.filter((a) => a.kind !== "nothing_to_read").length;
  // The spend is already on the per-listing events; the verdict carries the totals for reading,
  // with no cost of its own, so adding up the lane counts each call once.
  const verdict = append(
    "verdict",
    "system",
    start.eventId,
    { result, model: extractor.model, calls, tokens, costUsd: cost },
    { latencyMs },
  );
  return {
    scope,
    reviews,
    result,
    reviewerView: factsForReviewers(result, reviews),
    verdictEventId: verdict.eventId,
    tokens,
    costUsd: cost,
    latencyMs,
  };
}
