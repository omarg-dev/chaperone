import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONValue } from "ai";
import {
  anthropicConfigFromEnv,
  geminiConfigFromEnv,
  type ModelConfig,
  openaiConfigFromEnv,
} from "./config.js";
import type { ModelPricing } from "./cost.js";
import { withThoughtSignatures } from "./gemini.js";

// An eval column: one model on one provider. A run uses its column's model for every step, and
// nothing falls back to another model or provider, or the column's numbers would mix models
// (docs/PLAN.md, "No fallback inside the eval").
//
// Three columns: Claude Haiku 5.5, an OpenAI model and a Gemini model, each with its own key
// variable, base URL variable (config.ts) and pricing. The gates run on Claude Haiku 5.5 whichever
// column the agent is on.

export type ColumnProvider = "anthropic" | "openai" | "gemini";

export interface AgentColumn {
  columnId: string;
  // What `run-matrix --column` calls it.
  shortName: string;
  label: string;
  provider: ColumnProvider;
  modelId: string;
  pricing: ModelPricing;
  // Settings sent on every call, pinned so a provider's changing defaults can't move the numbers.
  providerOptions: Record<string, Record<string, JSONValue>>;
}

export const HAIKU_COLUMN: AgentColumn = {
  columnId: "claude-haiku-5-5",
  shortName: "haiku",
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

// OpenAI's cheapest current model, GPT-6 Luna. Prices are the Standard rates on
// developers.openai.com/api/docs/pricing (checked Nov 6, 2026): a prompt over 272K input tokens is
// billed at 2x input and cache rates and 1.5x output for the whole request. The cache write rate is
// the 30-minute one; the agent doesn't ask for caching. Function calling with reasoning needs the
// Responses API, which `createOpenAI(...)(modelId)` uses.
export const OPENAI_COLUMN: AgentColumn = {
  columnId: "gpt-6-luna",
  shortName: "openai",
  label: "OpenAI GPT-6 Luna",
  provider: "openai",
  modelId: "gpt-6-luna",
  pricing: {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    longContext: {
      thresholdTokens: 272_000,
      inputPerMTok: 0.2,
      outputPerMTok: 0.75,
      cacheReadPerMTok: 0.02,
      cacheWritePerMTok: 0.25,
    },
  },
  providerOptions: {
    // The model's own default effort, stated. Nothing is stored on OpenAI's side.
    openai: { reasoningEffort: "medium", store: false },
  },
};

// Google's Gemini 3.5 Flash-Lite (stable), which has a free tier. The prices are the paid Standard
// rates on ai.google.dev/gemini-api/docs/pricing (checked Nov 6, 2026), which the cap and the
// results use even when the free tier means nothing is billed; output includes thinking tokens.
// Implicit caching has no write fee, so a write is priced as plain input. Reached through Google's
// OpenAI-compatible endpoint (config.ts).
export const GEMINI_COLUMN: AgentColumn = {
  columnId: "gemini-3.5-flash-lite",
  shortName: "gemini",
  label: "Gemini 3.5 Flash-Lite",
  provider: "gemini",
  modelId: "gemini-3.5-flash-lite",
  pricing: {
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    cacheReadPerMTok: 0.03,
    cacheWritePerMTok: 0.3,
  },
  providerOptions: {
    openai: { reasoningEffort: "medium" },
  },
};

export const AGENT_COLUMNS: readonly AgentColumn[] = [HAIKU_COLUMN, OPENAI_COLUMN, GEMINI_COLUMN];

export function findColumn(columnId: string): AgentColumn | undefined {
  return AGENT_COLUMNS.find((c) => c.columnId === columnId);
}

// A column by its ID or its short name (`haiku`, `openai`, `gemini`).
export function resolveColumn(name: string): AgentColumn | undefined {
  return AGENT_COLUMNS.find((c) => c.columnId === name || c.shortName === name);
}

// The column's key and base URL, read from the app's own variables only. Throws a
// MissingConfigError naming the variable when the key isn't set.
export function columnConfigFromEnv(
  column: AgentColumn,
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  switch (column.provider) {
    case "anthropic":
      return anthropicConfigFromEnv(env);
    case "openai":
      return openaiConfigFromEnv(env);
    case "gemini":
      return geminiConfigFromEnv(env);
  }
}

export interface ModelOptions {
  // For tests, which answer the provider's HTTP calls themselves.
  fetch?: typeof globalThis.fetch;
}

// The column's model, with the key and base URL passed explicitly from the app's config.
export function createColumnModel(
  column: AgentColumn,
  config: ModelConfig,
  options: ModelOptions = {},
) {
  const settings = {
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  switch (column.provider) {
    case "anthropic":
      return createAnthropic(settings)(column.modelId);
    case "openai":
      return createOpenAI(settings)(column.modelId);
    case "gemini":
      // Google's OpenAI-compatible endpoint speaks Chat Completions, and its tool calls need their
      // thought signatures sent back (gemini.ts).
      return createOpenAI({
        ...settings,
        fetch: withThoughtSignatures(options.fetch ?? globalThis.fetch),
      }).chat(column.modelId);
  }
}
