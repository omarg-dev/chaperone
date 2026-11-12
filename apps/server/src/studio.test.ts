import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaService } from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { STUDIO_PURPOSE, worstCaseUsd } from "./studio/budget.js";
import { studioClientFromEnv } from "./studio/client.js";
import { createStudioAiService } from "./studio/service.js";
import { MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, STUDIO_MODEL } from "./studio/translate.js";

// AG Studio's routes over HTTP, on a real SQLite event log in a temp folder. No model is called: the
// assistant's client is the real one, built from the app's own config, sending to a stand-in for
// the API that counts tokens and answers each turn, so what the server sends is checked as sent.

let dir: string;
let log: EventLog;
let clock: Date;

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

// The API's stand-in: count_tokens says `inputTokens`, a turn answers `answer` (or fails with
// `failWith`), and each request is kept.
function stubApi(options: {
  inputTokens?: number;
  usage?: { input_tokens: number; output_tokens: number };
  failWith?: number;
}) {
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    sent.push({ url: request.url, headers: request.headers, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (request.url.endsWith("/count_tokens")) {
      return json({ input_tokens: options.inputTokens ?? 9000 });
    }
    if (options.failWith) {
      return json(
        { type: "error", error: { type: "api_error", message: "overloaded" } },
        options.failWith,
      );
    }
    return json({
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: STUDIO_MODEL,
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [
        { type: "text", text: "Let me look at the schema." },
        { type: "tool_use", id: "toolu_01", name: "view_schema", input: {} },
      ],
      usage: options.usage ?? { input_tokens: 9000, output_tokens: 120 },
    });
  };
  return { fetch, sent };
}

const APP_ENV = {
  FIREWALL_ANTHROPIC_API_KEY: "the-apps-own-key",
  FIREWALL_ANTHROPIC_BASE_URL: "https://models.firewall.test",
};

function appWith(options: {
  capUsd?: number;
  api?: ReturnType<typeof stubApi>;
  env?: NodeJS.ProcessEnv;
  licenseKey?: string | null;
}) {
  const api = options.api ?? stubApi({});
  const { client, offReason } = studioClientFromEnv(options.env ?? APP_ENV, {
    fetch: api.fetch,
    maxRetries: 0,
  });
  let n = 0;
  const ai = createStudioAiService({
    log,
    client,
    ...(offReason && { offReason }),
    capUsd: options.capUsd ?? 0.1,
    now: () => clock,
    newCallId: () => `call_${++n}`,
  });
  const app = createApp({
    log,
    arena: createArenaService({ log }),
    studio: { licenseKey: options.licenseKey ?? null, ai },
  });
  return { app, api };
}

const turn = {
  instructions: "You build dashboards over the benchmark.",
  input: [
    {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "Which model is fooled most?" }],
    },
  ],
  tools: [
    {
      name: "view_schema",
      description: "Read the data model.",
      parameters: { type: "object", properties: {} },
    },
  ],
  toolChoice: "auto",
  responseFormat: { type: "text" },
};

interface Budget {
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  resetsAt: string;
}
interface ConfigBody {
  licenseKey: string | null;
  ai: { available: boolean; reason: string | null; budget: Budget };
}
interface TurnBody {
  response: { status: string; output: unknown[] };
  costUsd: number;
  budget: Budget;
  error?: string;
  message?: string;
}
const configOf = async (app: ReturnType<typeof createApp>) =>
  (await (await app.request("/studio/config")).json()) as ConfigBody;
