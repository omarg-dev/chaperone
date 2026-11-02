import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { RunSummary } from "../api";
import { Button, buttonClass, EmptyState, Pill } from "../design";
import { formatTime } from "../format";
import { type CellProps, DataGrid, type GridColumn, type GridSort } from "../grid";
import {
  applyFilters,
  type Filters,
  filtersToParams,
  isFiltered,
  type Kind,
  NO_FILTERS,
  parseFilters,
} from "../runs/filters";
import { useRuns } from "../runs/RunsProvider";
import {
  compareRuns,
  DEFAULT_SORT,
  SORT_COLUMNS,
  type SortColumn,
  scenarioName,
} from "../runs/sort";
import {
  CONFIG_LABELS,
  CONFIGS,
  configLabel,
  configOf,
  noVerdictText,
  OUTCOME_LABELS,
  OUTCOMES,
  paymentsLabel,
  pillStateOf,
} from "../runs/state";
import { PageHeader } from "./Page";

function Verdict({ run }: { run: RunSummary }) {
  const state = pillStateOf(run);
  if (!state) return <span className="t-meta">{noVerdictText(run)}</span>;
  return (
    <span className="verdict-cell">
      <Pill state={state} />
      {run.escalation === "unfinished" ? (
        <span className="t-meta">Decision not finished</span>
      ) : (
        run.decidedBy === "person" && <span className="t-meta">You decided</span>
      )}
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

const RunCell = ({ data, titles }: CellProps<RunSummary> & { titles: Record<string, string> }) => {
  if (!data) return null;
  const title = data.scenarioId ? titles[data.scenarioId] : undefined;
  return (
    <div className="cell-stack">
      <span className="run-title">
        <Link to={`/runs/${data.runId}`} className="run-link" title={scenarioName(data, titles)}>
          {title ?? data.scenarioId ?? "No scenario"}
        </Link>
        {data.kind === "attack" && <span className="badge">Attack</span>}
        {data.payments && (
          <span className="run-money-kind t-meta">{paymentsLabel(data.payments)}</span>
        )}
      </span>
      <span className="t-data">
        {title && data.scenarioId ? `${data.scenarioId} · ` : ""}
        {data.runId}
      </span>
    </div>
  );
};

const StartedCell = ({ data }: CellProps<RunSummary>) =>
  data && (
    <time className="run-time t-meta" dateTime={data.startedAt}>
      {formatTime(data.startedAt)}
    </time>
  );

const FirewallCell = ({ data }: CellProps<RunSummary>) => data && <Firewall run={data} />;
const VerdictCell = ({ data }: CellProps<RunSummary>) => data && <Verdict run={data} />;

// The grid sorts with the same comparison the tests pin (`compareRuns`): each column hands AG the
// run itself, and AG hands the pair back to it.
const sortBy =
  (column: SortColumn, titles: Record<string, string>) => (a: RunSummary, b: RunSummary) =>
    compareRuns(a, b, column, titles);

function columnsFor(titles: Record<string, string>): GridColumn<RunSummary>[] {
  const column = (column: SortColumn): GridColumn<RunSummary> => ({
    colId: column,
    valueGetter: ({ data }) => data,
    comparator: sortBy(column, titles),
    sortingOrder: ["asc", "desc"],
  });
  return [
    {
      ...column("scenario"),
      headerName: "Scenario",
      // The scenario stays in view when the other columns scroll past it.
      pinned: "left",
      lockPinned: true,
      width: 430,
      minWidth: 260,
      cellRenderer: RunCell,
      cellRendererParams: { titles },
    },
    {
      ...column("started"),
      headerName: "Started",
      width: 180,
      minWidth: 150,
      // Newest first is where a click on it starts.
      sortingOrder: ["desc", "asc"],
      cellRenderer: StartedCell,
    },
    {
      ...column("firewall"),
      headerName: "Firewall",
      flex: 1,
      minWidth: 150,
      cellRenderer: FirewallCell,
    },
    {
      ...column("verdict"),
      headerName: "Verdict",
      flex: 1.5,
      minWidth: 270,
      cellRenderer: VerdictCell,
    },
  ];
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
  const update = useCallback(
    (patch: Partial<Filters>) =>
      setParams(filtersToParams({ ...filters, ...patch }), { replace: true }),
    [filters, setParams],
  );

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

  const matching = useMemo(
    () => applyFilters(runs, filters, scenarioTitles),
    [runs, filters, scenarioTitles],
  );
  const filtered = isFiltered(filters);
  const columns = useMemo(() => columnsFor(scenarioTitles), [scenarioTitles]);

  // The sort lives in the address like the filters do. The grid shows it and reports a click on a
  // header; the address is what it is kept in.
  const sort = useMemo<GridSort>(
    () => ({ colId: filters.sort.column, direction: filters.sort.direction }),
    [filters.sort],
  );
  const sortChanged = useCallback(
    (next: GridSort | null) => {
      const column = SORT_COLUMNS.find((candidate) => candidate === next?.colId);
      update({ sort: next && column ? { column, direction: next.direction } : DEFAULT_SORT });
    },
    [update],
  );
  const navigate = useNavigate();
  const openRun = useCallback((run: RunSummary) => navigate(`/runs/${run.runId}`), [navigate]);

  const refresh = (
    <Button variant="secondary" small onClick={reload} disabled={status === "loading"}>
      Refresh
    </Button>
  );
  const clear = (
    // The sort is how the runs are ordered, not which are shown, so clearing the filters keeps it.
    <Button
      variant="secondary"
      small
      onClick={() =>
        setParams(filtersToParams({ ...NO_FILTERS, sort: filters.sort }), { replace: true })
      }
    >
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
        <EmptyState
          title="No runs yet."
          action={
            <Link to="/start" className={buttonClass("primary")}>
              Start a run
            </Link>
          }
        >
          When a shopping agent tries a purchase, it shows up here with its scenario, when it
          started and what Chaperone decided. You can start one yourself.
        </EmptyState>
      )}

      {runs.length > 0 && (
        <>
          <search className="filters" aria-label="Filter runs">
            <label className="filter filter-search">
              <span className="filter-label">Search</span>
              <input
                className="filter-control"
                type="search"
                value={text}
                placeholder="Run ID or scenario"
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
                ? `Showing ${matching.length} of ${runs.length} runs`
                : `${runs.length} runs`}
          </p>
        </>
      )}

      {runs.length > 0 && matching.length === 0 && (
        <EmptyState title="No runs match these filters." action={clear}>
          Loosen a filter, or clear them all to see every run.
        </EmptyState>
      )}

      {matching.length > 0 && (
        <DataGrid
          layout="scroll"
          label="Runs"
          rows={matching}
          columns={columns}
          rowId={(run) => run.runId}
          emptyText="No runs match."
          sort={sort}
          onSortChange={sortChanged}
          onRowActivate={openRun}
        />
      )}
    </>
  );
}

function parseOutcome(value: string): Filters["outcome"] {
  return OUTCOMES.find((o) => o === value) ?? NO_FILTERS.outcome;
}
