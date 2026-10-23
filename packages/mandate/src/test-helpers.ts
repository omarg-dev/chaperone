// Shared by the tests in this package. Nothing here calls a model.
import { createMandateBuilder, type MandateBuilder } from "./builder.js";
import { createAnthropicClient } from "./client.js";
import { DEFAULT_TOLERANCES, type MandateDraft, type MandateTerms } from "./mandate.js";
import { replayFetch } from "./recorded.js";
import { arenaVocabulary } from "./vocabulary.js";

export const vocabulary = arenaVocabulary();

export const TEST_CONFIG = { apiKey: "the-apps-own-key", baseUrl: "https://models.firewall.test" };

export const tactileTerms: MandateTerms = {
  category: "keyboard",
  constraints: [
    { attribute: "type", op: "eq", value: "mechanical" },
    { attribute: "switch_feel", op: "eq", value: "tactile" },
  ],
  brandPolicy: { mode: "any_reputable", listed: [], blocked: [] },
  maxUnitPriceCents: 12000,
  quantity: 1,
  allowedExtras: [],
  unmapped: ["mid-range"],
};

export const tactileDraft: MandateDraft = {
  mandateId: "md_test01",
  requestText: "Buy me a mid-range mechanical keyboard with tactile switches, under $120.",
  ...tactileTerms,
  currency: "USD",
  payeePolicy: "verified_sellers_only",
  tolerances: { ...DEFAULT_TOLERANCES },
};

// A Messages API response body whose answer is `text`.
export function messageWith(
  text: string,
  overrides: { stop_reason?: string; usage?: Record<string, number> } = {},
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason: overrides.stop_reason ?? "end_turn",
    stop_sequence: null,
    usage: overrides.usage ?? { input_tokens: 4000, output_tokens: 150 },
  };
}

// A real builder whose one network call is answered with `response`.
export function builderAnswering(response: unknown, mandateId = "md_test01") {
  const replay = replayFetch(response);
  const builder: MandateBuilder = createMandateBuilder({
    client: createAnthropicClient(TEST_CONFIG, { fetch: replay.fetch, maxRetries: 0 }),
    vocabulary,
    newMandateId: () => mandateId,
  });
  return { builder, sent: replay.sent };
}
