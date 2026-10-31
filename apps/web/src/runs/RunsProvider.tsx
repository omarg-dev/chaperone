import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchRuns, fetchScenarios, type RunSummary } from "../api";
import { isHeldForPerson } from "./state";

export interface RunsState {
  status: "loading" | "ready" | "error";
  // Every run, newest first.
  runs: RunSummary[];
  scenarioTitles: Record<string, string>;
  // Runs whose escalation is waiting for a person to decide it.
  heldForPerson: number;
  reload: () => void;
  // Read the list again without a loading state: what a page that keeps itself current calls. A
  // failure leaves the list as it was.
  refresh: () => void;
}

const RunsContext = createContext<RunsState | null>(null);

export function RunsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RunsState["status"]>("loading");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  const generation = useRef(0);

  const load = useCallback((quiet = false) => {
    const mine = ++generation.current;
    if (!quiet) setStatus("loading");
    Promise.all([
      fetchRuns(),
      // Titles are a nicety: the list still works with ids alone.
      fetchScenarios().catch(() => []),
    ]).then(
      ([all, scenarios]) => {
        if (generation.current !== mine) return;
        setRuns(all);
        setScenarioTitles(Object.fromEntries(scenarios.map((s) => [s.scenarioId, s.title])));
        setStatus("ready");
      },
      () => {
        if (generation.current !== mine) return;
        // A quiet read that fails leaves a list that was showing as it was, but a first read that
        // was superseded must not leave the page loading for ever.
        setStatus((now) => (quiet && now !== "loading" ? now : "error"));
      },
    );
  }, []);

  const reload = useCallback(() => load(), [load]);
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);

  const value = useMemo<RunsState>(
    () => ({
      status,
      runs,
      scenarioTitles,
      heldForPerson: runs.filter(isHeldForPerson).length,
      reload,
      refresh,
    }),
    [status, runs, scenarioTitles, reload, refresh],
  );
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

export function useRuns(): RunsState {
  const state = useContext(RunsContext);
  if (!state) throw new Error("useRuns needs a RunsProvider above it");
  return state;
}
