import type { ArenaService, StartOptions } from "@firewall/arena";
import type { EventLog } from "@firewall/events";
import type { PaymentAdapter } from "@firewall/payments";
import {
  arenaSource,
  createFirewall,
  type Firewall,
  type FirewallSettings,
  type HeldOrder,
} from "@firewall/sdk";
import { generateText, isStepCount, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import type { AgentColumn } from "./columns.js";
import { addCounts, costUsd, NO_TOKENS, type TokenCounts, tokenCounts } from "./cost.js";
import { SHOPPING_AGENT_INSTRUCTIONS } from "./prompt.js";
import { createShoppingTools, type RunSession } from "./tools.js";

// One shopping agent run: start an arena run for the scenario, hand the agent the person's
// request, and let it shop until it checks out, gives up, or hits a limit. Everything lands in the
// event log: the arena's events, the payments lane, and on the agent lane the agent's own
// trajectory (each model turn with its stated reasons, tool calls, tokens and cost), which Gate 3
// audits later.

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];

export interface RunLimits {
  // The most a run may spend on its model, in US dollars. The run stops before a call that could
  // take it past this, estimating the call from the one before.
  maxUsd: number;
  maxSteps: number;
  // Per model call; thinking counts towards it.
  maxOutputTokens: number;
}

// About ten times what a run is expected to cost (docs/PLAN.md, "Cost").
export const DEFAULT_LIMITS: RunLimits = { maxUsd: 0.05, maxSteps: 25, maxOutputTokens: 8000 };

export interface RunAgentOptions {
  arena: ArenaService;
  log: EventLog;
  payments: PaymentAdapter;
  vaultId: string;
  column: AgentColumn;
  // The column's model, or a scripted one in tests.
  model: WrappableModel;
  scenarioId: string;
  seed: string;
  // An arena run that is already started for this scenario and seed, to shop in instead of starting
  // one. The web app starts the run when the person asks for a mandate, so the mandate's events
  // and the agent's sit on one timeline; the run's `run_started` is then first in the log, and a
  // mandate the person locked before the agent starts is the one the firewall finds there.
  runId?: string;
  // What the run's `run_started` says about it (origin, payment adapter) when this starts the run.
  start?: StartOptions;
  limits?: Partial<RunLimits>;
  // The firewall in front of the agent's checkout (@firewall/sdk). The agent's tools go through its
  // `wrap`, so the checkout holds the cart; the default holds it and reviews nothing. Its mandate,
  // if it has one, is locked here before the agent sees the request, so the person's confirmation
  // sits on the run's timeline ahead of everything the agent does. If that fails, the agent never
  // runs.
  firewall?: FirewallSettings;
  // Runs once the arena run has started and the mandate is locked, before the agent sees the
  // request. It is how a caller gets hold of the run's firewall, to settle it when the agent is done.
  beforeShopping?: (run: {
    runId: string;
    scenarioId: string;
    request: string;
    firewall: Firewall;
  }) => Promise<void> | void;
}

export type RunStatus =
  // Checked out: the order is held, pending review.
  | "checked_out"
  // The model stopped by itself without checking out.
  | "no_checkout"
  | "spend_cap"
  | "step_cap"
  // The model call or a tool failed in a way the run couldn't continue past.
  | "failed";

export interface RunOutcome {
  runId: string;
  scenarioId: string;
  seed: string;
  columnId: string;
  modelId: string;
  status: RunStatus;
  order: HeldOrder | null;
  modelCalls: number;
  tokens: TokenCounts;
  costUsd: number;
  // What the agent said last.
  finalText: string;
  error?: string;
}

class SpendCapReached extends Error {
  constructor(spentUsd: number, maxUsd: number) {
    super(`The next model call could take the run past its $${maxUsd} cap ($${spentUsd} spent)`);
    this.name = "SpendCapReached";
  }
}

// What the run has spent, and whether one more call could cross the cap. The next call's prompt is
// at least the last one plus what it wrote, and tool results add more, so the estimate pads it.
function spendBudget(column: AgentColumn, limits: RunLimits) {
  let spent = 0;
  let tokens = NO_TOKENS;
  let calls = 0;
  let last: TokenCounts | null = null;
  return {
    add(counts: TokenCounts, cost: number) {
      spent += cost;
      tokens = addCounts(tokens, counts);
      calls += 1;
      last = counts;
    },
    projectedNextUsd(): number {
      const prompt: number = last ? Math.ceil((last.inputTokens + last.outputTokens) * 1.2) : 0;
      return costUsd(column.pricing, {
        ...NO_TOKENS,
        inputTokens: prompt + 2_000,
        outputTokens: limits.maxOutputTokens,
      });
    },
    wouldExceed(): boolean {
      return spent + this.projectedNextUsd() > limits.maxUsd;
    },
    get spentUsd() {
      return spent;
    },
    get tokens() {
      return tokens;
    },
    get calls() {
      return calls;
    },
  };
}

const parseInput = (input: string): unknown => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

