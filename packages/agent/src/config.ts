// The agent's model credentials, read only from the app's own variables.
//
// Cloud sessions set ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL for Claude Code itself, and the
// Anthropic provider falls back to exactly those names whenever a setting isn't passed. So the key
// and the base URL are always passed explicitly, both from FIREWALL_ variables, and nothing here
// reads an SDK's own variable names (CLAUDE.md, "Model clients are configured explicitly").

export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

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

// Fails, naming the variable, when the key isn't set: the live agent refuses to run without the
// app's own key rather than pick up whatever the environment holds.
export function anthropicConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicConfig {
  const apiKey = env.FIREWALL_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingConfigError(
      "The live agent needs FIREWALL_ANTHROPIC_API_KEY, the app's own Anthropic key. " +
        "It never uses ANTHROPIC_API_KEY. See .env.example.",
    );
  }
  const baseUrl = env.FIREWALL_ANTHROPIC_BASE_URL?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
  return { apiKey, baseUrl };
}
