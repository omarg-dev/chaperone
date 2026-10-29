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
}

const RunsContext = createContext<RunsState | null>(null);

export function RunsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RunsState["status"]>("loading");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setStatus("loading");
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
        if (generation.current === mine) setStatus("error");
      },
    );
  }, []);

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
      reload: load,
    }),
    [status, runs, scenarioTitles, load],
  );
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

export function useRuns(): RunsState {
  const state = useContext(RunsContext);
  if (!state) throw new Error("useRuns needs a RunsProvider above it");
  return state;
}
