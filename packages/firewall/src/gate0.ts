import { baseCatalog, buildArena, type Catalog, findScenario } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import { type LockedMandate, lockedMandateOf, MandateError } from "@firewall/mandate";
import { z } from "zod";
import type { GateResult } from "./gate.js";
import {
  type CheckoutAttempt,
  decideGate0,
  type OrderFacts,
  policyChecks,
  type RuleCheck,
  trustedCatalog,
} from "./policy.js";

// Gate 0, deterministic policy, over one run's event log. It reads three things, all trusted: the
// locked mandate (verified by its hash), the arena's checkout event (only its catalog fields), and
// the run's own catalog, rebuilt from the run's scenario and seed. It runs the rules in policy.ts,
// and writes one verdict event (system) to the gate0 lane under the checkout, with no model cost.
// It never reads page content: the catalog's pages are dropped before any rule sees it, and the
// checkout is read only for its catalog fields. Pinned by test_gate0_never_reads_seller_content.

export class Gate0InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gate0InputError";
  }
}

// The checkout as the arena service writes it ({ request, result }), cut to its catalog fields.
// zod drops every key not named here, so nothing else on a line (a title, say) reaches a rule.
const orderLine = z.object({
  listingId: z.string(),
  sku: z.string(),
  sellerId: z.string(),
  payeeKey: z.string(),
  unitPriceCents: z.number(),
  quantity: z.number(),
  discountCents: z.number(),
  totalCents: z.number(),
});
const checkedOut = z.object({
  result: z.object({
    currency: z.literal("USD"),
    lines: z.array(orderLine),
    totalCents: z.number(),
  }),
});
const runStarted = z.object({ seed: z.string() });

function orderOf(event: Event): OrderFacts {
  const parsed = checkedOut.safeParse(event.payload);
  if (!parsed.success) {
    throw new Gate0InputError(`Event ${event.eventId} (checkout) isn't what the arena writes`);
  }
  return parsed.data.result;
}

const attemptOf = (event: Event): CheckoutAttempt => ({
  eventId: event.eventId,
  ts: event.ts,
  skus: orderOf(event).lines.map((l) => l.sku),
});

// The run's catalog, as the arena built it for the run's scenario and seed. `base` is the catalog
// the arena service was given (the base catalog unless a test changed it).
export function catalogForRun(events: readonly Event[], base: Catalog = baseCatalog): Catalog {
  const started = events.find((e) => e.lane === "arena" && e.type === "run_started");
  if (!started) throw new Gate0InputError("The run has no arena run_started event");
  const scenario = started.scenarioId ? findScenario(started.scenarioId) : undefined;
  if (!scenario) throw new Gate0InputError(`No scenario "${started.scenarioId}" for the run`);
  const payload = runStarted.safeParse(started.payload);
  if (!payload.success) throw new Gate0InputError(`Event ${started.eventId} names no seed`);
  return buildArena(scenario, payload.data.seed, base).catalog;
}

export interface Gate0Options {
  log: EventLog;
  // The catalog the run's arena was built from. Defaults to the base catalog.
  baseCatalog?: Catalog;
  now?: () => number;
}

export interface Gate0Run {
  result: GateResult;
  checks: RuleCheck[];
  // Null when the run has no intact mandate, which blocks.
  mandate: LockedMandate | null;
  checkoutEventId: string;
  verdictEventId: string;
  costUsd: 0;
  latencyMs: number;
}

type MandateLookup =
  | { ok: true; mandate: LockedMandate; eventId: string }
  | { ok: false; check: RuleCheck; eventId: string | null };

// The mandate the person confirmed before the checkout. One locked after it isn't the one the
// agent shopped against, so it isn't looked at.
function mandateBefore(events: readonly Event[]): MandateLookup {
  const eventId = events.filter((e) => e.type === "mandate_locked").at(-1)?.eventId ?? null;
  try {
    return { ok: true, mandate: lockedMandateOf(events), eventId: eventId as string };
  } catch (error) {
    if (!(error instanceof MandateError)) throw error;
    const reason =
      eventId === null
        ? "the run has no locked mandate before its checkout, so there is nothing the person confirmed to check the cart against"
        : `the mandate can't be trusted: ${error.message}`;
    return {
      ok: false,
      eventId,
      check: { rule: "mandate", listingId: null, passed: false, reason },
    };
  }
}

export function runGate0(runId: string, options: Gate0Options): Gate0Run {
  const { log } = options;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const events = log.listRun(runId);
  const checkouts = events.filter((e) => e.lane === "arena" && e.type === "checkout");
  const checkout = checkouts.at(-1);
  if (!checkout) throw new Gate0InputError("The run has no checkout to review");
  const before = events.filter((e) => e.seq < checkout.seq);

  const found = mandateBefore(before);
  let checks: RuleCheck[];
  if (found.ok) {
    const catalog = trustedCatalog(catalogForRun(events, options.baseCatalog));
    const mandateCheck: RuleCheck = {
      rule: "mandate",
      listingId: null,
      passed: true,
      reason: `mandate ${found.mandate.mandateId} is locked and its hash ${found.mandate.hash} matches its contents`,
    };
    checks = [
      mandateCheck,
      ...policyChecks(found.mandate, orderOf(checkout), catalog, {
        current: attemptOf(checkout),
        all: checkouts.map(attemptOf),
      }),
    ];
  } else {
    checks = [found.check];
  }

  const result = decideGate0(checks, {
    checkoutEventId: checkout.eventId,
    mandateEventId: found.eventId,
  });
  const latencyMs = Math.round(now() - started);
  const mandate = found.ok ? found.mandate : null;
  const verdict = log.append({
    runId,
    scenarioId: checkout.scenarioId,
    lane: "gate0",
    type: "verdict",
    provenance: "system",
    parentId: checkout.eventId,
    payload: {
      result,
      checks,
      mandateId: mandate?.mandateId ?? null,
      mandateHash: mandate?.hash ?? null,
      costUsd: 0,
    },
    costUsd: 0,
    latencyMs,
  });
  return {
    result,
    checks,
    mandate,
    checkoutEventId: checkout.eventId,
    verdictEventId: verdict.eventId,
    costUsd: 0,
    latencyMs,
  };
}
