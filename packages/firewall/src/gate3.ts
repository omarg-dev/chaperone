import type { Catalog } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import type { LockedMandate, TokenCounts } from "@firewall/mandate";
import { AuditError } from "./auditor.js";
import { type CartLine, type CheckoutLine, cartLines, mandateFit } from "./comparables.js";
import type { GateResult } from "./gate.js";
import { decideGate3, type Gate3Finding, type TraceLine } from "./gate3-verdict.js";
import type { ReviewerView } from "./reviewer-view.js";
import { checkoutOf, mandateOf, Refs } from "./run-inputs.js";
import { type Choice, choicesOf, stepsOf, type TraceStep } from "./trace.js";
import type { TraceAuditor, TraceAuditResult, TraceView } from "./trace-auditor.js";

// Gate 3, the trace auditor, over one run's event log. It reads:
//  - the locked mandate, through lockedMandateOf, which verifies its hash;
//  - the arena's record of the agent's calls, as the catalog sees them (trace.ts): the tools it
//    called, the listings it opened, their order, what it added and when;
//  - Gate 1's result through factsForReviewers only, never an arena page event's content.
// It never reads page text, search words, coupon codes, error messages or anything the agent said:
// see trace.ts for why. Code works out each cart line's exposures (flagged pages read before it
// was added), the auditor judges whether the choice followed them, and gate3-verdict.ts decides
// by rule. Everything goes to the gate3 lane, all system:
//  - gate3_started: what it read, by event ID and mandate hash, and the trace it computed, with
//    each step's time;
//  - gate3_judgement (with the auditor's answer) or gate3_judgement_failed (with why), each with
//    the call's tokens, cost and latency, once;
//  - verdict: the gate's result and findings, with the gate's totals and latency.
//
// Gate 3 runs after Gate 2 in the review tree (review.ts). It needs Gate 1's facts and not
// Gate 2's answer, so it could run beside it; after it, a block by Gate 2 ends the review and
// Gate 3's call is never made, and the tree keeps one order that the events replay in.

export interface Gate3Options {
  log: EventLog;
  auditor: TraceAuditor;
  // What Gate 1 handed on for this run: its reviewer view, and the event holding its verdict.
  gate1: { reviewerView: ReviewerView; verdictEventId: string };
  now?: () => number;
}

export interface Gate3Run {
  result: GateResult;
  findings: Gate3Finding[];
  steps: TraceStep[];
  lines: TraceLine[];
  // What the auditor was shown, when it was asked.
  view: TraceView | null;
  audit: TraceAuditResult | null;
  verdictEventId: string;
  tokens: TokenCounts | null;
  costUsd: number;
  latencyMs: number;
}

export class Gate3InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gate3InputError";
  }
}

const describeStep = (s: TraceStep) =>
  `the arena's record of step ${s.step}: ${s.tool}${s.listing ? ` of ${s.listing.listingId}` : ""}`;

