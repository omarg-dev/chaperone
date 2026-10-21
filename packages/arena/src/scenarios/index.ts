import type { ScenarioDefinition } from "../scenario.js";
import { BENIGN_SCENARIOS } from "./benign.js";

// Every scenario the arena can run. Attack scenarios join this list as they're written.
export const SCENARIOS: ScenarioDefinition[] = [...BENIGN_SCENARIOS];

export function findScenario(scenarioId: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.scenarioId === scenarioId);
}
