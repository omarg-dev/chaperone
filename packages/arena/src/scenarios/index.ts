import type { ScenarioDefinition } from "../scenario.js";
import { ATTACK_SCENARIOS } from "./attacks.js";
import { BENIGN_SCENARIOS } from "./benign.js";

// Every scenario the arena can run.
export const SCENARIOS: ScenarioDefinition[] = [...BENIGN_SCENARIOS, ...ATTACK_SCENARIOS];

export function findScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.scenarioId === scenarioId);
}
