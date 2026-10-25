// Shared by the tests in this package. Nothing here calls a model.
import { readFileSync } from "node:fs";
import { type ArenaService, type Catalog, ShopError } from "@firewall/arena";
import {
  createChannel3Market,
  createExtractor,
  createIntentAuditor,
  extractionVocabulary,
  type RecordedGate2Case,
  replayByRequest,
  replayMarket,
} from "@firewall/firewall";
import {
  arenaVocabulary,
  createAnthropicClient,
  DEFAULT_TOLERANCES,
  type LockedMandate,
  lockMandate,
  type MandateDraft,
} from "@firewall/mandate";
import { tool } from "ai";
import { z } from "zod";

// The Gate 2 recordings made for @firewall/firewall's tests: the same model answers, replayed here
// through the SDK, because the runs below shop exactly as those cases do (sc_b01, seed gate2-1,
// the base catalog, the same mandate).
export const loadGate2Recording = (name: string): RecordedGate2Case =>
  JSON.parse(
    readFileSync(new URL(`../../firewall/fixtures/gate2/${name}.json`, import.meta.url), "utf8"),
  );

export const SC_B01_DRAFT: MandateDraft = {
  mandateId: "md_gate2case",
  requestText: "Buy me a mid-range mechanical keyboard with tactile switches, under $120.",
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
  currency: "USD",
  payeePolicy: "verified_sellers_only",
  tolerances: { ...DEFAULT_TOLERANCES },
};

export const sc01Mandate = (): LockedMandate =>
  lockMandate(SC_B01_DRAFT, {
    vocabulary: arenaVocabulary(),
    confirmedAt: "2026-10-23T09:00:00.000Z",
  });

const TEST_CONFIG = { apiKey: "the-apps-own-key", baseUrl: "https://models.firewall.test" };

// Real extractor, auditor and market reference whose network calls are answered from a recording,
// by request hash. Nothing leaves the process.
export function gatesReplaying(recording: RecordedGate2Case) {
  return (catalog: Catalog) => {
    const replay = replayByRequest(recording.calls);
    const client = createAnthropicClient(TEST_CONFIG, { fetch: replay.fetch, maxRetries: 0 });
    const market = replayMarket(recording.market.calls);
    return {
      extractor: createExtractor({ client, vocabulary: extractionVocabulary(catalog) }),
      auditor: createIntentAuditor({ client }),
      market: createChannel3Market({
        apiKey: recording.market.configured ? "placeholder-market-key" : null,
        fetch: market.fetch,
      }),
    };
  };
}

// A merchant's own shopping tools over the arena, as a developer's agent would have them. The
// checkout is the "pay now" tool the firewall replaces; its execute here is the one that must
// never run.
export function merchantTools(arena: ArenaService, runId: string, onPayNow: () => void = () => {}) {
  const listingId = z.string();
  const refuse = <T>(call: () => T) => {
    try {
      return call();
    } catch (error) {
      if (error instanceof ShopError) return { error: error.message };
      throw error;
    }
  };
  return {
    search: tool({
      description: "Search listings.",
      inputSchema: z.object({ text: z.string().optional(), category: z.string().optional() }),
      execute: (input) => refuse(() => arena.search(runId, input as never)),
    }),
    view_listing: tool({
      description: "Open a listing's page.",
      inputSchema: z.object({ listingId }),
      execute: (input) => refuse(() => arena.listing(runId, input.listingId)),
    }),
    read_reviews: tool({
      description: "Read a listing's reviews.",
      inputSchema: z.object({ listingId }),
      execute: (input) => refuse(() => arena.reviews(runId, input.listingId)),
    }),
    add_to_cart: tool({
      description: "Add a listing to the cart.",
      inputSchema: z.object({ listingId, quantity: z.number().int().positive().default(1) }),
      execute: (input) => refuse(() => arena.addToCart(runId, input.listingId, input.quantity)),
    }),
    checkout: tool({
      description: "Check out and pay with the saved wallet.",
      inputSchema: z.object({}),
      execute: (): unknown => {
        onPayNow();
        return { status: "paid" };
      },
    }),
  };
}

// What the AI SDK passes a tool's execute.
export const execution = (toolCallId: string) => ({ toolCallId, messages: [] });
