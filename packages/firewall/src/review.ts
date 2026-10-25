import type { Catalog } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import type { IntentAuditor } from "./auditor.js";
import type { ListingExtractor } from "./extractor.js";
import {
  combineVerdicts,
  endsReview,
  type GateName,
  type GateResult,
  type Verdict,
} from "./gate.js";
import { catalogForRun, runGate0 } from "./gate0.js";
import { type Gate1Run, runGate1 } from "./gate1.js";
import { runGate2 } from "./gate2.js";
import type { MarketReference } from "./market.js";

// The review tree, over one run whose agent has checked out. Gate 0 runs first, and a block there
// ends the review with no model cost. Otherwise Gate 1 reads the pages, then Gate 2 audits the cart
// with Gate 1's facts. The tree's verdict is the most severe of the gates' (combineVerdicts), and
// any block ends the review where it stands.
//
// The firewall configuration says how much of the tree runs, so the eval can ablate it on the same
// checkout: `off` reviews nothing, `gate0` runs the policy rules only, `full` runs every gate there
// is. Gate 3 (the trace auditor) joins `full` after Gate 2, in CONFIG_GATES and in the tree below.
//
// Events, all on the review lane with provenance system and no cost of their own (the gates' events
// carry the spend, so adding up a run counts each call once):
//  - review_started: the configuration and the gates it will run, under the checkout;
//  - review_finished: the tree's verdict, each gate's verdict and event ID, the gates that were
//    skipped and why, and the totals;
//  - review_failed: a gate broke in a way it couldn't decide through (a bug or an outage). Nothing is
//    enforced then: the order stays held.
// A configuration of `off` writes both events too, with a null verdict: nobody reviewed the cart.

export const FIREWALL_CONFIGS = ["off", "gate0", "full"] as const;
export type FirewallConfig = (typeof FIREWALL_CONFIGS)[number];

export const isFirewallConfig = (value: string): value is FirewallConfig =>
  (FIREWALL_CONFIGS as readonly string[]).includes(value);

// The gates each configuration runs, in the order they run.
export const CONFIG_GATES: Record<FirewallConfig, readonly GateName[]> = {
  off: [],
  gate0: ["gate0"],
  full: ["gate0", "gate1", "gate2"],
};

export class ReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewInputError";
  }
}

// What Gates 1 and 2 need, which only `full` uses.
export interface ReviewGates {
  extractor: ListingExtractor;
  auditor: IntentAuditor;
  market: MarketReference;
}

export interface ReviewOptions {
  log: EventLog;
  config: FirewallConfig;
  gates?: ReviewGates;
  // The catalog the run's arena was built from. Defaults to the base catalog.
  baseCatalog?: Catalog;
  now?: () => number;
}

export interface GateOutcome {
  gate: GateName;
  verdict: Verdict;
  verdictEventId: string;
  costUsd: number;
  latencyMs: number;
  result: GateResult;
}

export interface ReviewRun {
  config: FirewallConfig;
  // Null when the configuration reviewed nothing.
  verdict: Verdict | null;
  gates: GateOutcome[];
  skipped: { gate: GateName; reason: string }[];
  checkoutEventId: string;
  startedEventId: string;
  // The review's verdict event: what enforcement points at.
  finishedEventId: string;
  costUsd: number;
  latencyMs: number;
}

const outcomeOf = (
  gate: GateName,
  result: GateResult,
  run: { verdictEventId: string; costUsd: number; latencyMs: number },
): GateOutcome => ({
  gate,
  verdict: result.verdict,
  verdictEventId: run.verdictEventId,
  costUsd: run.costUsd,
  latencyMs: run.latencyMs,
  result,
});

const gateRecord = (g: GateOutcome) => ({
  gate: g.gate,
  verdict: g.verdict,
  verdictEventId: g.verdictEventId,
  confidence: g.result.confidence,
  // Written by each gate's code and never seller text, so safe for the person to read.
  reasons: g.result.reasons,
  costUsd: g.costUsd,
  latencyMs: g.latencyMs,
});

export async function runReview(runId: string, options: ReviewOptions): Promise<ReviewRun> {
  const { log, config } = options;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const events = log.listRun(runId);
  const checkout = events.findLast((e) => e.lane === "arena" && e.type === "checkout");
  if (!checkout) throw new ReviewInputError("The run has no checkout to review");
  const planned = CONFIG_GATES[config];
  if (planned.includes("gate1") && !options.gates) {
    throw new ReviewInputError(`The "${config}" configuration needs the model gates`);
  }

  const append = (type: string, parent: Event, payload: unknown, latencyMs?: number): Event =>
    log.append({
      runId,
      scenarioId: checkout.scenarioId,
      lane: "review",
      type,
      provenance: "system",
      parentId: parent.eventId,
      payload,
      ...(latencyMs !== undefined && { latencyMs }),
    });

  const start = append("review_started", checkout, {
    config,
    gates: planned,
    checkoutEventId: checkout.eventId,
  });

  const outcomes: GateOutcome[] = [];
  // What Gate 1 hands on to Gate 2.
  let gate1: Gate1Run | null = null;
  const skipped: { gate: GateName; reason: string }[] = [];
  try {
    for (const gate of planned) {
      const ended = outcomes.find((o) => endsReview(o.result));
      if (ended) {
        skipped.push({ gate, reason: `${ended.gate} blocked, which ends the review` });
        continue;
      }
      const catalog = catalogForRun(log.listRun(runId), options.baseCatalog);
      const gates = options.gates;
      const clock = options.now ? { now: options.now } : {};
      switch (gate) {
        case "gate0": {
          const run = runGate0(runId, { log, baseCatalog: options.baseCatalog, ...clock });
          outcomes.push(outcomeOf(gate, run.result, run));
          break;
        }
        case "gate1": {
          if (!gates) throw new ReviewInputError("Gate 1 needs the model gates");
          gate1 = await runGate1(runId, catalog, { log, extractor: gates.extractor, ...clock });
          outcomes.push(outcomeOf(gate, gate1.result, gate1));
          break;
        }
        case "gate2": {
          if (!gates || !gate1) throw new ReviewInputError("Gate 2 needs Gate 1's facts");
          const run = await runGate2(runId, catalog, {
            log,
            auditor: gates.auditor,
            market: gates.market,
            gate1,
            ...clock,
          });
          outcomes.push(outcomeOf(gate, run.result, run));
          break;
        }
        default:
          // Gate 3 is a later step; no configuration lists it yet.
          throw new ReviewInputError(`${gate} isn't part of the review tree yet`);
      }
    }
  } catch (error) {
    append("review_failed", start, {
      config,
      gate: planned[outcomes.length] ?? null,
      error: error instanceof Error ? error.message : String(error),
      gates: outcomes.map(gateRecord),
    });
    throw error;
  }

  const verdict = planned.length === 0 ? null : combineVerdicts(outcomes.map((o) => o.result));
  const costUsd = outcomes.reduce((sum, o) => sum + o.costUsd, 0);
  const latencyMs = Math.round(now() - started);
  const finished = append(
    "review_finished",
    start,
    {
      config,
      verdict,
      gates: outcomes.map(gateRecord),
      skipped,
      // The total of the gates' own spend, for reading: it's already on their events.
      costUsd,
    },
    latencyMs,
  );
  return {
    config,
    verdict,
    gates: outcomes,
    skipped,
    checkoutEventId: checkout.eventId,
    startedEventId: start.eventId,
    finishedEventId: finished.eventId,
    costUsd,
    latencyMs,
  };
}
