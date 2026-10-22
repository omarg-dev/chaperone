// What a model call costs, from the token usage the API reports. No provider exposes a spend
// endpoint, so this is the spend meter: the builder's cost is written on its event, where the
// run's spend cap can add it up. (The shopping agent has the same arithmetic in @firewall/agent;
// the two should share one module once both are merged.)

export interface ModelPricing {
  // US dollars per million tokens.
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  // A prompt longer than this is billed at the long-context rates instead, for the whole call.
  longContext?: Omit<ModelPricing, "longContext"> & { thresholdTokens: number };
}

// Claude Haiku 5.5, the gates' and the builder's model. Cache reads are 0.1x input and 5-minute
// cache writes 1.25x; prompts over 100K tokens use the second rate card.
export const HAIKU_5_5_PRICING: ModelPricing = {
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
};

// The usage block of a Messages API response.
export interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface TokenCounts {
  // Every prompt token: uncached, read from the cache and written to it.
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // Includes thinking.
  outputTokens: number;
}

export function tokenCounts(usage: ApiUsage): TokenCounts {
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + cacheReadTokens + cacheWriteTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: usage.output_tokens,
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
