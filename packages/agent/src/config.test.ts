import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  columnConfigFromEnv,
  createColumnModel,
  GEMINI_COLUMN,
  HAIKU_COLUMN,
  OPENAI_COLUMN,
} from "./columns.js";
import {
  anthropicConfigFromEnv,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  geminiConfigFromEnv,
  MissingConfigError,
  openaiConfigFromEnv,
} from "./config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Cloud sessions set ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL for Claude Code itself. The agent's
// client must never use them (CLAUDE.md, "Model clients are configured explicitly").
describe("test_model_clients_use_the_apps_own_config", () => {
  it("sends the app's key to the app's base URL, whatever the SDK's variables say", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "junk-key-from-the-session");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://session-proxy.invalid");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "junk-token-from-the-session");

    const seen: { url: string; headers: Headers }[] = [];
    // Answers the provider's HTTP call itself, so no model is called.
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: HAIKU_COLUMN.modelId,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 },
      });
    }) as typeof globalThis.fetch;

    const config = { apiKey: "the-apps-own-key", baseUrl: "https://models.firewall.test/v1" };
    const result = await generateText({
      model: createColumnModel(HAIKU_COLUMN, config, { fetch }),
      prompt: "Hello",
    });

    expect(result.text).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://models.firewall.test/v1/messages");
    expect(seen[0]?.headers.get("x-api-key")).toBe("the-apps-own-key");
    expect(seen[0]?.headers.get("authorization")).toBeNull();
  });

  it("reads only the app's own variables", () => {
    expect(
      anthropicConfigFromEnv({
        FIREWALL_ANTHROPIC_API_KEY: "the-apps-own-key",
        ANTHROPIC_API_KEY: "junk",
        ANTHROPIC_BASE_URL: "https://session-proxy.invalid",
      }),
    ).toEqual({ apiKey: "the-apps-own-key", baseUrl: DEFAULT_ANTHROPIC_BASE_URL });
    expect(
      anthropicConfigFromEnv({
        FIREWALL_ANTHROPIC_API_KEY: "k",
        FIREWALL_ANTHROPIC_BASE_URL: "https://models.firewall.test/v1",
      }).baseUrl,
    ).toBe("https://models.firewall.test/v1");
  });

  it("accepts the base URL with or without /v1, since the mandate builder reads it too", () => {
    for (const written of [
      "https://models.firewall.test",
      "https://models.firewall.test/",
      "https://models.firewall.test/v1",
      "https://models.firewall.test/v1/",
    ]) {
      expect(
        anthropicConfigFromEnv({
          FIREWALL_ANTHROPIC_API_KEY: "k",
          FIREWALL_ANTHROPIC_BASE_URL: written,
        }).baseUrl,
      ).toBe("https://models.firewall.test/v1");
    }
  });

  it("refuses to run live without the app's key, even when the SDK's key is set", () => {
    expect(() => anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "junk" })).toThrow(MissingConfigError);
    expect(() => anthropicConfigFromEnv({})).toThrow(/FIREWALL_ANTHROPIC_API_KEY/);
  });
});

