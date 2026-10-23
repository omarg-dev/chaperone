import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicConfig } from "./config.js";

export interface ClientOptions {
  // Replaces the network call, so tests can answer it with a recorded response.
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
}

// The official SDK fills in every setting it isn't given from the environment: the key, a bearer
// token, the base URL, extra headers and the log level. Claude Code's cloud sessions set some of
// those for themselves, so each one is passed here explicitly and none comes from the environment.
export function createAnthropicClient(
  config: AnthropicConfig,
  options: ClientOptions = {},
): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    // null, not undefined: undefined means "read ANTHROPIC_AUTH_TOKEN".
    authToken: null,
    baseURL: config.baseUrl,
    webhookKey: null,
    logLevel: "warn",
    defaultHeaders: withoutEnvironmentHeaders(),
    maxRetries: options.maxRetries ?? 1,
    timeout: 60_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

// The SDK always adds the headers named in ANTHROPIC_CUSTOM_HEADERS, and has no switch to stop it.
// A default header set to null removes a header, and the client's own defaults win over the
// variable's, so each header the variable names is cancelled here. This reads the variable only to
// cancel what it says.
function withoutEnvironmentHeaders(): Record<string, null> {
  const raw = process.env.ANTHROPIC_CUSTOM_HEADERS;
  if (!raw) return {};
  const names = raw
    .split("\n")
    .filter((line) => line.includes(":"))
    .map((line) => line.slice(0, line.indexOf(":")).trim())
    .filter((name) => name.length > 0);
  return Object.fromEntries(names.map((name) => [name, null]));
}