export async function runAgent(options: RunAgentOptions): Promise<RunOutcome> {
  const { arena, log, column } = options;
  const limits: RunLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const run = options.runId
    ? arena.get(options.runId)
    : arena.start(options.scenarioId, options.seed, options.start);
  if (run.scenario.scenarioId !== options.scenarioId || run.seed !== options.seed) {
    throw new Error(
      `Run ${run.runId} is for ${run.scenario.scenarioId} with seed ${run.seed}, not ${options.scenarioId} with seed ${options.seed}`,
    );
  }
  const { runId } = run;
  const scenarioId = run.scenario.scenarioId;
  const runStarted = log.listRun(runId)[0];
  if (!runStarted) throw new Error(`Run ${runId} has no run_started event`);

  // The turn that caused the checkout is the model turn that asked for it, which the recorder below
  // keeps current.
  const session: RunSession = {
    runId,
    scenarioId,
    arena,
    log,
    currentTurnId: runStarted.eventId,
  };
  const firewall = createFirewall({
    config: "off",
    ...options.firewall,
    log,
    source: arenaSource({ arena, log, runId }),
    payments: options.payments,
    vaultId: options.vaultId,
    causedBy: () => session.currentTurnId,
  });
  await firewall.ready();
  await options.beforeShopping?.({ runId, scenarioId, request: run.scenario.request, firewall });

  const append = (input: {
    type: string;
    parentId: string;
    payload: unknown;
    costUsd?: number;
    latencyMs?: number;
  }) => log.append({ runId, scenarioId, lane: "agent", provenance: "system", ...input });

  const started = append({
    type: "agent_started",
    parentId: runStarted.eventId,
    payload: {
      columnId: column.columnId,
      provider: column.provider,
      modelId: column.modelId,
      providerOptions: column.providerOptions,
      limits,
      instructions: SHOPPING_AGENT_INSTRUCTIONS,
      request: run.scenario.request,
    },
  });

  session.currentTurnId = started.eventId;
  const budget = spendBudget(column, limits);
  let cappedBySpend = false;

  // Records each model turn as it comes back, before its tool calls run, so the tool calls can
  // name it as their parent. Each turn's parent is the turn before it.
  const recorder: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate }) => {
      if (budget.wouldExceed()) {
        cappedBySpend = true;
        throw new SpendCapReached(budget.spentUsd, limits.maxUsd);
      }
      const step = budget.calls;
      const t0 = performance.now();
      let result: Awaited<ReturnType<typeof doGenerate>>;
      try {
        result = await doGenerate();
      } catch (error) {
        append({
          type: "model_call_failed",
          parentId: session.currentTurnId,
          latencyMs: Math.round(performance.now() - t0),
          payload: { step, error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
      const counts = tokenCounts(result.usage);
      const cost = costUsd(column.pricing, counts);
      budget.add(counts, cost);
      const text = (type: "text" | "reasoning") =>
        result.content
          .flatMap((part) => (part.type === type ? [part.text] : []))
          .join("\n")
          .trim();
      const turn = append({
        type: "model_turn",
        parentId: session.currentTurnId,
        costUsd: cost,
        latencyMs: Math.round(performance.now() - t0),
        payload: {
          step,
          modelId: result.response?.modelId ?? column.modelId,
          // What the agent said: its stated reasons for the calls that follow.
          text: text("text"),
          reasoning: text("reasoning"),
          toolCalls: result.content.flatMap((part) =>
            part.type === "tool-call"
              ? [
                  {
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    input: parseInput(part.input),
                  },
                ]
              : [],
          ),
          finishReason: result.finishReason.unified,
          tokens: counts,
        },
      });
      session.currentTurnId = turn.eventId;
      return result;
    },
  };

  const model = wrapLanguageModel({ model: options.model, middleware: recorder });
  let status: RunStatus;
  let finalText = "";
  let error: string | undefined;
  try {
    const result = await generateText({
      model,
      instructions: SHOPPING_AGENT_INSTRUCTIONS,
      prompt: run.scenario.request,
      tools: firewall.wrap(createShoppingTools(session)),
      maxOutputTokens: limits.maxOutputTokens,
      providerOptions: column.providerOptions,
      // One retry for a dropped connection or an overloaded API, then the run fails and says so.
      maxRetries: 1,
      stopWhen: [
        isStepCount(limits.maxSteps),
        // The checkout is the run's last act: what happens to the order is the review's business.
        () => firewall.held !== null,
        () => {
          cappedBySpend = budget.wouldExceed();
          return cappedBySpend;
        },
      ],
    });
    finalText = result.text;
    if (firewall.held) status = "checked_out";
    else if (cappedBySpend) status = "spend_cap";
    else if (result.steps.length >= limits.maxSteps && result.finishReason === "tool-calls") {
      status = "step_cap";
    } else status = "no_checkout";
  } catch (caught) {
    status = firewall.held ? "checked_out" : cappedBySpend ? "spend_cap" : "failed";
    if (!cappedBySpend) error = caught instanceof Error ? caught.message : String(caught);
  }

  const outcome: RunOutcome = {
    runId,
    scenarioId,
    seed: options.seed,
    columnId: column.columnId,
    modelId: column.modelId,
    status,
    order: firewall.held,
    modelCalls: budget.calls,
    tokens: budget.tokens,
    costUsd: budget.spentUsd,
    finalText,
    ...(error !== undefined && { error }),
  };
  // The run's cost is already on its model turns; this event carries none, so totals don't count
  // it twice.
  append({ type: "run_finished", parentId: session.currentTurnId, payload: outcome });
  return outcome;
}
