import type { Catalog } from "@firewall/arena";
import {
  channel3ConfigFromEnv,
  createChannel3Market,
  createExtractor,
  createIntentAuditor,
  EXTRACTOR_MODEL,
  extractionVocabulary,
  type ReviewGates,
} from "@firewall/firewall";
import {
  arenaVocabulary,
  createAnthropicClient,
  createMandateBuilder,
  anthropicConfigFromEnv as gateConfigFromEnv,
  type MandateBuilder,
} from "@firewall/mandate";
import { type AgentColumn, createColumnModel, HAIKU_COLUMN } from "./columns.js";
import { anthropicConfigFromEnv } from "./config.js";

// The models of a live run, built from the app's own settings and nothing else: the agent's
// column, the mandate builder and the gates. The command line (`run-scenario`) and the server's
// web runs both start here, so a live run is the same whoever starts it.
//
// A live run is always the Claude Haiku 5.5 column: one model per column, and the gates never
// change model (CLAUDE.md). The key and base URL come from FIREWALL_ANTHROPIC_API_KEY and
// FIREWALL_ANTHROPIC_BASE_URL, passed to each client explicitly (they never fall back to an SDK's
// own variables), and Gate 2's market reference from FIREWALL_CHANNEL3_API_KEY, optional.

export interface LiveModels {
  column: AgentColumn;
  // The shopping agent's model.
  model: ReturnType<typeof createColumnModel>;
  // Drafts a mandate from a request.
  builder: MandateBuilder;
  // The model gates for a run's catalog (the extractor's vocabulary is the catalog's).
  gates: (catalog: Catalog) => ReviewGates;
  gateModel: string;
}

export interface LiveOptions {
  // Replaces the network, for tests that answer the providers' HTTP calls themselves.
  fetch?: typeof globalThis.fetch;
}

// Throws a MissingConfigError naming FIREWALL_ANTHROPIC_API_KEY when it isn't set: a live run
// refuses to start rather than pick up whatever key the environment holds.
export function liveModelsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: LiveOptions = {},
): LiveModels {
  const agentConfig = anthropicConfigFromEnv(env);
  const gatesConfig = gateConfigFromEnv(env);
  // The mandate builder and the gates share one client.
  const client = createAnthropicClient(gatesConfig, options.fetch ? { fetch: options.fetch } : {});
  return {
    column: HAIKU_COLUMN,
    model: createColumnModel(
      HAIKU_COLUMN,
      agentConfig,
      options.fetch ? { fetch: options.fetch } : {},
    ),
    builder: createMandateBuilder({ client, vocabulary: arenaVocabulary() }),
    gates: (catalog) => ({
      extractor: createExtractor({ client, vocabulary: extractionVocabulary(catalog) }),
      auditor: createIntentAuditor({ client }),
      market: createChannel3Market(channel3ConfigFromEnv(env)),
    }),
    gateModel: EXTRACTOR_MODEL,
  };
}
