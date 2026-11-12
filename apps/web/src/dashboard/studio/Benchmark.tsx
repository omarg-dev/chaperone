import type { ResultsSummary, ResultsView } from "@firewall/eval/view";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ApiError, fetchResults, fetchStudioConfig, type StudioConfig } from "../../api";
import { Button, EmptyState } from "../../design";
import { formatPercent } from "../../format";
import { type Proof, proofOf } from "../../landing/proof";
import { useRuns } from "../../runs/RunsProvider";
import { useNarrow } from "../../shell/useNarrow";
import { SETTING_WORDS } from "../../words/plain";
import {
  type BenchmarkRow,
  benchmarkRows,
  leftOutNote,
  scenarioSetOf,
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
  // On a phone the explorer is too cramped to use, so the page shows the headline figures and
  // offers it anyway.
  const narrow = useNarrow();
  const [wantsExplorer, setWantsExplorer] = useState(false);
  const explorer = !narrow || wantsExplorer;

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
      <details className="benchmark-sources">
        <summary className="t-meta">The {selection.files.length} results files this reads</summary>
        <ul className="benchmark-files">
          {selection.files.map((file) => (
            <li key={file.name} className="t-meta">
              {sourceLine(file)}
            </li>
          ))}
        </ul>
        {note && <p className="t-meta">{note}</p>}
      </details>
      {state.status === "loading" && (
        <p className="t-meta" role="status">
          Loading the benchmark…
        </p>
      )}
      {state.status === "error" && (
        <EmptyState title="The benchmark couldn't be read.">{state.message}</EmptyState>
      )}
      {state.status === "ready" && !explorer && (
        <Headlines files={state.files} onOpen={() => setWantsExplorer(true)} />
      )}
      {state.status === "ready" && explorer && (
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

// The benchmark on a phone: for each model and set, how often an attack got through with Chaperone
// off and with the full check, as the files counted it, and the explorer behind a button.
function Headlines({ files, onOpen }: { files: ResultsView[]; onOpen: () => void }) {
  const lines = files.flatMap((results) => {
    const proof = proofOf(results);
    return proof ? [{ proof, set: scenarioSetOf(results.meta), key: results.meta.startedAt }] : [];
  });
  const rate = (side: Proof["off"]) => formatPercent(side.attackSuccessRate);
  return (
    <div className="benchmark-phone">
      <p className="t-meta">
        The full explorer needs a wider screen. Here is the headline: how often an attack got
        through.
      </p>
      <table className="headline-table">
        <thead>
          <tr>
            <th scope="col">Agent and tasks</th>
            <th scope="col">{SETTING_WORDS.off}</th>
            <th scope="col">{SETTING_WORDS.full}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ proof, set, key }) => (
            <tr key={key}>
              <th scope="row">
                {proof.label}
                <span className="t-meta">
                  {set === "Held-out" ? "Held-out attacks" : "Our own tasks"}
                </span>
              </th>
              <td>{rate(proof.off)}</td>
              <td>{rate(proof.full)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <Button variant="secondary" small onClick={onOpen}>
          Open the explorer anyway
        </Button>
      </div>
    </div>
  );
}
