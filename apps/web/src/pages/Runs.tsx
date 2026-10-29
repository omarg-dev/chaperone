import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { RunSummary } from "../api";
import { Button, EmptyState, Pill } from "../design";
import { formatTime } from "../format";
import {
  applyFilters,
  type Filters,
  filtersToParams,
  isFiltered,
  type Kind,
  NO_FILTERS,
  paginate,
  parseFilters,
} from "../runs/filters";
import { useRuns } from "../runs/RunsProvider";
import {
  CONFIG_LABELS,
  CONFIGS,
  configLabel,
  configOf,
  noVerdictText,
  OUTCOME_LABELS,
  OUTCOMES,
  pillStateOf,
} from "../runs/state";
import { PageHeader } from "./Page";

function Verdict({ run }: { run: RunSummary }) {
  const state = pillStateOf(run);
  if (!state) return <span className="t-meta">{noVerdictText(run)}</span>;
  return (
    <span className="verdict-cell">
      <Pill state={state} />
      {run.decidedBy === "person" && <span className="t-meta">You decided</span>}
    </span>
  );
}

// The firewall setting the run's outcome comes from. A run reviewed under several (an eval cell is
// reviewed under off, gate0 and full) says which came first, small, beside the last.
function Firewall({ run }: { run: RunSummary }) {
  const last = configOf(run);
  if (!last) {
    return (
      <span className="run-config t-meta">
        <span aria-hidden="true">None</span>
        <span className="visually-hidden">Not reviewed</span>
      </span>
    );
  }
  const earlier = run.reviews.slice(0, -1);
  return (
    <span className="run-config">
      <span className="run-config-name">{configLabel(last)}</span>
      {earlier.length > 0 && (
        <span
          className="t-meta"
          title={`Reviewed under ${run.reviews.map(configLabel).join(", ")}`}
        >
          after {earlier.map(configLabel).join(", ")}
        </span>
      )}
    </span>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="filter">
      <span className="filter-label">{label}</span>
      <select className="filter-control" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function Runs() {
  const { status, runs, scenarioTitles, reload } = useRuns();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  // The URL is the filters' home, so a filtered view can be shared; replacing keeps the back button
  // for leaving the page rather than for undoing each filter.
  const update = (patch: Partial<Filters>) =>
    setParams(filtersToParams({ ...filters, page: 1, ...patch }), { replace: true });

  // The search box is typed into at its own pace, and writes the URL once the typing pauses.
  const [text, setText] = useState(filters.query);
  useEffect(() => setText(filters.query), [filters.query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `update` is rebuilt every render from `filters`, which this effect already depends on.
  useEffect(() => {
    if (text.trim() === filters.query) return;
    const timer = setTimeout(() => update({ query: text.trim() }), 250);
    return () => clearTimeout(timer);
  }, [text, filters.query]);

  const scenarios = useMemo(() => {
    const ids = new Set(runs.flatMap((r) => (r.scenarioId ? [r.scenarioId] : [])));
    if (filters.scenario) ids.add(filters.scenario);
    return [...ids]
      .map((id) => ({ id, label: scenarioTitles[id] ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [runs, scenarioTitles, filters.scenario]);

  const matching = useMemo(() => applyFilters(runs, filters), [runs, filters]);
  const shown = paginate(matching, filters.page);
  const filtered = isFiltered(filters);

  const refresh = (
    <Button variant="secondary" small onClick={reload} disabled={status === "loading"}>
      Refresh
    </Button>
  );
  const clear = (
    <Button variant="secondary" small onClick={() => setParams({}, { replace: true })}>
      Clear filters
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
          <search className="filters" aria-label="Filter runs">
            <label className="filter filter-search">
              <span className="filter-label">Run ID</span>
              <input
                className="filter-control"
                type="search"
                value={text}
                placeholder="Search by run ID"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <Select
              label="Outcome"
              value={filters.outcome ?? ""}
              onChange={(value) => update({ outcome: parseOutcome(value) })}
            >
              <option value="">Any outcome</option>
              {OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {OUTCOME_LABELS[outcome]}
                </option>
              ))}
            </Select>
            <Select
              label="Firewall"
              value={filters.config ?? ""}
              onChange={(value) => update({ config: value || null })}
            >
              <option value="">Any setting</option>
              {CONFIGS.map((config) => (
                <option key={config} value={config}>
                  {CONFIG_LABELS[config]}
                </option>
              ))}
            </Select>
            <Select
              label="Scenario"
              value={filters.scenario ?? ""}
              onChange={(value) => update({ scenario: value || null })}
            >
              <option value="">Any scenario</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label}
                </option>
              ))}
            </Select>
            <Select
              label="Kind"
              value={filters.kind ?? ""}
              onChange={(value) => update({ kind: value === "" ? null : (value as Kind) })}
            >
              <option value="">Attack or benign</option>
              <option value="attack">Attack</option>
              <option value="benign">Benign</option>
            </Select>
            {filtered && <div className="filter-clear">{clear}</div>}
          </search>

          <p className="run-count t-meta" role="status">
            {matching.length === 0
              ? "No runs match."
              : filtered
                ? `Showing ${shown.from}–${shown.to} of ${matching.length} matching runs, out of ${runs.length}`
                : `Showing ${shown.from}–${shown.to} of ${runs.length} runs`}
          </p>
        </>
      )}

      {runs.length > 0 && matching.length === 0 && (
        <EmptyState title="No runs match these filters." action={clear}>
          Loosen a filter, or clear them all to see every run.
        </EmptyState>
      )}

      {shown.items.length > 0 && (
        <ul className="run-list" aria-label="Runs">
          <li className="run-row run-head" aria-hidden="true">
            <span>Scenario</span>
            <span>Started</span>
            <span>Firewall</span>
            <span>Verdict</span>
          </li>
          {shown.items.map((run) => {
            const title = run.scenarioId ? scenarioTitles[run.scenarioId] : undefined;
            return (
              <li key={run.runId} className="run-row">
                <div className="run-scenario">
                  <span className="run-title">
                    <Link to={`/runs/${run.runId}`} className="run-link t-item">
                      {title ?? run.scenarioId ?? "No scenario"}
                    </Link>
                    {run.kind === "attack" && <span className="badge">Attack</span>}
                  </span>
                  <span className="t-data">
                    {title && run.scenarioId ? `${run.scenarioId} · ` : ""}
                    {run.runId}
                  </span>
                </div>
                <time className="run-time t-meta" dateTime={run.startedAt}>
                  {formatTime(run.startedAt)}
                </time>
                <Firewall run={run} />
                <Verdict run={run} />
              </li>
            );
          })}
        </ul>
      )}

      {shown.pages > 1 && (
        <nav className="pager" aria-label="Pages of runs">
          <Button
            variant="secondary"
            small
            disabled={shown.page <= 1}
            onClick={() => update({ page: shown.page - 1 })}
          >
            Previous
          </Button>
          <span className="t-meta">
            Page {shown.page} of {shown.pages}
          </span>
          <Button
            variant="secondary"
            small
            disabled={shown.page >= shown.pages}
            onClick={() => update({ page: shown.page + 1 })}
          >
            Next
          </Button>
        </nav>
      )}
    </>
  );
}

function parseOutcome(value: string): Filters["outcome"] {
  return OUTCOMES.find((o) => o === value) ?? NO_FILTERS.outcome;
}
