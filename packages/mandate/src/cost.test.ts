import { describe, expect, it } from "vitest";
import { costUsd, HAIKU_5_5_PRICING, tokenCounts } from "./cost.js";

describe("cost", () => {
  it("adds the cache tokens into the input", () => {
    expect(
      tokenCounts({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50,
      }),
    ).toEqual({ inputTokens: 1150, cacheReadTokens: 1000, cacheWriteTokens: 50, outputTokens: 20 });
  });

  it("prices a Haiku 5.5 call", () => {
    const tokens = tokenCounts({ input_tokens: 4000, output_tokens: 150 });
    // 4000 × $0.10/M + 150 × $0.50/M
    expect(costUsd(HAIKU_5_5_PRICING, tokens)).toBeCloseTo(0.000475, 9);
  });

  it("prices cached input at the cache rates", () => {
    const tokens = tokenCounts({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 10_000,
    });
    // 10K × $0.01/M + 10K × $0.125/M
    expect(costUsd(HAIKU_5_5_PRICING, tokens)).toBeCloseTo(0.0001 + 0.00125, 9);
  });

  it("uses the long-context card past 100K prompt tokens", () => {
    const tokens = tokenCounts({ input_tokens: 200_000, output_tokens: 0 });
    expect(costUsd(HAIKU_5_5_PRICING, tokens)).toBeCloseTo(0.1, 9);
  });
});
