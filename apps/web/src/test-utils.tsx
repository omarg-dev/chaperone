import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { vi } from "vitest";
import { App } from "./App";
import type { RunSummary, ScenarioInfo } from "./api";
import type { Payee, RunEvent } from "./run/events";
import { ThemeProvider } from "./theme/ThemeProvider";

// A stand-in for the device's colour preference, which jsdom doesn't have. Returns a function that
// changes it the way switching the operating system's theme would.
export function mockDevice(dark: boolean) {
  let matches = dark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        media: query,
        get matches() {
          return query.includes("dark") ? matches : false;
        },
        addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
  };
}

export interface FakeServer {
  runs?: RunSummary[];
  scenarios?: ScenarioInfo[];
  // Makes the run list fail.
  down?: boolean;
  // A run's events: fixed, or by how many times they have been asked for (to play a run live).
  events?: Record<string, RunEvent[]> | ((runId: string, call: number) => RunEvent[]);
  payees?: Payee[];
  // The server's answer to a person's decision.
  decide?: (runId: string, body: { decision: string }) => { status: number; body: unknown };
}

// Answers the calls the app makes, from the given data.
export function mockServer(server: FakeServer = {}) {
  const calls = new Map<string, number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const run = path.match(/^\/events\/runs\/([^/]+)(\/payees|\/decision)?$/);
    if (run && !server.down) {
      const runId = decodeURIComponent(run[1] as string);
      if (run[2] === "/payees") return json(server.payees ?? []);
      if (run[2] === "/decision") {
        const answer = server.decide?.(runId, JSON.parse(String(init?.body ?? "{}")));
        return answer
          ? json(answer.body, answer.status)
          : json({ error: "decisions_unavailable", message: "No payment platform." }, 503);
      }
      const call = (calls.get(runId) ?? 0) + 1;
      calls.set(runId, call);
      const events = server.events;
      return json(typeof events === "function" ? events(runId, call) : (events?.[runId] ?? []));
    }
    if (server.down) return new Response("down", { status: 503 });
    if (path === "/events/runs") return json(server.runs ?? []);
    if (path === "/arena/scenarios") return json(server.scenarios ?? []);
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Shows where the router is, so a test can check what a page wrote into the URL.
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

export function renderApp(path = "/runs") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

export const run = (
  runId: string,
  scenarioId: string | null,
  startedAt: string,
  outcome: Partial<
    Pick<
      RunSummary,
      "verdict" | "decidedBy" | "reviewFailed" | "reviews" | "kind" | "attackerPaid" | "seed"
    >
  > = {},
): RunSummary => ({
  runId,
  scenarioId,
  startedAt,
  lastEventAt: startedAt,
  eventCount: 10,
  costUsd: 0,
  verdict: null,
  decidedBy: null,
  reviewFailed: false,
  seed: "1",
  reviews: [],
  kind: null,
  attackerPaid: false,
  ...outcome,
});
