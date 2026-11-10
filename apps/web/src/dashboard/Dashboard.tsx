import type { ResultsSummary } from "@firewall/eval/view";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Button, EmptyState, Page, Section } from "../design";
import { formatDate } from "../format";
import { useRuns } from "../runs/RunsProvider";
import { Comparison } from "./Comparison";
import { LiveStrip } from "./LiveStrip";
import { Provenance } from "./Provenance";
import { ResultsGrid } from "./ResultsGrid";
import { gridRows, headlineOf } from "./results";
import { Benchmark } from "./studio/Benchmark";
import { useResultsFile, useResultsList } from "./useResults";

// The picker's text: when it ran and what produced it, so an older result can't be mistaken for the
// newest, or a fake one for a sandbox one.
export const optionLabel = (r: ResultsSummary) =>
  `${formatDate(r.date)} · ${r.paymentAdapter} · ${r.column.label} · seeds ${r.seeds.join(", ")}`;

function NoResults({
  available,
  unreadable,
}: {
  available: boolean;
  unreadable: { name: string; reason: string }[];
}) {
  return (
    <>
      {available ? (
        <EmptyState title="No eval results yet.">
          The results folder is empty. Running the eval (pnpm --filter @firewall/eval run-matrix)
          writes a results file there, and it appears here with its numbers.
        </EmptyState>
      ) : (
        <EmptyState title="This server has no results folder.">
          The eval's results are files, and the server reads them from the folder named by
          RESULTS_DIR. That folder isn't here, so there is nothing to show.
        </EmptyState>
      )}
      <Unreadable files={unreadable} />
    </>
  );
}

function Unreadable({ files }: { files: { name: string; reason: string }[] }) {
  if (files.length === 0) return null;
  return (
    <p className="t-meta unreadable" role="note">
      {files.length === 1 ? "One file" : `${files.length} files`} in the results folder couldn't be
      read: {files.map((f) => `${f.name} (${f.reason.replace(/\.$/, "")})`).join("; ")}.
    </p>
  );
}

function Results({ name, knownRunIds }: { name: string; knownRunIds: ReadonlySet<string> }) {
  const file = useResultsFile(name);
  const { scenarioTitles } = useRuns();
  const results = file.status === "ready" ? file.value : null;
  const rows = useMemo(
    () => (results ? gridRows(results, scenarioTitles) : []),
    [results, scenarioTitles],
  );
  if (file.status === "loading") {
    return (
      <p className="t-meta" role="status">
        Loading the results…
      </p>
    );
  }
  if (file.status === "error" || !results) {
    return (
      <EmptyState title="That result couldn't be read.">
        {file.status === "error" ? file.message : ""}
      </EmptyState>
    );
  }
  return (
    <>
      <Provenance results={results} />
      <h2 className="cmp-headline">{headlineOf(results)}</h2>
      <Comparison results={results} />
      <Section heading="Every run" className="grid-section">
        <p className="t-meta grid-sub">What each firewall setting did to the money, run by run.</p>
        <ResultsGrid results={results} rows={rows} knownRunIds={knownRunIds} />
      </Section>
    </>
  );
}

// /dashboard: how Chaperone is doing. The eval's newest results (or an older one, picked), then this
// server's own runs.
export function Dashboard() {
  const { state, reload } = useResultsList();
  const { runs } = useRuns();
  const [params, setParams] = useSearchParams();
  const knownRunIds = useMemo(() => new Set(runs.map((r) => r.runId)), [runs]);

  const list = state.status === "ready" ? state.value : null;
  // Two views of the eval: one results file as the harness counted it, or every sandbox file at
  // once in AG Studio (`?view=studio`), each kept in the address so a view can be shared.
  const view = params.get("view") === "studio" ? "studio" : "file";
  const setView = (next: "studio" | "file") => {
    const copy = new URLSearchParams(params);
    if (next === "studio") copy.set("view", "studio");
    else copy.delete("view");
    setParams(copy, { replace: true });
  };
  const asked = params.get("result");
  // The address names the result, so a view can be shared; a name the server doesn't list is the
  // newest instead of an error.
  const selected = list?.results.find((r) => r.name === asked) ?? list?.results[0] ?? null;

  const picker =
    list && list.results.length > 1 ? (
      <label className="filter filter-result">
        <span className="filter-label">Result</span>
        <select
          className="filter-control"
          value={selected?.name ?? ""}
          onChange={(e) =>
            setParams(e.target.value === list.results[0]?.name ? {} : { result: e.target.value }, {
              replace: true,
            })
          }
        >
          {list.results.map((r, i) => (
            <option key={r.name} value={r.name}>
              {i === 0 ? "Newest: " : ""}
              {optionLabel(r)}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <Page
      title="How it's doing"
      lede="How often agents are fooled with Chaperone off and on, from the eval, and what this server has seen."
      aside={
        <Button variant="secondary" small onClick={reload} disabled={state.status === "loading"}>
          Refresh
        </Button>
      }
    >
      <LiveStrip />

      <Section heading="The eval" className="eval">
        <div className="tabs eval-views" role="tablist" aria-label="How to read the eval">
          <button
            type="button"
            role="tab"
            id="tab-file"
            aria-selected={view === "file"}
            aria-controls="panel-eval"
            className="tab"
            onClick={() => setView("file")}
          >
            One result
          </button>
          <button
            type="button"
            role="tab"
            id="tab-studio"
            aria-selected={view === "studio"}
            aria-controls="panel-eval"
            className="tab"
            onClick={() => setView("studio")}
          >
            Every result in AG Studio
          </button>
        </div>
        {view === "file" && picker}
        {state.status === "loading" && (
          <p className="t-meta" role="status">
            Loading the results…
          </p>
        )}
        {state.status === "error" && (
          <EmptyState
            title="The eval results couldn't be read."
            action={
              <Button variant="secondary" small onClick={reload}>
                Try again
              </Button>
            }
          >
            {state.message}
          </EmptyState>
        )}
        {list && !selected && <NoResults available={list.available} unreadable={list.unreadable} />}
        {list && selected && view === "file" && (
          <div role="tabpanel" id="panel-eval" aria-labelledby="tab-file">
            <Results key={selected.name} name={selected.name} knownRunIds={knownRunIds} />
            <Unreadable files={list.unreadable} />
          </div>
        )}
        {list && selected && view === "studio" && (
          <div role="tabpanel" id="panel-eval" aria-labelledby="tab-studio">
            <Benchmark list={list.results} />
            <Unreadable files={list.unreadable} />
          </div>
        )}
      </Section>
    </Page>
  );
}
