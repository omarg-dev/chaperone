// Where an event happened. Each lane is one row of the run timeline. The mandate lane holds what the
// mandate builder produced (the draft, the locked mandate); it is neither the agent nor a gate, and
// what the person does to the draft goes on the human lane.
export const LANES = [
  "agent",
  "arena",
  "gate0",
  "gate1",
  "gate2",
  "gate3",
  "payments",
  "human",
  "mandate",
] as const;
export type Lane = (typeof LANES)[number];

// Where the information in an event came from. Gate 3 and the timeline's causal arrows depend on
// this: an agent decision whose inputs trace back to seller_content is the signature of an attack.
export const PROVENANCES = ["user", "catalog", "seller_content", "system"] as const;
export type Provenance = (typeof PROVENANCES)[number];

// Known event types. The column is open text so a new kind of event doesn't need a migration;
// these are the ones the rest of the code relies on.
export type KnownEventType =
  | "run_started"
  | "run_finished"
  | "tool_call"
  | "tool_result"
  | "content_read"
  | "verdict"
  | "payment_call"
  | "payment_webhook"
  | "human_decision";
export type EventType = KnownEventType | (string & {});

export interface Event {
  // Position in the log: the order events were appended in, which is the order they replay in.
  seq: number;
  eventId: string;
  parentId: string | null;
  runId: string;
  scenarioId: string | null;
  // ISO 8601 in UTC.
  ts: string;
  lane: Lane;
  type: EventType;
  payload: unknown;
  provenance: Provenance;
  costUsd: number;
  latencyMs: number;
}

export interface NewEvent {
  runId: string;
  lane: Lane;
  type: EventType;
  provenance: Provenance;
  parentId?: string | null;
  scenarioId?: string | null;
  payload?: unknown;
  costUsd?: number;
  latencyMs?: number;
}

export interface RunSummary {
  runId: string;
  scenarioId: string | null;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  costUsd: number;
}
