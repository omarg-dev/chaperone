import Anthropic from "@anthropic-ai/sdk";
import type { EventLog } from "@firewall/events";
import { costUsd, HAIKU_5_5_PRICING, tokenCounts } from "@firewall/mandate";
import {
  dayStartOf,
  fits,
  isStudioSpent,
  STUDIO_PURPOSE,
  type StudioBudget,
  studioBudgetAt,
  worstCaseUsd,
} from "./budget.js";
import {
  fromAnthropicMessage,
  MAX_INPUT_TOKENS,
  type StudioResponse,
  type StudioTurn,
  toAnthropicRequest,
} from "./translate.js";

// The dashboard assistant's side of the server: AG Studio's agents run in the page and ask for one
// turn at a time, and each turn is answered here, on the app's own Anthropic client, so the browser
// never holds a model key. A turn is counted (free), checked against the day's cap, reserved at its
// worst case, sent, and settled at what it cost. Without the key the assistant is off, and the page
// says so; the rest of the dashboard works the same.

export interface StudioAiOptions {
  log: EventLog;
  // Built from the app's own config (`studioClientFromEnv`), or null when the server has no key.
  client: Anthropic | null;
  // Why it is off, when `client` is null.
  offReason?: string;
  // FIREWALL_STUDIO_DAILY_USD.
  capUsd: number;
  now?: () => Date;
  newCallId?: () => string;
}

export interface StudioAiStatus {
  available: boolean;
  // Why it isn't, for a person: no key, or today's budget spent.
  reason: string | null;
  budget: StudioBudget;
}

export type StudioTurnResult =
  | { ok: true; response: StudioResponse; costUsd: number; budget: StudioBudget }
  | {
      ok: false;
      status: 413 | 429 | 502 | 503;
      error: string;
      message: string;
      budget: StudioBudget;
    };

export interface StudioAiService {
  status(): StudioAiStatus;
  turn(turn: StudioTurn, signal?: AbortSignal): Promise<StudioTurnResult>;
}

const resetLine = (budget: StudioBudget) =>
  `It starts again at ${budget.resetsAt.slice(11, 16)} UTC.`;

const spentMessage = (budget: StudioBudget) =>
  `Today's budget for the assistant ($${budget.capUsd.toFixed(2)}) is spent. ${resetLine(budget)}`;

// The API's own words go to the server's log, where an operator can read them; the page gets a
// sentence of its own.
const logFailure = (step: string, error: unknown) =>
  console.warn(
    `Studio assistant: ${step} failed. ${error instanceof Error ? error.message : error}`,
  );

const errorMessage = (error: unknown) =>
  error instanceof Anthropic.APIError
    ? `The model's API answered ${error.status ?? "with an error"}.`
    : "The model's API couldn't be reached.";

let counter = 0;
const defaultCallId = () => `studio_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function createStudioAiService(options: StudioAiOptions): StudioAiService {
  const { log, client, capUsd } = options;
  const now = options.now ?? (() => new Date());
  const newCallId = options.newCallId ?? defaultCallId;

  const budget = (): StudioBudget => {
    const at = now();
    return studioBudgetAt(capUsd, log.listSpend(STUDIO_PURPOSE, dayStartOf(at)), at);
  };

  const status = (): StudioAiStatus => {
    const current = budget();
    if (!client) {
      return {
        available: false,
        reason: options.offReason ?? "The assistant is off: this server has no model key.",
        budget: current,
      };
    }
    if (isStudioSpent(current)) {
      return { available: false, reason: spentMessage(current), budget: current };
    }
    return { available: true, reason: null, budget: current };
  };

  return {
    status,

    async turn(turn, signal) {
      const before = status();
      if (!client) {
        return {
          ok: false,
          status: 503,
          error: "assistant_off",
          message: before.reason ?? "",
          budget: before.budget,
        };
      }
      if (!before.available) {
        return {
          ok: false,
          status: 429,
          error: "budget_spent",
          message: before.reason ?? "",
          budget: before.budget,
        };
      }

      const request = toAnthropicRequest(turn);
      const { model, system, messages, tools, tool_choice, thinking } = request;

      // Counting is free, and it is what makes the worst case exact rather than a guess.
      let inputTokens: number;
      try {
        const counted = await client.messages.countTokens(
          {
            model,
            messages,
            ...(system !== undefined ? { system } : {}),
            ...(tools !== undefined ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            ...(thinking !== undefined ? { thinking } : {}),
          },
          { signal },
        );
        inputTokens = counted.input_tokens;
      } catch (error) {
        logFailure("counting a turn", error);
        return {
          ok: false,
          status: 502,
          error: "model_unavailable",
          message: errorMessage(error),
          budget: budget(),
        };
      }
      if (inputTokens > MAX_INPUT_TOKENS) {
        return {
          ok: false,
          status: 413,
          error: "too_long",
          message: `This conversation is too long for the assistant (${inputTokens} tokens, ${MAX_INPUT_TOKENS} at most). Start a new one.`,
          budget: budget(),
        };
      }

      // The check and the reservation are one synchronous step: nothing can spend in between.
      const worst = worstCaseUsd(inputTokens);
      const current = budget();
      if (!fits(current, worst)) {
        return {
          ok: false,
          status: 429,
          error: "budget_spent",
          message: spentMessage(current),
          budget: current,
        };
      }
      const callId = newCallId();
      log.appendSpend({ purpose: STUDIO_PURPOSE, callId, kind: "reserve", costUsd: worst });

      const started = Date.now();
      try {
        const message = await client.messages.create(request, { signal });
        const tokens = tokenCounts(message.usage);
        const cost = costUsd(HAIKU_5_5_PRICING, tokens);
        log.appendSpend({
          purpose: STUDIO_PURPOSE,
          callId,
          kind: "settle",
          costUsd: cost,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
          latencyMs: Date.now() - started,
        });
        return {
          ok: true,
          response: fromAnthropicMessage(message, now().getTime()),
          costUsd: cost,
          budget: budget(),
        };
      } catch (error) {
        // The API bills no request it answered with an error. One that never answered (a timeout, a
        // dropped connection) may still have run, so it stays counted at its worst case.
        logFailure("a turn", error);
        const answered = error instanceof Anthropic.APIError && error.status !== undefined;
        log.appendSpend({
          purpose: STUDIO_PURPOSE,
          callId,
          kind: "settle",
          costUsd: answered ? 0 : worst,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
        return {
          ok: false,
          status: 502,
          error: "model_unavailable",
          message: errorMessage(error),
          budget: budget(),
        };
      }
    },
  };
}
