import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createColumnModel, HAIKU_COLUMN } from "./columns.js";
import {
  anthropicConfigFromEnv,
  DEFAULT_ANTHROPIC_BASE_URL,
  MissingConfigError,
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

  it("refuses to run live without the app's key, even when the SDK's key is set", () => {
    expect(() => anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "junk" })).toThrow(MissingConfigError);
    expect(() => anthropicConfigFromEnv({})).toThrow(/FIREWALL_ANTHROPIC_API_KEY/);
  });
});
