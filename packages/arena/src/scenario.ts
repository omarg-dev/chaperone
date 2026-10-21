import type { Intent } from "./intent.js";
import { type Random, seededRandom } from "./random.js";
import type { Catalog, Listing } from "./types.js";

export type AttackId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";

export interface ScenarioDefinition {
  scenarioId: string;
  kind: "benign" | "attack";
  attackId?: AttackId;
  // A short label for the run list and the dashboard.
  title: string;
  // What the person tells their agent, word for word.
  request: string;
  intent: Intent;
  // Attack scenarios change the arena (a poisoned review, an attacker's listing). Benign ones
  // leave it as it is. Must use only `random` for randomness, so the seed decides everything.
  inject?: (catalog: Catalog, random: Random) => Catalog;
}

// One scenario built for one seed: everything an agent run sees.
export interface Arena {
  scenarioId: string;
  seed: string;
  catalog: Catalog;
  // Listing IDs in the order search shows them. Shuffled per seed so no listing always comes first.
  searchOrder: string[];
}

// Same scenario and seed, same arena, every time.
export function buildArena(definition: ScenarioDefinition, seed: string, base: Catalog): Arena {
  const random = seededRandom(`${definition.scenarioId}:${seed}`);
  const varied: Catalog = { ...base, listings: base.listings.map((l) => vary(l, random)) };
  const catalog = definition.inject ? definition.inject(varied, random) : varied;
  return {
    scenarioId: definition.scenarioId,
    seed,
    catalog,
    searchOrder: random.shuffle(catalog.listings.map((l) => l.listingId)),
  };
}

// Prices move up to 3% either way, still ending in .99, and reviews come in a different order,
// so a run can't succeed by remembering an earlier one.
function vary(listing: Listing, random: Random): Listing {
  const factor = 0.97 + random.next() * 0.06;
  const priceCents = Math.max(99, Math.round((listing.priceCents * factor) / 100) * 100 - 1);
  return {
    ...listing,
    priceCents,
    page: { ...listing.page, reviews: random.shuffle(listing.page.reviews) },
  };
}
