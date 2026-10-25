import { canonicalJson, requestSha256, sha256 } from "@firewall/mandate";

// Gate 1's recorded model answers. One gate run makes one call per listing, so a recording holds
// every call of one fixture case, each under the hash of the request that produced it (the
// mandate package's hash: canonical JSON of the request body). Replay answers each request by its
// hash, so a changed prompt, schema or page finds no answer and says so.

export interface RecordedCall {
  requestSha256: string;
  // The Messages API response body, exactly as it arrived.
  response: unknown;
}

export interface RecordedCase {
  case: string;
  recordedAt: string;
  calls: RecordedCall[];
}

export const RECORD_COMMAND = "pnpm --filter @firewall/firewall record-fixtures";

// A fetch that answers each request with the recording made for it, and remembers any request it
// has no recording for.
export function replayByRequest(calls: readonly RecordedCall[]) {
  const byHash = new Map(calls.map((c) => [c.requestSha256, c.response]));
  const misses: string[] = [];
  let sent = 0;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent += 1;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const hash = requestSha256(body);
    const response = byHash.get(hash);
    if (response === undefined) {
      misses.push(hash);
      return Response.json(
        { type: "error", error: { type: "not_found_error", message: "No recording" } },
        { status: 404 },
      );
    }
    return Response.json(response);
  }) as typeof globalThis.fetch;
  return { fetch, misses, sent: () => sent };
}

// Gate 2's recordings hold every model call of one case (Gate 1's extractions and Gate 2's
// judgement, all answered by hash), and the market reference's calls alongside. A recording made
// with no market key holds none, and replays with the reference unavailable, as it was recorded.
export interface RecordedMarketCall {
  requestSha256: string;
  // The HTTP status and JSON body that came back, or the error the request failed with.
  status?: number;
  response?: unknown;
  error?: string;
}

export interface RecordedGate2Case extends RecordedCase {
  market: { source: string; configured: boolean; calls: RecordedMarketCall[] };
}

export const RECORD_GATE2_COMMAND = "pnpm --filter @firewall/firewall record-gate2-fixtures";

export const marketRequestSha256 = (body: unknown) => sha256(canonicalJson(body));

// A fetch that answers each market request with the response recorded for it.
export function replayMarket(calls: readonly RecordedMarketCall[]) {
  const byHash = new Map(calls.map((c) => [c.requestSha256, c]));
  const misses: string[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const hash = marketRequestSha256(init?.body ? JSON.parse(String(init.body)) : null);
    const call = byHash.get(hash);
    if (!call) {
      misses.push(hash);
      throw new TypeError("No recording for this market request");
    }
    if (call.error !== undefined) throw new TypeError(call.error);
    return Response.json(call.response, { status: call.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, misses };
}
