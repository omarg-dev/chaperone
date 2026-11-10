import type Anthropic from "@anthropic-ai/sdk";
import {
  anthropicConfigFromEnv,
  type ClientOptions,
  createAnthropicClient,
  MissingConfigError,
} from "@firewall/mandate";

export interface StudioClient {
  client: Anthropic | null;
  // Why the assistant is off, when there is no client.
  offReason: string | null;
}

// The dashboard assistant's model client: the mandate builder's own builder, so the key and the base
// URL come from FIREWALL_ANTHROPIC_API_KEY and FIREWALL_ANTHROPIC_BASE_URL alone and every other
// setting the official SDK would read from the environment is passed explicitly (CLAUDE.md, "Model
// clients are configured explicitly"). Without the key the assistant is off, never on another key.
export function studioClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: ClientOptions = {},
): StudioClient {
  try {
    return { client: createAnthropicClient(anthropicConfigFromEnv(env), options), offReason: null };
  } catch (error) {
    if (!(error instanceof MissingConfigError)) throw error;
    return {
      client: null,
      offReason: "The assistant is off: this server has no model key (FIREWALL_ANTHROPIC_API_KEY).",
    };
  }
}
