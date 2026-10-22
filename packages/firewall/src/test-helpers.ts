// Shared by the tests in this package. Nothing here calls a model.
import { readFileSync } from "node:fs";
import type { Catalog } from "@firewall/arena";
import { createAnthropicClient } from "@firewall/mandate";
import { createExtractor } from "./extractor.js";
import { extractionVocabulary } from "./facts.js";
import { type RecordedCall, type RecordedCase, replayByRequest } from "./recorded.js";
import type { ListingInScope, PageDocument } from "./sources.js";

export const TEST_CONFIG = { apiKey: "the-apps-own-key", baseUrl: "https://models.firewall.test" };

export const loadRecording = (name: string): RecordedCase =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

// A real extractor whose network calls are answered from recordings, by request hash.
export function extractorReplaying(catalog: Catalog, calls: readonly RecordedCall[]) {
  const replay = replayByRequest(calls);
  const extractor = createExtractor({
    client: createAnthropicClient(TEST_CONFIG, { fetch: replay.fetch, maxRetries: 0 }),
    vocabulary: extractionVocabulary(catalog),
  });
  return { extractor, replay };
}

// A real extractor whose every call is answered with `response`.
export function extractorAnswering(catalog: Catalog, response: unknown) {
  const sent: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json(response);
  }) as typeof globalThis.fetch;
  const extractor = createExtractor({
    client: createAnthropicClient(TEST_CONFIG, { fetch, maxRetries: 0 }),
    vocabulary: extractionVocabulary(catalog),
  });
  return { extractor, sent };
}

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
    content: [{ type: "text", text }],
    stop_reason: overrides.stop_reason ?? "end_turn",
    stop_sequence: null,
    usage: overrides.usage ?? { input_tokens: 5000, output_tokens: 300 },
  };
}

// The extractor's answer for a page that claims nothing at all.
export const EMPTY_ANSWER = {
  category: { value: "not_stated", source: null },
  brand: { value: "not_stated", source: null },
  seller: { value: "not_stated", source: null },
  attributes: [],
  prices: [],
  requiredItems: [],
  urgency: [],
  discountCodes: [],
  flags: [],
};

export function listingWith(
  documents: Omit<PageDocument, "eventId">[],
  overrides: Partial<ListingInScope> = {},
): ListingInScope {
  return {
    listingId: "lst_keyboard_02_1",
    inCart: true,
    documents: documents.map((d, i) => ({ ...d, eventId: `ev_doc${i + 1}` })),
    sourceEventIds: documents.map((_, i) => `ev_doc${i + 1}`),
    ...overrides,
  };
}
