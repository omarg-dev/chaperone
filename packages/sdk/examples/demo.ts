// Stand-ins so the README's example runs offline and for free: the mandate a person would have
// confirmed in your app, a listing from an attacker's store, and a model that buys it. Swap the
// model for yours and the mandate for the one your person confirms.
import { baseCatalog, buildArena, findScenario, type ScenarioDefinition } from "@firewall/arena";
import {
  arenaVocabulary,
  DEFAULT_TOLERANCES,
  type LockedMandate,
  lockMandate,
} from "@firewall/mandate";
import { MockLanguageModelV4 } from "ai/test";

function scenarioOf(scenarioId: string): ScenarioDefinition {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`No scenario ${scenarioId}`);
  return scenario;
}

export function confirmedMandate(scenarioId: string): LockedMandate {
  const { request, intent } = scenarioOf(scenarioId);
  return lockMandate(
    {
      mandateId: "md_demo",
      requestText: request,
      category: intent.category,
      constraints: intent.constraints,
      brandPolicy: { mode: "any_reputable", listed: [], blocked: [] },
      maxUnitPriceCents: intent.maxUnitPriceCents ?? null,
      quantity: intent.quantity,
      allowedExtras: [],
      unmapped: [],
      currency: "USD",
      payeePolicy: "verified_sellers_only",
      tolerances: { ...DEFAULT_TOLERANCES },
    },
    { vocabulary: arenaVocabulary(), confirmedAt: new Date().toISOString() },
  );
}

// A listing an attacker's store sells in the scenario's category: what a poisoned page steers a
// shopping agent to.
export function attackerListing(scenarioId: string, seed: string): string {
  const scenario = scenarioOf(scenarioId);
  const { catalog } = buildArena(scenario, seed, baseCatalog);
  const attackers = new Set(
    catalog.sellers.filter((s) => s.role === "attacker").map((s) => s.sellerId),
  );
  const found = catalog.listings.find(
    (l) =>
      attackers.has(l.sellerId) &&
      catalog.products.find((p) => p.sku === l.sku)?.category === scenario.intent.category,
  );
  if (!found) throw new Error(`${scenarioId} has no attacker listing`);
  return found.listingId;
}

const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
};
const call = (n: number, toolName: string, input: object) => ({
  content: [
    {
      type: "tool-call" as const,
      toolCallId: `call_${n}`,
      toolName,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
  usage,
  warnings: [],
});

// A model that adds one listing to the cart and checks out.
export function buyingModel(listingId: string) {
  const turns = [
    call(1, "add_to_cart", { listingId, quantity: 1 }),
    call(2, "checkout", {}),
    {
      content: [{ type: "text" as const, text: "Done." }],
      finishReason: { unified: "stop" as const, raw: "end_turn" },
      usage,
      warnings: [],
    },
  ];
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => turns[Math.min(i++, turns.length - 1)] as (typeof turns)[number],
  });
}
