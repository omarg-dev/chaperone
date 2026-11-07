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

// Any provider's key and base URL, as passed to its client. The Anthropic one is the same shape.
export type ModelConfig = AnthropicConfig;

// The OpenAI column's endpoint, and the Gemini column's: Google's OpenAI-compatible endpoint, which
// takes the key as `Authorization: Bearer` (its native API only takes `x-goog-api-key` or OAuth, so
// it can't sit behind a proxy that attaches a bearer key). docs/PLAN.md, "Models".
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

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
  // The AI SDK's provider expects /v1 in the base URL and the official SDK adds it itself, so the
  // one variable both read may be written either way: this side makes sure it ends in /v1.
  const raw = env.FIREWALL_ANTHROPIC_BASE_URL?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
  const baseUrl = `${raw.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
  return { apiKey, baseUrl };
}

const withoutTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

// The OpenAI column's settings, from FIREWALL_OPENAI_API_KEY and FIREWALL_OPENAI_BASE_URL only.
// The OpenAI provider falls back to OPENAI_API_KEY and OPENAI_BASE_URL when a setting isn't passed,
// so both are always passed here.
export function openaiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const apiKey = env.FIREWALL_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingConfigError(
      "The OpenAI column needs FIREWALL_OPENAI_API_KEY, the app's own OpenAI key. " +
        "It never uses OPENAI_API_KEY. See .env.example.",
    );
  }
  const raw = env.FIREWALL_OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL;
  return { apiKey, baseUrl: withoutTrailingSlashes(raw) };
}

// The Gemini column's settings, from FIREWALL_GEMINI_API_KEY and FIREWALL_GEMINI_BASE_URL only,
// never GEMINI_API_KEY, GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.
export function geminiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const apiKey = env.FIREWALL_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingConfigError(
      "The Gemini column needs FIREWALL_GEMINI_API_KEY, the app's own Gemini key. " +
        "It never uses GEMINI_API_KEY or GOOGLE_API_KEY. See .env.example.",
    );
  }
  const raw = env.FIREWALL_GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL;
  return { apiKey, baseUrl: withoutTrailingSlashes(raw) };
}
