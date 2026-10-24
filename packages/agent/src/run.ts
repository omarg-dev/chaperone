import type { ArenaService } from "@firewall/arena";
import type { EventLog } from "@firewall/events";
import type { PaymentAdapter } from "@firewall/payments";
import { generateText, isStepCount, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import type { AgentColumn } from "./columns.js";
import { addCounts, costUsd, NO_TOKENS, type TokenCounts, tokenCounts } from "./cost.js";
import { SHOPPING_AGENT_INSTRUCTIONS } from "./prompt.js";
import { createShoppingTools, type PlacedOrder, type RunSession } from "./tools.js";

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
  limits?: Partial<RunLimits>;
  // Runs once the arena run has started and before the agent sees the request: the person confirms
  // the mandate here, so it sits on the run's timeline ahead of everything the agent does. If it
  // throws, the agent never runs.
  beforeShopping?: (run: { runId: string; scenarioId: string; request: string }) => Promise<void>;
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
  order: PlacedOrder | null;
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
  const run = arena.start(options.scenarioId, options.seed);
  const { runId } = run;
  const scenarioId = run.scenario.scenarioId;
  const runStarted = log.listRun(runId)[0];
  if (!runStarted) throw new Error(`Run ${runId} has no run_started event`);

  await options.beforeShopping?.({ runId, scenarioId, request: run.scenario.request });

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

  const session: RunSession = {
    runId,
    scenarioId,
    arena,
    log,
    payments: options.payments,
    vaultId: options.vaultId,
    currentTurnId: started.eventId,
    order: null,
  };
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
      tools: createShoppingTools(session),
      maxOutputTokens: limits.maxOutputTokens,
      providerOptions: column.providerOptions,
      // One retry for a dropped connection or an overloaded API, then the run fails and says so.
      maxRetries: 1,
      stopWhen: [
        isStepCount(limits.maxSteps),
        // The checkout is the run's last act: what happens to the order is the review's business.
        () => session.order !== null,
        () => {
          cappedBySpend = budget.wouldExceed();
          return cappedBySpend;
        },
      ],
    });
    finalText = result.text;
    if (session.order) status = "checked_out";
    else if (cappedBySpend) status = "spend_cap";
    else if (result.steps.length >= limits.maxSteps && result.finishReason === "tool-calls") {
      status = "step_cap";
    } else status = "no_checkout";
  } catch (caught) {
    status = session.order ? "checked_out" : cappedBySpend ? "spend_cap" : "failed";
    if (!cappedBySpend) error = caught instanceof Error ? caught.message : String(caught);
  }

  const outcome: RunOutcome = {
    runId,
    scenarioId,
    seed: options.seed,
    columnId: column.columnId,
    modelId: column.modelId,
    status,
    order: session.order,
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