const bodyOf = async (response: Response) => (await response.json()) as TurnBody;

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request("/studio/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "studio-"));
  log = openEventLog({ path: join(dir, "events.db") });
  clock = new Date("2026-11-10T09:00:00.000Z");
  // The spend table stamps a row with the real clock, and the budget counts the rows of the
  // service's day: both have to be on the same day, whatever day the tests run on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /studio/config", () => {
  it("serves the licence key and says the assistant is on, with today's budget", async () => {
    const { app } = appWith({ licenseKey: "the-studio-key" });
    const body = await configOf(app);
    expect(body).toEqual({
      licenseKey: "the-studio-key",
      ai: {
        available: true,
        reason: null,
        budget: {
          capUsd: 0.1,
          spentUsd: 0,
          remainingUsd: 0.1,
          resetsAt: "2026-11-11T00:00:00.000Z",
        },
      },
    });
  });

  it("says the assistant is off, and why, without the app's key", async () => {
    const { app } = appWith({ env: { ANTHROPIC_API_KEY: "the-sessions-key" } });
    const body = await configOf(app);
    expect(body.licenseKey).toBeNull();
    expect(body.ai.available).toBe(false);
    expect(body.ai.reason).toMatch(/FIREWALL_ANTHROPIC_API_KEY/);
  });

  it("is off, with no cap to spend against, when createApp is given no studio", async () => {
    const app = createApp({ log, arena: createArenaService({ log }) });
    const body = await configOf(app);
    expect(body.licenseKey).toBeNull();
    expect(body.ai.available).toBe(false);
  });
});

