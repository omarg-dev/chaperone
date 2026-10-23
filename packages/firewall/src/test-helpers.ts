// Shared by the tests in this package. Nothing here calls a model.
import { readFileSync } from "node:fs";
import type { Catalog } from "@firewall/arena";
import {
  arenaVocabulary,
  createAnthropicClient,
  DEFAULT_TOLERANCES,
  type LockedMandate,
  lockMandate,
  type MandateTerms,
} from "@firewall/mandate";
import { createIntentAuditor } from "./auditor.js";
import { createExtractor } from "./extractor.js";
import { extractionVocabulary } from "./facts.js";
import { createChannel3Market } from "./market.js";
import {
  type RecordedCall,
  type RecordedCase,
  type RecordedGate2Case,
  replayByRequest,
  replayMarket,
} from "./recorded.js";
import type { ListingInScope, PageDocument } from "./sources.js";

export const TEST_CONFIG = { apiKey: "the-apps-own-key", baseUrl: "https://models.firewall.test" };

export const loadRecording = (name: string): RecordedCase =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

export const loadGate2Recording = (name: string): RecordedGate2Case =>
  JSON.parse(readFileSync(new URL(`../fixtures/gate2/${name}.json`, import.meta.url), "utf8"));

// Real extractor, auditor and market reference whose network calls are answered from a Gate 2
// recording, by request hash. The market reference is configured exactly when it was recorded
// with a key; the key here is a placeholder, since nothing leaves the process.
export function gatesReplaying(catalog: Catalog, recording: RecordedGate2Case) {
  const replay = replayByRequest(recording.calls);
  const client = createAnthropicClient(TEST_CONFIG, { fetch: replay.fetch, maxRetries: 0 });
  const marketReplay = replayMarket(recording.market.calls);
  return {
    extractor: createExtractor({ client, vocabulary: extractionVocabulary(catalog) }),
    auditor: createIntentAuditor({ client }),
    market: createChannel3Market({
      apiKey: recording.market.configured ? "placeholder-market-key" : null,
      fetch: marketReplay.fetch,
    }),
    replay,
    marketReplay,
  };
}

// A real auditor whose every call is answered with `response`.
export function auditorAnswering(response: unknown) {
  const sent: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json(response);
  }) as typeof globalThis.fetch;
  return {
    auditor: createIntentAuditor({
      client: createAnthropicClient(TEST_CONFIG, { fetch, maxRetries: 0 }),
    }),
    sent,
  };
}

// For test_reviewers_never_see_raw_seller_content: every run of `n` words in a text, lowercased.
export const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
export const wordRuns = (text: string, n = 4) => {
  const w = words(text);
  return w.length < n
    ? []
    : w.slice(0, w.length - n + 1).map((_, i) => w.slice(i, i + n).join(" "));
};

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

// The extractor's answer for a keyboard's page that claims nothing at all.
const unstated = { value: "not_stated", source: 0 };
export const EMPTY_ANSWER = {
  category: { value: "not_stated", source: null },
  brand: { value: "not_stated", source: null },
  seller: { value: "not_stated", source: null },
  attributes: { type: unstated, switch_feel: unstated, layout: unstated, wireless: unstated },
  otherAttributeClaims: [],
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

// A locked mandate for sc_b01's request (a tactile mechanical keyboard under $120), with `terms`
// changed.
export function mandateWith(terms: Partial<MandateTerms> = {}): LockedMandate {
  return lockMandate(
    {
      mandateId: "md_policy01",
      requestText: "Buy me a mechanical keyboard with tactile switches, under $120.",
      category: "keyboard",
      constraints: [
        { attribute: "type", op: "eq", value: "mechanical" },
        { attribute: "switch_feel", op: "eq", value: "tactile" },
      ],
      brandPolicy: { mode: "any_reputable", listed: [], blocked: [] },
      maxUnitPriceCents: 12000,
      quantity: 1,
      allowedExtras: [],
      unmapped: [],
      ...terms,
      currency: "USD",
      payeePolicy: "verified_sellers_only",
      tolerances: { ...DEFAULT_TOLERANCES },
    },
    { vocabulary: arenaVocabulary(), confirmedAt: "2026-10-23T12:00:00.000Z" },
  );
}
