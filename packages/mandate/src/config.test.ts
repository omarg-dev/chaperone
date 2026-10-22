import { afterEach, describe, expect, it, vi } from "vitest";
import { createMandateBuilder } from "./builder.js";
import { createAnthropicClient } from "./client.js";
import {
  anthropicConfigFromEnv,
  DEFAULT_ANTHROPIC_BASE_URL,
  MissingConfigError,
} from "./config.js";
import { replayFetch } from "./recorded.js";
import { builderAnswering, messageWith, tactileTerms, vocabulary } from "./test-helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("anthropicConfigFromEnv", () => {
  it("reads the app's own key and base URL", () => {
    expect(
      anthropicConfigFromEnv({
        FIREWALL_ANTHROPIC_API_KEY: " key ",
        FIREWALL_ANTHROPIC_BASE_URL: "https://models.example/",
      }),
    ).toEqual({ apiKey: "key", baseUrl: "https://models.example" });
  });

  it("defaults the base URL to the public API", () => {
    expect(anthropicConfigFromEnv({ FIREWALL_ANTHROPIC_API_KEY: "key" }).baseUrl).toBe(
      DEFAULT_ANTHROPIC_BASE_URL,
    );
  });

  // The shopping agent's provider wants /v1 in the base URL; the official SDK adds it itself.
  it("takes a base URL written for the agent, with /v1", () => {
    expect(
      anthropicConfigFromEnv({
        FIREWALL_ANTHROPIC_API_KEY: "key",
        FIREWALL_ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
      }).baseUrl,
    ).toBe("https://api.anthropic.com");
  });

  it("refuses to run without the app's key, even when the SDK's own variable is set", () => {
    expect(() => anthropicConfigFromEnv({ ANTHROPIC_API_KEY: "the-sessions-key" })).toThrow(
      MissingConfigError,
    );
    expect(() => anthropicConfigFromEnv({})).toThrow(/FIREWALL_ANTHROPIC_API_KEY/);
  });
});

// Cloud sessions set ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL and friends for Claude Code itself. The
// builder's client must never use them (CLAUDE.md, "Model clients are configured explicitly").
describe("test_model_clients_use_the_apps_own_config", () => {
  it("sends only the app's key to the app's base URL, whatever the SDK's variables say", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "junk-key-from-the-session");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://session-proxy.invalid");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "junk-token-from-the-session");
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "X-Session-Secret: junk\nAuthorization: Bearer junk");
    vi.stubEnv("FIREWALL_ANTHROPIC_API_KEY", "the-apps-own-key");
    vi.stubEnv("FIREWALL_ANTHROPIC_BASE_URL", "https://models.firewall.test");

    const replay = replayFetch(messageWith(JSON.stringify(tactileTerms)));
    const builder = createMandateBuilder({
      client: createAnthropicClient(anthropicConfigFromEnv(), { fetch: replay.fetch }),
      vocabulary,
    });
    await builder.draft("Buy me a tactile mechanical keyboard under $120.");

    expect(replay.sent).toHaveLength(1);
    const [call] = replay.sent;
    expect(call?.url).toBe("https://models.firewall.test/v1/messages");
    expect(call?.headers.get("x-api-key")).toBe("the-apps-own-key");
    expect(call?.headers.get("authorization")).toBeNull();
    expect(call?.headers.get("x-session-secret")).toBeNull();
    const everyHeader = [...(call?.headers.values() ?? [])].join("\n");
    expect(everyHeader).not.toContain("junk");
  });

  it("never falls back to the environment's base URL when given the default", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://session-proxy.invalid");
    vi.stubEnv("FIREWALL_ANTHROPIC_API_KEY", "the-apps-own-key");
    const replay = replayFetch(messageWith(JSON.stringify(tactileTerms)));
    const builder = createMandateBuilder({
      client: createAnthropicClient(anthropicConfigFromEnv(), { fetch: replay.fetch }),
      vocabulary,
    });
    await builder.draft("Buy me a tactile mechanical keyboard under $120.");
    expect(replay.sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("is what the test helpers use too", async () => {
    const { builder, sent } = builderAnswering(messageWith(JSON.stringify(tactileTerms)));
    await builder.draft("Buy me a tactile mechanical keyboard under $120.");
    expect(sent[0]?.headers.get("x-api-key")).toBe("the-apps-own-key");
  });
});
