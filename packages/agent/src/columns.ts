import { createAnthropic } from "@ai-sdk/anthropic";
import type { JSONValue } from "ai";
import type { AnthropicConfig } from "./config.js";
import type { ModelPricing } from "./cost.js";

// An eval column: one model on one provider. A run uses its column's model for every step, and
// nothing falls back to another model or provider, or the column's numbers would mix models
// (docs/PLAN.md, "No fallback inside the eval").
//
// Follow-ups, not built yet (v1.2 step 3 in docs/PLAN.md): an OpenAI column and a Gemini column,
// each its own entry here with its own provider package, key variable and pricing. Until then the
// Claude Haiku 5.5 column is the only one.

export interface AgentColumn {
  columnId: string;
  label: string;
  provider: "anthropic";
  modelId: string;
  pricing: ModelPricing;
  // Settings sent on every call, pinned so a provider's changing defaults can't move the numbers.
  providerOptions: Record<string, Record<string, JSONValue>>;
}

export const HAIKU_COLUMN: AgentColumn = {
  columnId: "claude-haiku-5-5",
  label: "Claude Haiku 5.5",
  provider: "anthropic",
  modelId: "claude-haiku-5-5",
  // Anthropic's list prices for prompts up to 100K tokens, and above. Cache reads and writes are
  // the usual 0.1x and 1.25x of the input rate; the agent doesn't ask for caching today.
  pricing: {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    longContext: {
      thresholdTokens: 100_000,
      inputPerMTok: 0.5,
      outputPerMTok: 2.5,
      cacheReadPerMTok: 0.05,
      cacheWritePerMTok: 0.625,
    },
  },
  providerOptions: {
    // The model's own defaults, stated: adaptive thinking at medium effort. The thinking comes
    // back summarized so the trajectory Gate 3 audits holds the agent's reasoning, not just its
    // tool calls.
    anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort: "medium" },
  },
};

export const AGENT_COLUMNS: readonly AgentColumn[] = [HAIKU_COLUMN];

export function findColumn(columnId: string): AgentColumn | undefined {
  return AGENT_COLUMNS.find((c) => c.columnId === columnId);
}

export interface ModelOptions {
  // For tests, which answer the provider's HTTP calls themselves.
  fetch?: typeof globalThis.fetch;
}

// The column's model, with the key and base URL passed explicitly from the app's config.
export function createColumnModel(
  column: AgentColumn,
  config: AnthropicConfig,
  options: ModelOptions = {},
) {
  const provider = createAnthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return provider(column.modelId);
}
