// The mandate builder's model credentials, read only from the app's own variables.
//
// Cloud sessions set ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (and sometimes ANTHROPIC_AUTH_TOKEN)
// for Claude Code itself, and the official SDK falls back to exactly those names for any setting
// it isn't given. So nothing here reads them: the key and base URL come from FIREWALL_ variables
// and client.ts passes every one of the SDK's settings explicitly (CLAUDE.md, "Model clients are
// configured explicitly").
//
// The shopping agent (step 8, @firewall/agent) has its own reader for the same two variables.
// They should become one shared config module once both are merged.

// The official SDK adds /v1 itself. The agent's AI SDK provider expects it in the base URL, so a
// value written for the agent (ending in /v1) is accepted here too.
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export interface AnthropicConfig {
  apiKey: string;
  baseUrl: string;
}

export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

// Fails, naming the variable, when the key isn't set: the builder refuses to call a model without
// the app's own key rather than pick up whatever the environment holds.
export function anthropicConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicConfig {
  const apiKey = env.FIREWALL_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingConfigError(
      "The mandate builder needs FIREWALL_ANTHROPIC_API_KEY, the app's own Anthropic key. " +
        "It never uses ANTHROPIC_API_KEY. See .env.example.",
    );
  }
  const raw = env.FIREWALL_ANTHROPIC_BASE_URL?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
  return { apiKey, baseUrl: raw.replace(/\/+$/, "").replace(/\/v1$/, "") };
}
