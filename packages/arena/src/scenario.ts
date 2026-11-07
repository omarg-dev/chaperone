import { ninetyNine } from "./inject.js";
import type { Intent } from "./intent.js";
import type { Harm } from "./outcome.js";
import { type Random, seededRandom } from "./random.js";
import type { Catalog, Listing } from "./types.js";

// A1 to A7 are our own attacks. H01 and on are the held-out set (scenarios/held-out.ts), ported
// from published benchmarks.
export type AttackId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | `H${string}`;

// Where a held-out attack comes from, for the attribution its licence asks for and so a reader
// can check the port against the original (docs/held-out.md).
export interface AttackSource {
  // The benchmark's name, as its authors write it.
  benchmark: string;
  // Which of its attacks: the template, injection task or strategy, by the benchmark's own ID.
  item: string;
  // The repository the attack text was taken from.
  url: string;
  // The licence it is used under, as an SPDX identifier.
  licence: string;
  // What the port changed, and why, in a sentence or two.
  adaptation: string;
}

// Ground truth for an attack scenario, for the eval only. Never shown to the agent or the gates,
// and left out of the scenario list the API serves.
export interface Attack {
  attackId: AttackId;
  // Which version of the attack, where it comes in more than one (A1: "unverified", "verified").
  // For a held-out attack, the source's own name for it.
  variant: string | null;
  // What the attacker does, in a sentence, for the eval report.
  summary: string;
  // The harm that means the attack worked (see outcome.ts).
  harm: Harm;
  // Set on the held-out set only: attacks written by others, never used to tune the gates, and
  // run on their own (`--scenarios held-out`), so their rates are never pooled with ours.
  heldOut?: true;
  source?: AttackSource;
}

interface ScenarioBase {
  scenarioId: string;
  // A short label for the run list and the dashboard. Describes the request only, never the attack.
  title: string;
  // What the person tells their agent, word for word.
  request: string;
  intent: Intent;
  // A held-out scenario reuses a benign scenario's request, title and intent (its user task, as
  // AgentDojo calls it) and adds only the attack, so its arena differs from that scenario's by the
  // attack alone. Set to that scenario's ID; unset on every other scenario.
  userTask?: string;
  // Attack scenarios change the arena (a poisoned review, an attacker's listing). Benign ones
  // leave it as it is. Must use only `random` for randomness, so the seed decides everything.
  inject?: (catalog: Catalog, random: Random) => Catalog;
}

export type ScenarioDefinition =
  | (ScenarioBase & { kind: "benign" })
  | (ScenarioBase & { kind: "attack"; attack: Attack });

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
  return {
    ...listing,
    priceCents: ninetyNine(listing.priceCents * factor),
    page: { ...listing.page, reviews: random.shuffle(listing.page.reviews) },
  };
}
