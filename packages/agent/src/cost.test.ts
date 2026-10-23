import { describe, expect, it } from "vitest";
import { HAIKU_COLUMN } from "./columns.js";
import { costUsd, NO_TOKENS, tokenCounts } from "./cost.js";

const { pricing } = HAIKU_COLUMN;

describe("model cost", () => {
  it("prices Claude Haiku 5.5 at $0.10 in and $0.50 out per million tokens", () => {
    const tokens = { ...NO_TOKENS, inputTokens: 40_000, outputTokens: 2_000 };
    // The plan's estimate for one run: about half a cent.
    expect(costUsd(pricing, tokens)).toBeCloseTo(0.005, 10);
  });

  it("prices cache reads and writes at their own rates", () => {
    const tokens = tokenCounts({
      inputTokens: { total: 3_000, noCache: 1_000, cacheRead: 1_500, cacheWrite: 500 },
      outputTokens: { total: 100, reasoning: 40 },
    });
    expect(tokens).toEqual({
      inputTokens: 3_000,
      cacheReadTokens: 1_500,
      cacheWriteTokens: 500,
      outputTokens: 100,
      reasoningTokens: 40,
    });
    const expected = (1_000 * 0.1 + 1_500 * 0.01 + 500 * 0.125 + 100 * 0.5) / 1_000_000;
    expect(costUsd(pricing, tokens)).toBeCloseTo(expected, 12);
  });

  it("prices a prompt over 100K tokens at the long-context rates", () => {
    const tokens = { ...NO_TOKENS, inputTokens: 120_000, outputTokens: 1_000 };
    expect(costUsd(pricing, tokens)).toBeCloseTo((120_000 * 0.5 + 1_000 * 2.5) / 1_000_000, 12);
  });

  it("works out uncached input when the provider only reports the total", () => {
    const tokens = tokenCounts({
      inputTokens: { total: 900, noCache: undefined, cacheRead: 200, cacheWrite: undefined },
      outputTokens: { total: undefined },
    });
    expect(tokens).toMatchObject({ inputTokens: 900, cacheReadTokens: 200, outputTokens: 0 });
  });
});
