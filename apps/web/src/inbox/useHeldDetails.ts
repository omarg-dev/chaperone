import { useEffect, useRef, useState } from "react";
import { fetchRunEvents, type RunSummary } from "../api";
import { buildRun, type RunModel } from "../run/timeline";

export type Detail =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; model: RunModel };

// What each held run's events say, read through the run view's own mapping (`buildRun`) so the inbox
// can't disagree with the run page. A run is read once, and again only when its log has grown (the
// summary's event count moved); one that failed to load is tried again on the next read of the list.
export function useHeldDetails(runs: readonly RunSummary[]): Record<string, Detail> {
  const [details, setDetails] = useState<Record<string, Detail>>({});
  // The event count each run was last asked for at.
  const asked = useRef(new Map<string, number>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const run of runs) {
      if (asked.current.get(run.runId) === run.eventCount) continue;
      asked.current.set(run.runId, run.eventCount);
      fetchRunEvents(run.runId).then(
        (events) => {
          if (!mounted.current) return;
          // A run asked for again at a higher count may have answered out of order: keep the newer.
          if (asked.current.get(run.runId) !== run.eventCount) return;
          setDetails((now) => ({
            ...now,
            [run.runId]: { status: "ready", model: buildRun(events) },
          }));
        },
        () => {
          if (!mounted.current) return;
          asked.current.delete(run.runId);
          // A run already shown stays as it was; only one never read says it couldn't be.
          setDetails((now) =>
            now[run.runId]?.status === "ready" ? now : { ...now, [run.runId]: { status: "error" } },
          );
        },
      );
    }
  }, [runs]);

  return details;
}
