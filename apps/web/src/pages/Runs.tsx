import { Link } from "react-router";
import { Button, EmptyState, Pill } from "../design";
import { formatTime } from "../format";
import { pillStateOf, type RunOutcome } from "../runs/outcome";
import { RUN_LIMIT, useRuns } from "../runs/RunsProvider";
import { PageHeader } from "./Page";

function Verdict({ outcome }: { outcome: RunOutcome | undefined }) {
  if (!outcome) return <span className="t-meta">Reading…</span>;
  const state = pillStateOf(outcome);
  if (state) {
    const byPerson = outcome.kind === "verdict" && outcome.decidedByPerson;
    return (
      <span className="verdict-cell">
        <Pill state={state} />
        {byPerson && <span className="t-meta">You decided</span>}
      </span>
    );
  }
  return (
    <span className="t-meta">{outcome.kind === "off" ? "Firewall off" : "No review yet"}</span>
  );
}

export function Runs() {
  const { status, runs, total, scenarioTitles, outcomes, reload } = useRuns();
  const refresh = (
    <Button variant="secondary" small onClick={reload} disabled={status === "loading"}>
      Refresh
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Runs"
        lede="Every purchase an agent has tried, newest first, and how Chaperone ruled on it."
        aside={refresh}
      />

      {status === "loading" && runs.length === 0 && (
        <p className="t-meta" role="status">
          Loading runs…
        </p>
      )}

      {status === "error" && (
        <EmptyState title="Runs didn't load." action={refresh}>
          The server didn't answer. Check that it's running, then try again.
        </EmptyState>
      )}

      {status === "ready" && runs.length === 0 && (
        <EmptyState title="No runs yet.">
          When a shopping agent tries a purchase, it shows up here with its scenario, when it
          started and what Chaperone decided.
        </EmptyState>
      )}

      {runs.length > 0 && (
        <>
          <ul className="run-list" aria-label="Runs">
            <li className="run-row run-head" aria-hidden="true">
              <span>Scenario</span>
              <span title="Riyadh time, UTC+3">Started</span>
              <span>Verdict</span>
            </li>
            {runs.map((run) => {
              const title = run.scenarioId ? scenarioTitles[run.scenarioId] : undefined;
              return (
                <li key={run.runId} className="run-row">
                  <div className="run-scenario">
                    <Link to={`/runs/${run.runId}`} className="run-link t-item">
                      {title ?? run.scenarioId ?? "No scenario"}
                    </Link>
                    <span className="t-data">
                      {title && run.scenarioId ? `${run.scenarioId} · ` : ""}
                      {run.runId}
                    </span>
                  </div>
                  <time className="run-time t-meta" dateTime={run.startedAt}>
                    {formatTime(run.startedAt)}
                  </time>
                  <Verdict outcome={outcomes[run.runId]} />
                </li>
              );
            })}
          </ul>
          {total > RUN_LIMIT && (
            <p className="t-meta run-note">
              Showing the newest {RUN_LIMIT} of {total} runs.
            </p>
          )}
        </>
      )}
    </>
  );
}
