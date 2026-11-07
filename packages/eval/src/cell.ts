import {
  type AgentColumn,
  findColumn,
  purchasesOf,
  type RunAgentOptions,
  runAgent,
} from "@firewall/agent";
import { type ArenaService, attackSucceeded, findScenario, orderHarms } from "@firewall/arena";
import type { EventLog } from "@firewall/events";
import {
  catalogForRun,
  type Enforcement,
  enforceReview,
  FIREWALL_CONFIGS,
  type FirewallConfig,
  type ReviewGates,
  runReview,
  type Verdict,
} from "@firewall/firewall";
import { acceptsDraftAsIs, type MandateBuilder } from "@firewall/mandate";
import { type PaymentAdapter, recordPayments } from "@firewall/payments";
import type { Firewall } from "@firewall/sdk";
import type {
  CellInput,
  CellResult,
  CellRun,
  CellSettlement,
  ConfigOutcome,
  Money,
} from "./types.js";

// The matrix's task functions. They are plain async functions over serialisable inputs and
// records (`CellInput`, `CellRun`, `ConfigOutcome`), so the same code runs in the local runner and,
// later, as a Render Workflows task. What can't be serialised (the event log, the payment adapter,
// the model clients) is a context the worker builds from its own settings.
//
// One cell = the agent runs once (`runCell`), then every firewall configuration reads that same
// recorded checkout (`evaluateCell`), because the firewall doesn't act until the agent has already
// checked out (docs/PLAN.md, "Cost"). `runAndEvaluateCell` is the whole task.

export interface RunContext {
  arena: ArenaService;
  log: EventLog;
  // The raw adapter (the fake or the sandbox's). The checkout and enforcement wrap it themselves.
  payments: PaymentAdapter;
  // Which adapter that is, written into each run's `run_started`, so an exported run says whether
  // its money was on the sandbox.
  paymentsName: "fake" | "sandbox";
  vaultId: string;
  builder: MandateBuilder;
  // The column's model. Exactly one model per column, no fallback.
  modelFor: (column: AgentColumn) => RunAgentOptions["model"];
  limits?: RunAgentOptions["limits"];
}

