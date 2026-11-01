import type { ResultsView } from "@firewall/eval/view";
import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { vi } from "vitest";
import { App } from "./App";
import type { ResultsList, RunSummary, ScenarioInfo } from "./api";
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
  // The eval's results: the list, and each file by name. Unset, the server has no results folder.
  results?: {
    list: ResultsList;
    files?: Record<string, ResultsView | { error: number; message: string }>;
  };
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
    if (path === "/eval/results") {
      return json(server.results?.list ?? { available: false, results: [], unreadable: [] });
    }
    const file = path.match(/^\/eval\/results\/([^/]+)$/);
    if (file) {
      const found = server.results?.files?.[decodeURIComponent(file[1] as string)];
      if (!found) return json({ error: "not_found", message: "No such results" }, 404);
      if ("error" in found) {
        return json({ error: "invalid_results", message: found.message }, found.error);
      }
      return json({ name: file[1], results: found });
    }
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
      | "verdict"
      | "decidedBy"
      | "reviewFailed"
      | "holdOpen"
      | "escalation"
      | "reviews"
      | "kind"
      | "attackerPaid"
      | "seed"
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
  holdOpen: false,
  escalation: null,
  seed: "1",
  reviews: [],
  kind: null,
  attackerPaid: false,
  ...outcome,
});

// The states an escalated run can be in, as the run list summarises them (`escalationOf`).
export const escalated = {
  waiting: { verdict: "escalate", decidedBy: "review", holdOpen: true, escalation: "waiting" },
  released: { verdict: "escalate", decidedBy: "review", holdOpen: false, escalation: "released" },
  // A person decided but the platform hasn't moved the money: the decision reads as the verdict.
  unfinished: (verdict: "approve" | "block") =>
    ({ verdict, decidedBy: "person", holdOpen: true, escalation: "unfinished" }) as const,
  decided: (verdict: "approve" | "block") =>
    ({ verdict, decidedBy: "person", holdOpen: false, escalation: "decided" }) as const,
} as const;

// The dashboard loads on demand, and its first load in a test file pulls in the data grid, which
// can take longer than a test waits when many files run at once. Calling this in a `beforeAll`
// makes that load happen before any test starts the clock.
export const loadDashboard = () => import("./dashboard/Dashboard");
