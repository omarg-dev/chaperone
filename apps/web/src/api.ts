// The server's own API, called with relative URLs: the Hono server serves this app and the API from
// one origin, and in development Vite proxies them (vite.config.ts).

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
}

export interface ScenarioInfo {
  scenarioId: string;
  title: string;
  request: string;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchRuns = () => getJson<RunSummary[]>("/events/runs");
export const fetchScenarios = () => getJson<ScenarioInfo[]>("/arena/scenarios");
