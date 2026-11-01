import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HAIKU_COLUMN } from "./columns.js";
import { MissingConfigError } from "./config.js";
import { liveModelsFromEnv } from "./live.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const recorded = JSON.parse(
  readFileSync(new URL("../../mandate/fixtures/requests/sc_b01.json", import.meta.url), "utf8"),
) as { requestText: string; response: unknown };

const agentAnswer = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: HAIKU_COLUMN.modelId,
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 1 },
};

// The live run's models are built here for the command line and the web app alike, so the rule
// about model clients (CLAUDE.md) is pinned where they are made.
describe("test_model_clients_use_the_apps_own_config", () => {
  it("sends every model call, the agent's and the mandate builder's, with the app's key to the app's URL", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "junk-key-from-the-session");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://session-proxy.invalid");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "junk-token-from-the-session");

    const seen: { url: string; headers: Headers }[] = [];
    const answers = [agentAnswer, recorded.response];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      return Response.json(answers.shift());
    }) as typeof globalThis.fetch;

    const models = liveModelsFromEnv(
      {
        FIREWALL_ANTHROPIC_API_KEY: "the-apps-own-key",
        FIREWALL_ANTHROPIC_BASE_URL: "https://models.firewall.test",
      },
      { fetch },
    );
    expect((await generateText({ model: models.model, prompt: "Hello" })).text).toBe("ok");
    await models.builder.draft(recorded.requestText);

    expect(seen.map((s) => s.url)).toEqual([
      "https://models.firewall.test/v1/messages",
      "https://models.firewall.test/v1/messages",
    ]);
    for (const call of seen) {
      expect(call.headers.get("x-api-key")).toBe("the-apps-own-key");
      expect(call.headers.get("authorization")).toBeNull();
    }
  });

  it("is the Claude Haiku 5.5 column, and the gates run on the same model", () => {
    const models = liveModelsFromEnv({ FIREWALL_ANTHROPIC_API_KEY: "the-apps-own-key" });
    expect(models.column).toBe(HAIKU_COLUMN);
    expect(models.gateModel).toBe(HAIKU_COLUMN.modelId);
  });

  it("refuses to start without the app's own key, whatever else the environment holds", () => {
    expect(() =>
      liveModelsFromEnv({ ANTHROPIC_API_KEY: "junk", ANTHROPIC_AUTH_TOKEN: "junk" }),
    ).toThrow(MissingConfigError);
    expect(() => liveModelsFromEnv({})).toThrow(/FIREWALL_ANTHROPIC_API_KEY/);
  });
});
