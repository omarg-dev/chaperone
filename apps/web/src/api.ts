// The server's own API, called with relative URLs: the Hono server serves this app and the API from
// one origin, and in development Vite proxies them (vite.config.ts).

import type { Escalation } from "@firewall/events/outcome";
import type { Payee, RunEvent } from "./run/events";

export interface RunSummary {
  runId: string;
  scenarioId: string | null;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  costUsd: number;
  // The final verdict: the review's, or a person's decision on an escalation (a reject reads as
  // block). Null with no review yet, with the firewall off and when a gate broke.
  verdict: "approve" | "escalate" | "block" | null;
  // Who decided it: the review, a person, or nobody (the firewall was off).
  decidedBy: "review" | "person" | "no_review" | null;
  // A gate broke: nothing was enforced and the order stays held.
  reviewFailed: boolean;
  // The platform's hold on the order is still open: no capture or void of it has gone through.
  holdOpen: boolean;
  // What an escalated run needs, from the person's decision and the hold (see `escalationOf` in
  // @firewall/events): waiting for a person, unfinished (decided, hold still open), released
  // (the hold closed with no decision) or decided. Null when the review didn't escalate.
  escalation: Escalation | null;
  // The seed the run's scenario was built with.
  seed: string | null;
  // The firewall configuration of each review the run went through, in order ("off", "gate0",
  // "full"). An eval run reviews one checkout under all three; the last is the one that counts.
  reviews: string[];
  // Whether the run's scenario is an attack, or null when the arena doesn't know the scenario.
  kind: "attack" | "benign" | null;
  // Money was paid out to one of the scenario's attackers.
  attackerPaid: boolean;
}

export interface ScenarioInfo {
  scenarioId: string;
  title: string;
  request: string;
}

// What a call to the server answered when it wasn't ok: the status, the server's own error code and
// its message, which is written for a person ("This server can't carry out a decision: ...").
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchRuns = () => getJson<RunSummary[]>("/events/runs");
export const fetchScenarios = () => getJson<ScenarioInfo[]>("/arena/scenarios");

// A run's events in replay order. An unknown run is an empty list, not an error.
export const fetchRunEvents = (runId: string) =>
  getJson<RunEvent[]>(`/events/runs/${encodeURIComponent(runId)}`);
export const fetchPayees = (runId: string) =>
  getJson<Payee[]>(`/events/runs/${encodeURIComponent(runId)}/payees`);

export interface DecisionResult {
  status: "enforced" | "already_enforced" | "awaiting_person";
  money: "captured" | "voided" | "held";
  decidedBy: "review" | "person" | "no_review";
}

// A person's decision on an escalated run. The server carries it out (capture and pay, or void)
// and answers once the money has moved; a repeat answers "already_enforced".
export async function postDecision(
  runId: string,
  decision: "approve" | "reject",
): Promise<DecisionResult> {
  const path = `/events/runs/${encodeURIComponent(runId)}/decision`;
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new ApiError(
      response.status,
      body?.error ?? null,
      body?.message ?? `${path} answered ${response.status}`,
    );
  }
  return (await response.json()) as DecisionResult;
}
