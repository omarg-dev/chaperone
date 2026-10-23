import type Anthropic from "@anthropic-ai/sdk";
import { canonicalJson, sha256 } from "./canonical.js";

// Model responses recorded once from a live run and replayed by the tests, which never call a
// model. Each keeps the hash of the request that produced it, so a test can tell when the prompt
// or the schema has changed since and the recording no longer answers what the builder now asks.

export interface RecordedResponse {
  scenarioId: string;
  requestText: string;
  recordedAt: string;
  requestSha256: string;
  // The Messages API response body, exactly as it arrived.
  response: unknown;
}

export const requestSha256 = (params: Anthropic.MessageCreateParamsNonStreaming) =>
  sha256(canonicalJson(params));

// A fetch that answers every call with the recorded body, and remembers what was sent.
export function replayFetch(response: unknown) {
  const sent: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json(response);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}
