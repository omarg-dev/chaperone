import { LANES, type NewEvent, PROVENANCES } from "./types.js";

// Problems with an event before it's written, as messages a developer can act on. Empty when valid.
// TypeScript already checks callers; this catches what arrives from JSON (webhooks, the SDK).
export function validateNewEvent(input: NewEvent): string[] {
  const problems: string[] = [];
  if (!input.runId) problems.push("runId is required");
  if (!input.type) problems.push("type is required");
  if (!(LANES as readonly string[]).includes(input.lane)) {
    problems.push(`lane must be one of ${LANES.join(", ")}, got "${input.lane}"`);
  }
  if (!(PROVENANCES as readonly string[]).includes(input.provenance)) {
    problems.push(`provenance must be one of ${PROVENANCES.join(", ")}, got "${input.provenance}"`);
  }
  const cost = input.costUsd ?? 0;
  if (!Number.isFinite(cost) || cost < 0) {
    problems.push(`costUsd must be a number of 0 or more, got ${cost}`);
  }
  const latency = input.latencyMs ?? 0;
  if (!Number.isInteger(latency) || latency < 0) {
    problems.push(`latencyMs must be a whole number of 0 or more, got ${latency}`);
  }
  return problems;
}
