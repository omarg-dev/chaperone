// The server's own API, called with relative URLs: the Hono server serves this app and the API from
// one origin, and in development Vite proxies them (vite.config.ts).

export interface RunSummary {
  runId: string;
  scenarioId: string | null;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  costUsd: number;
}

export interface ScenarioInfo {
  scenarioId: string;
  title: string;
  request: string;
}

// The parts of an event the web app reads. The server sends more.
export interface RunEvent {
  eventId: string;
  type: string;
  lane: string;
  payload: unknown;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchRuns = () => getJson<RunSummary[]>("/events/runs");
export const fetchScenarios = () => getJson<ScenarioInfo[]>("/arena/scenarios");
export const fetchRunEvents = (runId: string) =>
  getJson<RunEvent[]>(`/events/runs/${encodeURIComponent(runId)}`);
