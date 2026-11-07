import { describe, expect, it } from "vitest";
import {
  AGENT_COLUMNS,
  findColumn,
  GEMINI_COLUMN,
  HAIKU_COLUMN,
  OPENAI_COLUMN,
  resolveColumn,
} from "./columns.js";
import { costUsd } from "./cost.js";

describe("agent columns", () => {
  it("has the three columns, each on exactly one model with its own ID and short name", () => {
    expect(AGENT_COLUMNS.map((c) => c.shortName)).toEqual(["haiku", "openai", "gemini"]);
    expect(AGENT_COLUMNS.map((c) => c.modelId)).toEqual([
      "claude-haiku-5-5",
      "gpt-6-luna",
      "gemini-3.5-flash-lite",
    ]);
    for (const key of ["columnId", "shortName", "modelId"] as const) {
      expect(new Set(AGENT_COLUMNS.map((c) => c[key])).size).toBe(AGENT_COLUMNS.length);
    }
    // A column is one model: nothing in it names a second to fall back to.
    for (const column of AGENT_COLUMNS) {
      expect(Object.keys(column).sort()).toEqual(
        [
          "columnId",
          "label",
          "modelId",
          "pricing",
          "providerOptions",
          "provider",
          "shortName",
        ].sort(),
      );
    }
  });

  it("finds a column by its ID or its short name", () => {
    expect(findColumn("gpt-6-luna")).toBe(OPENAI_COLUMN);
    expect(findColumn("openai")).toBeUndefined();
    expect(resolveColumn("openai")).toBe(OPENAI_COLUMN);
    expect(resolveColumn("gemini")).toBe(GEMINI_COLUMN);
    expect(resolveColumn("haiku")).toBe(HAIKU_COLUMN);
    expect(resolveColumn("gemini-3.5-flash-lite")).toBe(GEMINI_COLUMN);
    expect(resolveColumn("gpt-7")).toBeUndefined();
  });

  it("prices a call from the column's own rates", () => {
    const tokens = {
      inputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 0,
    };
    // $0.10 and $0.50 per million for GPT-6 Luna.
    expect(costUsd(OPENAI_COLUMN.pricing, tokens)).toBeCloseTo(0.0015, 8);
    // $0.30 and $2.50 per million for Gemini 3.5 Flash-Lite.
    expect(costUsd(GEMINI_COLUMN.pricing, tokens)).toBeCloseTo(0.0055, 8);
  });

  it("bills a prompt over 272K tokens at OpenAI's long-context rates", () => {
    const tokens = {
      inputTokens: 300_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 0,
    };
    expect(costUsd(OPENAI_COLUMN.pricing, tokens)).toBeCloseTo(0.06 + 0.00075, 8);
  });
});