// The OpenAI and Gemini columns follow the same rule: the SDK's own variable names are never read,
// and a column without its key refuses to run, naming the variable.
describe("test_model_clients_use_the_apps_own_config (OpenAI and Gemini columns)", () => {
  // Every variable an OpenAI or Google SDK, or a Gemini tool, would fall back to.
  const SDK_VARIABLES = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
    "GEMINI_API_KEY",
    "GEMINI_BASE_URL",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_GENERATIVE_AI_BASE_URL",
  ];

  const completion = (model: string) =>
    Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    });

  const response = (model: string) =>
    Response.json({
      id: "resp_test",
      object: "response",
      created_at: 1,
      status: "completed",
      model,
      output: [
        {
          type: "message",
          id: "msg_test",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
    });

  function recordingFetch(answer: (model: string) => Response) {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.push({ url: String(url), headers: new Headers(init?.headers), body });
      return answer(String(body.model));
    }) as typeof globalThis.fetch;
    return { seen, fetch };
  }

  it("sends the OpenAI column's call to the app's base URL with the app's key", async () => {
    for (const name of SDK_VARIABLES) vi.stubEnv(name, `junk-${name}`);
    const { seen, fetch } = recordingFetch(response);
    const config = { apiKey: "the-apps-openai-key", baseUrl: "https://models.firewall.test/v1" };

    const result = await generateText({
      model: createColumnModel(OPENAI_COLUMN, config, { fetch }),
      prompt: "Hello",
      providerOptions: OPENAI_COLUMN.providerOptions,
    });

    expect(result.text).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://models.firewall.test/v1/responses");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer the-apps-openai-key");
    expect(seen[0]?.headers.get("openai-organization")).toBeNull();
    expect(seen[0]?.headers.get("openai-project")).toBeNull();
    expect(seen[0]?.body.model).toBe("gpt-6-luna");
    expect(seen[0]?.body.store).toBe(false);
  });

  it("sends the Gemini column's call to the app's base URL with the app's key", async () => {
    for (const name of SDK_VARIABLES) vi.stubEnv(name, `junk-${name}`);
    const { seen, fetch } = recordingFetch(completion);
    const config = {
      apiKey: "the-apps-gemini-key",
      baseUrl: "https://models.firewall.test/openai",
    };

    const result = await generateText({
      model: createColumnModel(GEMINI_COLUMN, config, { fetch }),
      prompt: "Hello",
      providerOptions: GEMINI_COLUMN.providerOptions,
    });

    expect(result.text).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://models.firewall.test/openai/chat/completions");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer the-apps-gemini-key");
    expect(seen[0]?.headers.get("x-goog-api-key")).toBeNull();
    expect(seen[0]?.body.model).toBe("gemini-3.5-flash-lite");
  });

  it("reads only the app's own variables", () => {
    const junk = Object.fromEntries(SDK_VARIABLES.map((name) => [name, `junk-${name}`]));
    expect(openaiConfigFromEnv({ ...junk, FIREWALL_OPENAI_API_KEY: "o" })).toEqual({
      apiKey: "o",
      baseUrl: DEFAULT_OPENAI_BASE_URL,
    });
    expect(geminiConfigFromEnv({ ...junk, FIREWALL_GEMINI_API_KEY: "g" })).toEqual({
      apiKey: "g",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
    });
    expect(
      openaiConfigFromEnv({
        FIREWALL_OPENAI_API_KEY: "o",
        FIREWALL_OPENAI_BASE_URL: "https://openai.firewall.test/v1/",
      }).baseUrl,
    ).toBe("https://openai.firewall.test/v1");
    expect(
      geminiConfigFromEnv({
        FIREWALL_GEMINI_API_KEY: "g",
        FIREWALL_GEMINI_BASE_URL: "https://gemini.firewall.test/openai/",
      }).baseUrl,
    ).toBe("https://gemini.firewall.test/openai");
  });

  it("defaults Gemini to the endpoint that takes a bearer key", () => {
    expect(DEFAULT_GEMINI_BASE_URL).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  it("refuses to run a column without its own key, naming the variable", () => {
    const junk = Object.fromEntries(SDK_VARIABLES.map((name) => [name, "junk"]));
    expect(() => openaiConfigFromEnv(junk)).toThrow(MissingConfigError);
    expect(() => openaiConfigFromEnv(junk)).toThrow(/FIREWALL_OPENAI_API_KEY/);
    expect(() => geminiConfigFromEnv(junk)).toThrow(MissingConfigError);
    expect(() => geminiConfigFromEnv(junk)).toThrow(/FIREWALL_GEMINI_API_KEY/);
    // Another column's key doesn't stand in for it.
    const anthropicOnly = { FIREWALL_ANTHROPIC_API_KEY: "a" };
    expect(() => columnConfigFromEnv(OPENAI_COLUMN, anthropicOnly)).toThrow(/FIREWALL_OPENAI/);
    expect(() => columnConfigFromEnv(GEMINI_COLUMN, anthropicOnly)).toThrow(/FIREWALL_GEMINI/);
    expect(columnConfigFromEnv(HAIKU_COLUMN, anthropicOnly).apiKey).toBe("a");
  });
});
