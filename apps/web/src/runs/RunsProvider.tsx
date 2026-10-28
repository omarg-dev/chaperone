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
import { fetchRunEvents, fetchRuns, fetchScenarios, type RunSummary } from "../api";
import { isOpenEscalation, outcomeOf, type RunOutcome } from "./outcome";

// The server's run list doesn't carry a verdict, so each listed run's events are read once to find
// it. That's one request per run, so only the newest runs are looked up and listed. A verdict on
// the list endpoint would replace this.
export const RUN_LIMIT = 100;
const CONCURRENCY = 6;

export interface RunsState {
  status: "loading" | "ready" | "error";
  // The newest runs first, at most RUN_LIMIT of them.
  runs: RunSummary[];
  // How many runs the server has, which can be more than the list shows.
  total: number;
  scenarioTitles: Record<string, string>;
  // A run's outcome once its events have been read; absent while they are being read.
  outcomes: Record<string, RunOutcome>;
  openEscalations: number;
  reload: () => void;
}

const RunsContext = createContext<RunsState | null>(null);

export function RunsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RunsState["status"]>("loading");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [scenarioTitles, setScenarioTitles] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, RunOutcome>>({});
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    const current = () => generation.current === mine;
    setStatus("loading");

    (async () => {
      const [all, scenarios] = await Promise.all([
        fetchRuns(),
        // Titles are a nicety: the list still works with ids alone.
        fetchScenarios().catch(() => []),
      ]);
      if (!current()) return;
      const shown = all.slice(0, RUN_LIMIT);
      setRuns(shown);
      setTotal(all.length);
      setScenarioTitles(Object.fromEntries(scenarios.map((s) => [s.scenarioId, s.title])));
      setOutcomes({});
      setStatus("ready");

      const queue = [...shown];
      const worker = async () => {
        for (let run = queue.shift(); run; run = queue.shift()) {
          const outcome = await fetchRunEvents(run.runId)
            .then(outcomeOf)
            .catch((): RunOutcome => ({ kind: "none" }));
          if (!current()) return;
          setOutcomes((previous) => ({ ...previous, [run.runId]: outcome }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    })().catch(() => {
      if (current()) setStatus("error");
    });
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
      total,
      scenarioTitles,
      outcomes,
      openEscalations: Object.values(outcomes).filter(isOpenEscalation).length,
      reload: load,
    }),
    [status, runs, total, scenarioTitles, outcomes, load],
  );
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

export function useRuns(): RunsState {
  const state = useContext(RunsContext);
  if (!state) throw new Error("useRuns needs a RunsProvider above it");
  return state;
}