// What the auditor is shown. Everything here is the catalog's, the person's or code's: no page
// text, no search words, no word of the agent's own.
export function traceView(input: {
  mandate: LockedMandate;
  mandateEventId: string;
  checkoutEventId: string;
  totalCents: number;
  steps: readonly TraceStep[];
  lines: readonly TraceLine[];
  gate1: { reviewerView: ReviewerView; verdictEventId: string };
  inputsEventId: string;
}): { view: TraceView; eventIdOf: (ref: string) => string | undefined } {
  const refs = new Refs();
  const checkout = refs.ref(input.checkoutEventId, "the checkout: the cart's lines and prices");
  const mandateRef = refs.ref(input.mandateEventId, "the mandate the person confirmed");
  refs.ref(input.inputsEventId, "the firewall's computed account of how each line was chosen");
  const gate1Ref = refs.ref(input.gate1.verdictEventId, "Gate 1's verdict");
  const stepRef = new Map(
    input.steps.map((s) => [s.eventId, refs.ref(s.eventId, describeStep(s))]),
  );
  const page = "a call that served page content (its facts are in gate1)";
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
    },
    cart: {
      evidence: checkout,
      totalCents: input.totalCents,
      lines: input.lines.map(({ line, fit }) => ({
        line: line.line,
        listingId: line.listingId,
        quantity: line.quantity,
        paidUnitCents: line.paidUnitCents,
        mandateRole: fit.role,
      })),
    },
    trace: {
      steps: input.steps.map((s) => ({
        step: s.step,
        evidence: stepRef.get(s.eventId),
        tool: s.tool,
        ...(s.failed && { refused: true }),
        listing: s.listing,
        search: s.search,
        quantity: s.quantity,
        coupon: s.coupon,
        flagged: s.flagged,
      })),
      choices: input.lines.map(({ choice }) => ({
        ...choice,
        exposures: choice.exposures.map(({ eventId, ...e }) => ({
          ...e,
          evidence: stepRef.get(eventId),
        })),
      })),
    },
    gate1: {
      evidence: gate1Ref,
      verdict: g1.result.verdict,
      confidence: g1.result.confidence,
      reasons: g1.result.reasons,
      listings: g1.listings.map((l) => ({
        listingId: l.listingId,
        inCart: l.inCart,
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

const traceRecord = (steps: readonly TraceStep[], choices: readonly Choice[]) => ({
  steps: steps.map((s, i) => ({
    ...s,
    // Time since the call before, for reading the log.
    sincePreviousMs: i === 0 ? 0 : s.atMs - (steps[i - 1]?.atMs ?? 0),
  })),
  choices,
});

export async function runGate3(
  runId: string,
  catalog: Catalog,
  options: Gate3Options,
): Promise<Gate3Run> {
  const { log, auditor } = options;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const events = log.listRun(runId);
  const checkout = checkoutOf(events, (message) => new Gate3InputError(message));
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
      lane: "gate3",
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

  // Everything code can work out from the arena's record and the catalog.
  const steps = stepsOf(events, catalog, options.gate1.reviewerView);
  const cart: CartLine[] = cartLines(checkout.order.lines as CheckoutLine[], catalog);
  const choices = choicesOf(steps, cart, catalog);

  if (!mandate || status.status !== "intact") {
    const start = append("gate3_started", checkout.event.eventId, {
      references,
      model: null,
      ...traceRecord(steps, choices),
    });
    const { result, findings } = decideGate3({
      mandate: status,
      lines: [],
      judgement: null,
      failure: null,
      eventIdOf: () => undefined,
      evidence: {
        checkoutEventId: checkout.event.eventId,
        inputsEventId: start.eventId,
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
      steps,
      lines: [],
      view: null,
      audit: null,
      verdictEventId: verdict.eventId,
      tokens: null,
      costUsd: 0,
      latencyMs,
    };
  }

  const lines: TraceLine[] = cart.map((line, i) => ({
    line,
    fit: mandateFit(line, mandate),
    choice: choices[i] as Choice,
  }));
  const start = append("gate3_started", checkout.event.eventId, {
    references,
    model: auditor.model,
    ...traceRecord(steps, choices),
    lines: lines.map(({ line, fit }) => ({
      line: line.line,
      listingId: line.listingId,
      quantity: line.quantity,
      role: fit.role,
    })),
  });

  // The judgement.
  const { view, eventIdOf } = traceView({
    mandate,
    mandateEventId: status.eventId,
    checkoutEventId: checkout.event.eventId,
    totalCents: checkout.order.totalCents,
    steps,
    lines,
    gate1: options.gate1,
    inputsEventId: start.eventId,
  });
  let audit: TraceAuditResult | null = null;
  let failure: AuditError | null = null;
  try {
    audit = await auditor.audit(view);
  } catch (error) {
    if (!(error instanceof AuditError)) throw error;
    failure = error;
  }
  const judgementEvent = audit
    ? append(
        "gate3_judgement",
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
        "gate3_judgement_failed",
        start.eventId,
        {
          code: failure?.code,
          error: failure?.message,
          problems: failure?.details.problems ?? [],
          tokens: failure?.details.tokens ?? null,
        },
        { costUsd: failure?.details.costUsd ?? 0, latencyMs: failure?.details.latencyMs ?? 0 },
      );

  const { result, findings } = decideGate3({
    mandate: status,
    lines,
    judgement: audit?.judgement ?? null,
    failure: failure?.code ?? null,
    eventIdOf,
    evidence: {
      checkoutEventId: checkout.event.eventId,
      inputsEventId: start.eventId,
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
    steps,
    lines,
    view,
    audit,
    verdictEventId: verdict.eventId,
    tokens,
    costUsd,
    latencyMs,
  };
}
