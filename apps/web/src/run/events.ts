// The events the server sends for a run (GET /events/runs/:runId), as the web app reads them. The
// shape is the event log's (packages/events/src/types.ts); the payloads are open, so the run view
// reads them through the small helpers below and ignores anything it doesn't know.

export interface RunEvent {
  seq: number;
  eventId: string;
  parentId: string | null;
  runId: string;
  scenarioId: string | null;
  // ISO 8601 in UTC.
  ts: string;
  lane: string;
  type: string;
  payload: unknown;
  provenance: "user" | "catalog" | "seller_content" | "extracted" | "system";
  costUsd: number;
  latencyMs: number;
}

// One of the run's payees, from GET /events/runs/:runId/payees: the log never holds a seller's
// role, so the server rebuilds it from the run's scenario and seed.
export interface Payee {
  payeeKey: string;
  sellerName: string;
  role: "honest" | "attacker";
}

export type Obj = Record<string, unknown>;

export const obj = (value: unknown): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
