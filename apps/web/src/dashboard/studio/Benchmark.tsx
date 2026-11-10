import type { ResultsSummary, ResultsView } from "@firewall/eval/view";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ApiError, fetchResults, fetchStudioConfig, type StudioConfig } from "../../api";
import { EmptyState } from "../../design";
import { useRuns } from "../../runs/RunsProvider";
import {
  type BenchmarkRow,
  benchmarkRows,
  leftOutNote,
  selectBenchmarkFiles,
  sourceLine,
} from "./benchmark";

// AG Studio is most of a megabyte of script, so it is a chunk of its own, loaded when this view is
// first opened: the dashboard's other view, and every other page, never pay for it.
const loadCanvas = () => import("./StudioCanvas");
const StudioCanvas = lazy(loadCanvas);

// What the test files load before they open this view.
export const loadStudioChunk = loadCanvas;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; files: ResultsView[]; config: StudioConfig };

const OFF_CONFIG: StudioConfig = {
  licenseKey: null,
  ai: {
    available: false,
    reason: "The assistant is off: the server didn't say whether it is on.",
    budget: { capUsd: 0, spentUsd: 0, remainingUsd: 0, resetsAt: "" },
  },
};

// The whole benchmark in AG Studio: every sandbox results file the server has (the newest of each
// model on each scenario set), read and flattened into one table, with the report it opens on and,
// when the server has a model key and budget left, Studio's assistant.
export function Benchmark({ list }: { list: readonly ResultsSummary[] }) {
  const selection = useMemo(() => selectBenchmarkFiles(list), [list]);
  const { scenarioTitles } = useRuns();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    Promise.all([
      Promise.all(selection.files.map((file) => fetchResults(file.name))),
      // Studio still draws without its config: the watermark shows and the assistant is off.
      fetchStudioConfig().catch(() => OFF_CONFIG),
    ]).then(
      ([files, config]) => current && setState({ status: "ready", files, config }),
      (error) =>
        current &&
        setState({
          status: "error",
          message: error instanceof ApiError ? error.message : "The server didn't answer.",
        }),
    );
    return () => {
      current = false;
    };
  }, [selection]);

  // The scenarios' titles arrive with the run list, maybe after the files: the rows are made again
  // then, without reading the files again.
  const rows = useMemo<BenchmarkRow[]>(
    () =>
      state.status === "ready"
        ? state.files.flatMap((results, i) =>
            benchmarkRows(selection.files[i]?.name ?? "", results, scenarioTitles),
          )
        : [],
    [state, selection, scenarioTitles],
  );

  if (selection.files.length === 0) {
    return (
      <EmptyState title="No sandbox results to explore yet.">
        Studio reads the eval's sandbox results only. {leftOutNote(selection)}
      </EmptyState>
    );
  }

  const note = leftOutNote(selection);
  return (
    <div className="benchmark">
      <div className="benchmark-sources" role="note" aria-label="Where these numbers come from">
        <p className="t-meta">
          {selection.files.length} results files, one row per cell and firewall setting:
        </p>
        <ul className="benchmark-files">
          {selection.files.map((file) => (
            <li key={file.name} className="t-meta">
              {sourceLine(file)}
            </li>
          ))}
        </ul>
        {note && <p className="t-meta">{note}</p>}
      </div>
      {state.status === "loading" && (
        <p className="t-meta" role="status">
          Loading the benchmark…
        </p>
      )}
      {state.status === "error" && (
        <EmptyState title="The benchmark couldn't be read.">{state.message}</EmptyState>
      )}
      {state.status === "ready" && (
        <Suspense
          fallback={
            <p className="t-meta" role="status">
              Loading Studio…
            </p>
          }
        >
          <StudioCanvas rows={rows} config={state.config} />
        </Suspense>
      )}
    </div>
  );
}