export interface EvaluateContext {
  log: EventLog;
  // The model gates, built for the run's catalog. Only `full` needs them.
  gates?: (catalog: ReturnType<typeof catalogForRun>) => ReviewGates;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// What the platform does with the money under each verdict (enforce.ts): approve captures and pays
// out, block voids, escalate leaves the hold for a person, and no review at all (`off`) captures.
// A test runs the real enforcement on the fake adapter and checks this agrees.
export function moneyFor(verdict: Verdict | null): Money {
  switch (verdict) {
    case null:
    case "approve":
      return "captured";
    case "block":
      return "voided";
    case "escalate":
      return "held";
  }
}

// Runs the agent once on the cell's scenario and seed, with the mandate built and locked first and
// the firewall holding the checkout. Nothing is reviewed or settled here. A cell that breaks (a
// mandate that won't lock, an outage) comes back as a record with status "error" rather than
// throwing, so one bad cell doesn't end a matrix.
export async function runCell(input: CellInput, ctx: RunContext): Promise<CellRun> {
  const column = findColumn(input.column);
  if (!column) throw new Error(`No agent column "${input.column}"`);
  const scenario = findScenario(input.scenarioId);
  if (!scenario) throw new Error(`No scenario "${input.scenarioId}"`);

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const seen: { runId?: string; firewall?: Firewall } = {};
  const base = {
    scenarioId: scenario.scenarioId,
    seed: input.seed,
    columnId: column.columnId,
    modelId: column.modelId,
    kind: scenario.kind,
    attack:
      scenario.kind === "attack"
        ? {
            attackId: scenario.attack.attackId,
            variant: scenario.attack.variant,
            harm: scenario.attack.harm,
          }
        : null,
    startedAt,
  } as const;

  try {
    const agent = await runAgent({
      arena: ctx.arena,
      log: ctx.log,
      payments: ctx.payments,
      vaultId: ctx.vaultId,
      column,
      model: ctx.modelFor(column),
      scenarioId: scenario.scenarioId,
      seed: input.seed,
      start: { origin: "eval", payments: ctx.paymentsName },
      ...(ctx.limits && { limits: ctx.limits }),
      // The firewall only holds the checkout here; the configurations review it afterwards.
      firewall: { config: "off", mandate: { builder: ctx.builder, person: acceptsDraftAsIs } },
      beforeShopping: ({ runId, firewall }) => {
        seen.runId = runId;
        seen.firewall = firewall;
      },
    });
    const { firewall } = seen;
    if (!firewall) throw new Error("The agent run never started its firewall");
    const mandate = await firewall.ready();
    const run = ctx.arena.get(agent.runId);
    const held = firewall.held;
    const checkedOut = agent.status === "checked_out" && held !== null;
    const harms = checkedOut ? orderHarms(run.arena, run.scenario.intent, run.order) : [];
    const agentEvents = ctx.log.listRun(agent.runId).filter((e) => e.lane === "agent");
    const touched = (tool: string) => [
      ...new Set(
        agentEvents.flatMap((e) => {
          const p = e.payload as { toolName?: string; input?: { listingId?: unknown } };
          return e.type === "tool_call" &&
            p.toolName === tool &&
            typeof p.input?.listingId === "string"
            ? [p.input.listingId]
            : [];
        }),
      ),
    ];
    return {
      ...base,
      runId: agent.runId,
      status: checkedOut ? "checked_out" : "no_checkout",
      agentStatus: agent.status,
      error: agent.error ?? null,
      mandateHash: mandate?.hash ?? null,
      held: held && {
        orderId: held.orderId,
        authorizationId: held.authorizationId,
        amountCents: held.amountCents,
      },
      bought: purchasesOf(run.arena.catalog, run.order),
      fooled: attackSucceeded(run.scenario, run.arena, run.order),
      harms,
      clean: checkedOut && harms.length === 0,
      cause: null,
      trajectory: {
        listingsViewed: touched("view_listing"),
        reviewsRead: touched("read_reviews"),
        modelCalls: agent.modelCalls,
      },
      agent: {
        costUsd: agent.costUsd,
        latencyMs: Math.round(performance.now() - t0),
        inputTokens: agent.tokens.inputTokens,
        outputTokens: agent.tokens.outputTokens,
      },
      mandate: { costUsd: firewall.mandateCostUsd },
    };
  } catch (error) {
    return {
      ...base,
      runId: seen.runId ?? null,
      status: "error",
      agentStatus: "error",
      error: errorText(error),
      mandateHash: null,
      held: null,
      bought: [],
      fooled: false,
      harms: [],
      clean: false,
      cause: null,
      trajectory: { listingsViewed: [], reviewsRead: [], modelCalls: 0 },
      agent: {
        costUsd: 0,
        latencyMs: Math.round(performance.now() - t0),
        inputTokens: 0,
        outputTokens: 0,
      },
      mandate: { costUsd: seen.firewall?.mandateCostUsd ?? 0 },
    };
  }
}

const noReview = (config: FirewallConfig, failed: string | null, money: Money): ConfigOutcome => ({
  config,
  verdict: null,
  money,
  toAttackersCents: 0,
  gates: [],
  skipped: [],
  costUsd: 0,
  latencyMs: 0,
  reviewEventId: null,
  failed,
});

// Reads the cell's recorded checkout under one firewall configuration and derives what the money
// would have done. Nothing moves money here: the outcome comes from the verdict (`moneyFor`), so
// the three configurations can share the one hold the agent's checkout left. The review's events
// are written to the run's log, tagged with the configuration. Call it for `full` last, since
// `settleCell` enforces the latest review.
export async function evaluateCell(
  run: CellRun,
  config: FirewallConfig,
  ctx: EvaluateContext,
): Promise<ConfigOutcome> {
  if (run.status !== "checked_out" || !run.runId) return noReview(config, null, "none");
  if (config === "full" && !ctx.gates) {
    throw new Error('Evaluating the "full" configuration needs the model gates');
  }
  try {
    const gates =
      config === "full" && ctx.gates
        ? ctx.gates(catalogForRun(ctx.log.listRun(run.runId)))
        : undefined;
    const review = await runReview(run.runId, { log: ctx.log, config, ...(gates && { gates }) });
    const money = moneyFor(review.verdict);
    return {
      config,
      verdict: review.verdict,
      money,
      toAttackersCents:
        money === "captured"
          ? run.bought
              .filter((b) => b.sellerRole === "attacker")
              .reduce((n, b) => n + b.totalCents, 0)
          : 0,
      gates: review.gates.map((g) => ({
        gate: g.gate,
        verdict: g.verdict,
        costUsd: g.costUsd,
        latencyMs: g.latencyMs,
        reasons: g.result.reasons,
      })),
      skipped: review.skipped,
      costUsd: review.costUsd,
      latencyMs: review.latencyMs,
      reviewEventId: review.finishedEventId,
      failed: null,
    };
  } catch (error) {
    // The review wrote review_failed and nothing is enforced: the order stays held.
    return noReview(config, errorText(error), "held");
  }
}

export interface SettleContext {
  log: EventLog;
  payments: PaymentAdapter;
}

// The one real enforcement of a cell: the `full` review's verdict is carried out on the run's
// adapter (what the product does), and a hold that is still open afterwards (escalated, or the
// review failed) is voided, so a sandbox matrix leaves no authorization open and no person is
// made up to decide it. The real outcome is compared with the derived one.
export async function settleCell(
  run: CellRun,
  outcomes: readonly ConfigOutcome[],
  ctx: SettleContext,
): Promise<CellSettlement | null> {
  if (!run.held || !run.runId) return null;
  const { runId } = run;
  const full = outcomes.find((o) => o.config === "full");
  let enforcement: Enforcement | null = null;
  let released = false;
  try {
    const lastReview = ctx.log
      .listRun(runId)
      .findLast((e) => e.lane === "review" && e.type === "review_finished");
    if (full && !full.failed && lastReview?.eventId === full.reviewEventId) {
      enforcement = await enforceReview(runId, { log: ctx.log, payments: ctx.payments });
    }
    if (!enforcement || enforcement.money === "held") {
      const parentId =
        enforcement?.eventId ?? full?.reviewEventId ?? ctx.log.listRun(runId)[0]?.eventId ?? null;
      const payments = recordPayments(ctx.payments, ctx.log, () => ({
        runId,
        scenarioId: run.scenarioId,
        parentId,
      }));
      await payments.voidAuthorization(run.held.authorizationId);
      released = true;
    }
  } catch (error) {
    return {
      config: "full",
      money: enforcement?.money ?? "none",
      releasedHold: released,
      matchesDerived: null,
      error: errorText(error),
    };
  }
  return {
    config: "full",
    money: enforcement?.money ?? "none",
    releasedHold: released,
    matchesDerived: enforcement && full ? enforcement.money === full.money : null,
    error: null,
  };
}

export type CellContext = RunContext & Pick<EvaluateContext, "gates">;

// The whole task for one cell: the agent once, each firewall configuration on its checkout, and the
// one real enforcement. This is what the local runner calls, and what a Render task would.
export async function runAndEvaluateCell(input: CellInput, ctx: CellContext): Promise<CellResult> {
  const run = await runCell(input, ctx);
  const outcomes: ConfigOutcome[] = [];
  let settlement: CellSettlement | null = null;
  if (run.status !== "error") {
    // FIREWALL_CONFIGS lists `full` last, which settleCell relies on.
    for (const config of FIREWALL_CONFIGS) {
      outcomes.push(
        await evaluateCell(run, config, { log: ctx.log, ...(ctx.gates && { gates: ctx.gates }) }),
      );
    }
    settlement = await settleCell(run, outcomes, ctx);
  }
  return {
    input,
    run,
    outcomes,
    settlement,
    costUsd:
      run.agent.costUsd + run.mandate.costUsd + outcomes.reduce((sum, o) => sum + o.costUsd, 0),
  };
}
