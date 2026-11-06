import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPayees, fetchRunEvents } from "../api";
import type { Payee, RunEvent } from "./events";
import { buildRun, type RunModel } from "./timeline";

// How often a run in progress is read again. No websockets: the log is small and the server's
// reads are cheap.
export const POLL_MS = 1500;

export interface RunState {
  status: "loading" | "ready" | "missing" | "error";
  model: RunModel;
  // The run's events as the server sent them, and who its payees are: what a replay draws prefixes of.
  events: RunEvent[];
  payees: Payee[];
  // Read the run again now (after a person decided it).
  reload: () => void;
}

const EMPTY: RunEvent[] = [];

// A run's events, kept current while it is in progress: it polls until the model says the run
// can't change without someone acting (its money is settled, a gate broke, or a person has to
// decide), and stops when the page is left.
export function useRun(runId: string): RunState {
  const [events, setEvents] = useState<RunEvent[]>(EMPTY);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [status, setStatus] = useState<RunState["status"]>("loading");
  const [round, setRound] = useState(0);
  const payeesLoaded = useRef(false);

  const reload = useCallback(() => setRound((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` is how reload() restarts the loop.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    payeesLoaded.current = false;

    const read = async () => {
      try {
        const next = await fetchRunEvents(runId);
        if (cancelled) return;
        setEvents(next);
        setStatus(next.length === 0 ? "missing" : "ready");
        if (next.length === 0) return;
        // Who the payees are is fixed once the run has started; asked for until it is known.
        if (!payeesLoaded.current) {
          fetchPayees(runId).then(
            (found) => {
              if (cancelled) return;
              payeesLoaded.current = true;
              setPayees(found);
            },
            () => {},
          );
        }
        if (buildRun(next).live) timer = setTimeout(read, POLL_MS);
      } catch {
        if (cancelled) return;
        setStatus("error");
      }
    };
    setStatus((current) => (current === "ready" ? current : "loading"));
    read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, round]);

  const model = useMemo(() => buildRun(events, payees), [events, payees]);
  return { status, model, events, payees, reload };
}
