// What a model call costs, from the token usage its provider reports. No provider exposes a spend
// endpoint, so this is the spend meter: every model turn's cost is written on its event, and the
// run's spend cap adds them up.

export interface ModelPricing {
  // US dollars per million tokens.
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  // A prompt longer than this is billed at the long-context rates instead, for the whole call.
  longContext?: {
    thresholdTokens: number;
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok: number;
    cacheWritePerMTok: number;
  };
}

// The provider's usage, in the AI SDK's language model shape.
export interface TokenUsage {
  inputTokens: {
    total: number | undefined;
    noCache: number | undefined;
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
  };
  outputTokens: {
    total: number | undefined;
    reasoning?: number | undefined;
  };
}

export interface TokenCounts {
  // Every prompt token: uncached, read from the cache and written to it.
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // Includes thinking.
  outputTokens: number;
  reasoningTokens: number;
}

export function tokenCounts(usage: TokenUsage): TokenCounts {
  const cacheReadTokens = usage.inputTokens.cacheRead ?? 0;
  const cacheWriteTokens = usage.inputTokens.cacheWrite ?? 0;
  const noCache =
    usage.inputTokens.noCache ??
    Math.max(0, (usage.inputTokens.total ?? 0) - cacheReadTokens - cacheWriteTokens);
  return {
    inputTokens: noCache + cacheReadTokens + cacheWriteTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: usage.outputTokens.total ?? 0,
    reasoningTokens: usage.outputTokens.reasoning ?? 0,
  };
}

export function costUsd(pricing: ModelPricing, tokens: TokenCounts): number {
  const long = pricing.longContext;
  const rates = long && tokens.inputTokens > long.thresholdTokens ? long : pricing;
  const uncached = tokens.inputTokens - tokens.cacheReadTokens - tokens.cacheWriteTokens;
  const dollars =
    uncached * rates.inputPerMTok +
    tokens.cacheReadTokens * rates.cacheReadPerMTok +
    tokens.cacheWriteTokens * rates.cacheWritePerMTok +
    tokens.outputTokens * rates.outputPerMTok;
  return dollars / 1_000_000;
}

export const addCounts = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export const NO_TOKENS: TokenCounts = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};
