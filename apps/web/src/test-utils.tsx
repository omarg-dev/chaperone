import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { App } from "./App";
import type { RunSummary, ScenarioInfo } from "./api";
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
}

// Answers the two calls the app makes, from the given data.
export function mockServer(server: FakeServer = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (server.down) return new Response("down", { status: 503 });
    if (path === "/events/runs") return json(server.runs ?? []);
    if (path === "/arena/scenarios") return json(server.scenarios ?? []);
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderApp(path = "/runs") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

export const run = (
  runId: string,
  scenarioId: string,
  startedAt: string,
  outcome: Partial<Pick<RunSummary, "verdict" | "decidedBy" | "reviewFailed">> = {},
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
  ...outcome,
});
