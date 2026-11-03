// The server's own API, called with relative URLs: the Hono server serves this app and the API from
// one origin, and in development Vite proxies them (vite.config.ts).

import type { ResultsSummary, ResultsView } from "@firewall/eval/view";
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
  // What the order's hold is for, in cents: how much money the run has had. Null until the agent has
  // checked out. Where it is follows from the outcome (see `placeOf` in runs/money.ts).
  heldCents: number | null;
  // The stores the money was paid out to, by name, once it was captured.
  paidTo: string[];
  // "web" for a live run started from the Start a run page; null for the eval's and the command
  // line's.
  origin: string | null;
  // Which payment adapter holds the run's money, when the run says: "fake" is practice money.
  payments: "fake" | "sandbox" | null;
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
    // The rest of the server's answer, for the few that carry more (a refused edit's problems).
    readonly body: Record<string, unknown> = {},
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

// The eval's results files, as the server serves them (GET /eval/results). `available` is false when
// the server has no results folder, which is not the same as a folder with nothing in it.
export interface ResultsList {
  available: boolean;
  results: ResultsSummary[];
  // Files that look like results but couldn't be read, and why.
  unreadable: { name: string; reason: string }[];
}

export const fetchResultsList = () => getJson<ResultsList>("/eval/results");

// One results file. A file the server refuses to read (422) says why in its own words.
export async function fetchResults(name: string): Promise<ResultsView> {
  const path = `/eval/results/${encodeURIComponent(name)}`;
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      response.status,
      null,
      body?.message ?? `${path} answered ${response.status}`,
    );
  }
  return ((await response.json()) as { results: ResultsView }).results;
}

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

// ---- Live runs (the Start a run page)

export type FirewallSetting = "off" | "gate0" | "full";

export interface LiveBudget {
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  // What the agent may spend in a run that starts now, after the review's allowance.
  agentRoomUsd: number;
  // The day's budget is used up.
  exhausted: boolean;
  // The next UTC midnight.
  resetsAt: string;
}

export interface LiveStatus {
  available: boolean;
  // Why live runs are off, in a sentence, or null.
  reason: string | null;
  payments: "fake" | "sandbox" | null;
  budget: LiveBudget;
  // A live run is in progress.
  busy: boolean;
  agentModel: string;
  gateModel: string;
}

export interface MandateRow {
  label: string;
  value: string;
  field: string | null;
  // What an edit box starts from, and what to type; null where the row can't be edited.
  editText: string | null;
  hint: string | null;
}

export interface MandateView {
  runId: string;
  scenarioId: string;
  request: string;
  state: "drafted" | "locked" | "rejected" | "failed";
  rows: MandateRow[];
  problems: string[];
  canConfirm: boolean;
  lock: { hash: string; confirmedAt: string } | null;
  note: string | null;
  costUsd: number;
}

export type MandateAction =
  | { action: "edit"; field: string; input: string }
  | { action: "confirm" }
  | { action: "reject"; reason?: string };

async function sendJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof answer?.error === "string" ? answer.error : null,
      typeof answer?.message === "string" ? answer.message : `${path} answered ${response.status}`,
      answer ?? {},
    );
  }
  return answer as T;
}

export const fetchLiveStatus = () => getJson<LiveStatus>("/live/status");
export const fetchMandate = (runId: string) =>
  getJson<MandateView>(`/live/runs/${encodeURIComponent(runId)}/mandate`);
export const postDraft = (scenarioId: string) =>
  sendJson<MandateView>("/live/runs", { scenarioId });
export const postMandate = (runId: string, action: MandateAction) =>
  sendJson<MandateView>(`/live/runs/${encodeURIComponent(runId)}/mandate`, action);
export const postStart = (runId: string, firewall: FirewallSetting) =>
  sendJson<{ runId: string; firewall: FirewallSetting }>(
    `/live/runs/${encodeURIComponent(runId)}/start`,
    { firewall },
  );