describe("POST /studio/ai", () => {
  it("answers a turn on Haiku 5.5, capped, as Studio's output items, and records its cost", async () => {
    const { app, api } = appWith({});
    const response = await post(app, turn);
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.response.status).toBe("completed");
    expect(body.response.output).toEqual([
      {
        id: "msg_01_text",
        kind: "output",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "text", text: "Let me look at the schema.", annotations: [] }],
      },
      {
        id: "toolu_01",
        kind: "output",
        type: "function_call",
        callId: "toolu_01",
        name: "view_schema",
        arguments: "{}",
        status: "completed",
      },
    ]);
    // 9000 input tokens at $0.10 and 120 output at $0.50 per million.
    expect(body.costUsd).toBeCloseTo(0.00096, 8);

    const [count, call] = api.sent;
    expect(count?.url).toBe("https://models.firewall.test/v1/messages/count_tokens");
    expect(call?.url).toBe("https://models.firewall.test/v1/messages");
    expect(call?.body.model).toBe(STUDIO_MODEL);
    expect(call?.body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(call?.body.system).toBe("You build dashboards over the benchmark.");

    const rows = log.listSpend(STUDIO_PURPOSE, "2026-11-10T00:00:00.000Z");
    expect(rows.map((r) => [r.callId, r.kind, r.costUsd])).toEqual([
      ["call_1", "reserve", worstCaseUsd(9000)],
      ["call_1", "settle", body.costUsd],
    ]);
    expect(body.budget.spentUsd).toBeCloseTo(0.00096, 6);
  });

  it("ignores a model or a token cap the page asks for", async () => {
    const { app, api } = appWith({});
    await post(app, { ...turn, model: "claude-opus-5-5", max_tokens: 100_000 });
    expect(api.sent[1]?.body.model).toBe(STUDIO_MODEL);
    expect(api.sent[1]?.body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it("refuses a turn that isn't one, before any call", async () => {
    const { app, api } = appWith({});
    const response = await post(app, { input: [{ type: "message", role: "wizard" }] });
    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toBe("invalid_turn");
    expect(api.sent).toHaveLength(0);
  });

  it("refuses with a reason, and calls nothing, without the app's key", async () => {
    const { app, api } = appWith({ env: {} });
    const response = await post(app, turn);
    expect(response.status).toBe(503);
    expect((await bodyOf(response)).message).toMatch(/assistant is off/);
    expect(api.sent).toHaveLength(0);
  });

  it("refuses a conversation longer than the input cap, after counting it", async () => {
    const { app, api } = appWith({ api: stubApi({ inputTokens: MAX_INPUT_TOKENS + 1 }) });
    const response = await post(app, turn);
    expect(response.status).toBe(413);
    expect(api.sent).toHaveLength(1);
    expect(log.listSpend(STUDIO_PURPOSE, "2026-01-01T00:00:00.000Z")).toHaveLength(0);
  });

  it("stops at the daily cap: a turn whose worst case doesn't fit is refused, never sent", async () => {
    // Room for one turn at its worst case and a smaller one, not two of these.
    const worst = worstCaseUsd(9000);
    const { app, api } = appWith({
      capUsd: worst + 0.0015,
      api: stubApi({ usage: { input_tokens: 9000, output_tokens: MAX_OUTPUT_TOKENS } }),
    });
    expect((await post(app, turn)).status).toBe(200);
    const refused = await post(app, turn);
    expect(refused.status).toBe(429);
    const body = await bodyOf(refused);
    expect(body.error).toBe("budget_spent");
    expect(body.message).toMatch(
      /Today's budget for the assistant .* is spent\. It starts again at 00:00 UTC\./,
    );
    // Counted, then refused: the second turn never reached the model.
    expect(api.sent.map((s) => s.url.endsWith("/count_tokens"))).toEqual([true, false, true]);
  });

  it("counts the cap from the database, so a restart can't lose it", async () => {
    log.appendSpend({ purpose: STUDIO_PURPOSE, callId: "old", kind: "reserve", costUsd: 0.1 });
    const { app, api } = appWith({});
    const config = await configOf(app);
    expect(config.ai.available).toBe(false);
    expect(config.ai.reason).toMatch(/is spent/);
    expect((await post(app, turn)).status).toBe(429);
    expect(api.sent).toHaveLength(0);
  });

  it("starts again on the next UTC day", async () => {
    log.appendSpend({ purpose: STUDIO_PURPOSE, callId: "old", kind: "reserve", costUsd: 0.1 });
    clock = new Date("2026-11-11T00:00:01.000Z");
    const { app } = appWith({});
    expect((await post(app, turn)).status).toBe(200);
  });

  it("settles a turn the API refused at nothing, and says it failed", async () => {
    const { app } = appWith({ api: stubApi({ failWith: 529 }) });
    const response = await post(app, turn);
    expect(response.status).toBe(502);
    expect((await bodyOf(response)).message).toBe("The model's API answered 529.");
    const rows = log.listSpend(STUDIO_PURPOSE, "2026-01-01T00:00:00.000Z");
    expect(rows.map((r) => [r.kind, r.costUsd])).toEqual([
      ["reserve", worstCaseUsd(9000)],
      ["settle", 0],
    ]);
    expect(rows[1]?.error).toMatch(/overloaded/);
  });
});

// Cloud sessions set ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL and friends for Claude Code itself. The
// assistant's client must never use them (CLAUDE.md, "Model clients are configured explicitly").
describe("test_model_clients_use_the_apps_own_config", () => {
  it("sends only the app's key to the app's base URL, whatever the SDK's variables say", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "junk-key-from-the-session");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://session-proxy.invalid");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "junk-token-from-the-session");
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "X-Session-Secret: junk\nAuthorization: Bearer junk");
    vi.stubEnv("FIREWALL_ANTHROPIC_API_KEY", "the-apps-own-key");
    vi.stubEnv("FIREWALL_ANTHROPIC_BASE_URL", "https://models.firewall.test");
    const { app, api } = appWith({ env: process.env });
    expect((await post(app, turn)).status).toBe(200);
    expect(api.sent).toHaveLength(2);
    for (const call of api.sent) {
      expect(call.url.startsWith("https://models.firewall.test/v1/messages")).toBe(true);
      expect(call.headers.get("x-api-key")).toBe("the-apps-own-key");
      expect(call.headers.get("authorization")).toBeNull();
      expect(call.headers.get("x-session-secret")).toBeNull();
      expect([...call.headers.values()].join("\n")).not.toContain("junk");
    }
  });

  it("is off, never on the session's key, without the app's own", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "junk-key-from-the-session");
    vi.stubEnv("FIREWALL_ANTHROPIC_API_KEY", "");
    const { client, offReason } = studioClientFromEnv(process.env);
    expect(client).toBeNull();
    expect(offReason).toMatch(/FIREWALL_ANTHROPIC_API_KEY/);
  });

  it("never falls back to the environment's base URL when given the default", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://session-proxy.invalid");
    const { app, api } = appWith({ env: { FIREWALL_ANTHROPIC_API_KEY: "the-apps-own-key" } });
    await post(app, turn);
    expect(api.sent[0]?.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
  });
});
