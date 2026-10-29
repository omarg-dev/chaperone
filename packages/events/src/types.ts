// Where an event happened. Each lane is one row of the run timeline. The mandate lane holds what the
// mandate builder produced (the draft, the locked mandate); it is neither the agent nor a gate, and
// what the person does to the draft goes on the human lane. The review lane holds the review tree's
// own events: that it started, the verdict it combined from the gates', and what was done about it
// (captured, voided, or held for the person). No gate's lane fits them: each gate's lane is that
// gate's, and the payments lane is the platform's calls, not the decision behind them.
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
  "review",
] as const;
export type Lane = (typeof LANES)[number];

// Where the information in an event came from. Gate 3 and the timeline's causal arrows depend on
// this: an agent decision whose inputs trace back to seller_content is the signature of an attack.
// extracted marks typed facts the quarantined extractor (Gate 1) read out of seller content: enums,
// numbers and capped quotes kept as evidence, never the raw text. They are neither the firewall's
// own judgement (system) nor raw seller_content, and the timeline and Gate 3 need to tell them apart.
export const PROVENANCES = ["user", "catalog", "seller_content", "extracted", "system"] as const;
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

// What the review and the person made of a run, read from its review and human events.
export interface RunOutcome {
  // The final verdict: the review's, or the person's decision on an escalation (approve, or block
  // for a reject). Null when there is none: no review yet, the firewall was off, or a gate broke.
  verdict: "approve" | "escalate" | "block" | null;
  // Who decided it: the review, a person, or nobody (the firewall was off). Null with no verdict
  // and no review yet.
  decidedBy: "review" | "person" | "no_review" | null;
  // A gate broke: nothing was enforced and the order stays held.
  reviewFailed: boolean;
}

// What a run list shows beyond the outcome: see `facetsOf`.
export interface RunFacets {
  // The seed the run's scenario was built with.
  seed: string | null;
  // The firewall configuration of each review the run went through, in order. An eval run reviews
  // one checkout under off, gate0 and full; the last is the one the outcome comes from.
  reviews: string[];
  // The payee keys the money was paid out to, once it was captured. Which of them is an attacker
  // is the arena's to say, so the server answers that.
  paidPayees: string[];
}

export interface RunSummary extends RunOutcome, RunFacets {
  runId: string;
  scenarioId: string | null;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  costUsd: number;
}
