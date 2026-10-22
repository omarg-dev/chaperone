import { requestSha256 } from "@firewall/mandate";

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
