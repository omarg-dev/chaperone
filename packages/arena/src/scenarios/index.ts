import type { ScenarioDefinition } from "../scenario.js";
import { ATTACK_SCENARIOS } from "./attacks.js";
import { BENIGN_SCENARIOS } from "./benign.js";
import { HELD_OUT_SCENARIOS } from "./held-out.js";

// Every scenario the arena can run: our own benign and attack scenarios, then the held-out set.
export const SCENARIOS: ScenarioDefinition[] = [
  ...BENIGN_SCENARIOS,
  ...ATTACK_SCENARIOS,
  ...HELD_OUT_SCENARIOS,
];

export function findScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.scenarioId === scenarioId);
}
