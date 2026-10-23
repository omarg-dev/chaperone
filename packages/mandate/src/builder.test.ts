import { describe, expect, it } from "vitest";
import {
  BUILDER_MODEL,
  createMandateBuilder,
  MandateBuildError,
  systemPrompt,
  termsOutputSchema,
} from "./builder.js";
import { createAnthropicClient } from "./client.js";
import {
  builderAnswering,
  messageWith,
  TEST_CONFIG,
  tactileTerms,
  vocabulary,
} from "./test-helpers.js";

const REQUEST = "Buy me a mid-range mechanical keyboard with tactile switches, under $120.";

async function failure(response: unknown): Promise<MandateBuildError> {
  const { builder } = builderAnswering(response);
  const error = await builder.draft(REQUEST).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MandateBuildError);
  return error as MandateBuildError;
}

describe("the mandate builder", () => {
  it("asks Claude Haiku 5.5, at low effort, for output in the vocabulary's schema", async () => {
    const { builder, sent } = builderAnswering(messageWith(JSON.stringify(tactileTerms)));
    await builder.draft(REQUEST);
    const body = sent[0]?.body as Record<string, unknown>;
    expect(body.model).toBe(BUILDER_MODEL);
    expect(BUILDER_MODEL).toBe("claude-haiku-5-5");
    expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(JSON.stringify(body.messages)).toContain(REQUEST);
    expect(body).toEqual(JSON.parse(JSON.stringify(builder.request(REQUEST))));
  });

  it("turns the answer into a draft, with the firewall's own policies and the spend", async () => {
    const { builder } = builderAnswering(
      messageWith(JSON.stringify(tactileTerms), {
        usage: { input_tokens: 4000, output_tokens: 150 },
      }),
    );
    const result = await builder.draft(`  ${REQUEST}  `);
    expect(result.draft).toEqual({
      mandateId: "md_test01",
      requestText: REQUEST,
      ...tactileTerms,
      currency: "USD",
      payeePolicy: "verified_sellers_only",
      tolerances: { priceVsBestOfferPct: 15 },
    });
    expect(result.tokens).toEqual({
      inputTokens: 4000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 150,
    });
    expect(result.costUsd).toBeCloseTo(0.000475, 9);
    expect(result.model).toBe("claude-haiku-5-5");
  });

  it("refuses an empty request without calling the model", async () => {
    const { builder, sent } = builderAnswering(messageWith("{}"));
    await expect(builder.draft("   ")).rejects.toThrow(/empty/);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["refused", messageWith("", { stop_reason: "refusal" })],
    ["truncated", messageWith('{"category":', { stop_reason: "max_tokens" })],
    [
      "no_output",
      { ...messageWith(""), content: [{ type: "thinking", thinking: "", signature: "s" }] },
    ],
    ["invalid_json", messageWith("Here is your mandate: {")],
  ])("fails as %s rather than guessing", async (code, response) => {
    const error = await failure(response);
    expect(error.code).toBe(code);
    // The call was made, so what it cost is still known.
    expect(error.details.costUsd).toBeGreaterThan(0);
  });

  it("fails when the answer doesn't match the schema", async () => {
    const error = await failure(
      messageWith(
        JSON.stringify({
          ...tactileTerms,
          constraints: [{ attribute: "switch_feel", op: "eq", value: "squishy" }],
        }),
      ),
    );
    expect(error.code).toBe("invalid_output");
    expect(error.details.problems?.join()).toMatch(/constraints/);
    expect(error.details.rawText).toContain("squishy");
  });

  it("fails when the answer fits the schema but not the catalog", async () => {
    // dpi is a real attribute, but a mouse's, not a keyboard's.
    const error = await failure(
      messageWith(
        JSON.stringify({
          ...tactileTerms,
          constraints: [{ attribute: "dpi", op: "gte", value: 800 }],
        }),
      ),
    );
    expect(error.code).toBe("invalid_output");
    expect(error.details.problems?.join()).toMatch(/keyboard has no attribute "dpi"/);
  });

  it("fails clearly when the API call itself fails", async () => {
    const fetch = (async () =>
      Response.json(
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        { status: 529 },
      )) as typeof globalThis.fetch;
    const builder = createMandateBuilder({
      client: createAnthropicClient(TEST_CONFIG, { fetch, maxRetries: 0 }),
      vocabulary,
    });
    const error = (await builder.draft(REQUEST).catch((e: unknown) => e)) as MandateBuildError;
    expect(error).toBeInstanceOf(MandateBuildError);
    expect(error.code).toBe("api_error");
    expect(error.message).toMatch(/529/);
  });
});

describe("the model's output schema", () => {
  const schema = termsOutputSchema(vocabulary);

  it("accepts the terms the catalog can express", () => {
    expect(schema.safeParse(tactileTerms).success).toBe(true);
  });

  it("limits categories, attribute values and brands to the vocabulary", () => {
    expect(schema.safeParse({ ...tactileTerms, category: "monitor" }).success).toBe(false);
    expect(
      schema.safeParse({
        ...tactileTerms,
        brandPolicy: { mode: "listed_only", listed: ["brand_acme"], blocked: [] },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...tactileTerms,
        constraints: [{ attribute: "anc", op: "lte", value: true }],
      }).success,
    ).toBe(false);
  });
});

describe("the system prompt", () => {
  it("shows the whole vocabulary", () => {
    const prompt = systemPrompt(vocabulary);
    for (const category of vocabulary.categories) {
      expect(prompt).toContain(`- ${category.category}:`);
      for (const attribute of category.attributes) expect(prompt).toContain(attribute.name);
    }
    for (const brand of vocabulary.brands)
      expect(prompt).toContain(`${brand.brandId}: ${brand.name}`);
  });
});
