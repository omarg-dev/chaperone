import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { RunSummary } from "../api";
import {
  Amount,
  Button,
  buttonClass,
  EmptyState,
  MoneyGlyph,
  type MoneyState,
  PageRoute,
  Pill,
  Station,
  Vault,
} from "../design";
import { formatTime } from "../format";
import {
  type CellProps,
  DataGrid,
  type GridColumn,
  type GridSort,
  type HeaderProps,
} from "../grid";
import {
  applyFilters,
  type Filters,
  filtersToParams,
  isFiltered,
  type Kind,
  NO_FILTERS,
  outcomeCounts,
  parseFilters,
} from "../runs/filters";
import { heldRightNow, type MoneyPlace, placeOf } from "../runs/money";
import { useRuns } from "../runs/RunsProvider";
import {
  compareRuns,
  DEFAULT_SORT,
  isDefaultSort,
  SORT_COLUMNS,
  type SortColumn,
  scenarioName,
} from "../runs/sort";
import {
  CONFIG_LABELS,
  CONFIGS,
  configLabel,
  configOf,
  MONEY_OF_OUTCOME,
  OUTCOME_CHIP_ORDER,
  OUTCOME_LABELS,
  outcomeNote,
  outcomeOf,
  paymentsLabel,
} from "../runs/state";

// The outcome as a glyph and a word. Money that reached an attacker is the one filled pill.
function Outcome({ run }: { run: RunSummary }) {
  const outcome = outcomeOf(run);
  if (outcome === "attacker_paid") {
    return (
      <span className="outcome-cell" data-outcome={outcome}>
        <Pill state="attacker" />
      </span>
    );
  }
  const note = outcomeNote(run);
  return (
    <span className="outcome-cell" data-outcome={outcome}>
      <MoneyGlyph state={MONEY_OF_OUTCOME[outcome]} size={24} />
      <span>
        {OUTCOME_LABELS[outcome]}
        {note && <span className="outcome-cell-sub">{note}</span>}
      </span>
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
      </span>
      <span className="run-title">
        {title && data.scenarioId && <span className="t-data">{data.scenarioId}</span>}
        {data.kind === "attack" && <span className="badge">Attack</span>}
        {data.payments && (
          <span className="run-money-kind t-meta">{paymentsLabel(data.payments)}</span>
        )}
      </span>
    </div>
  );
};

const RunIdCell = ({ data }: CellProps<RunSummary>) =>
  data && (
    <Link to={`/runs/${data.runId}`} className="run-id-link" tabIndex={-1}>
      {data.runId}
    </Link>
  );

const StartedCell = ({ data }: CellProps<RunSummary>) =>
  data && (
    <time className="run-time" dateTime={data.startedAt}>
      {formatTime(data.startedAt)}
    </time>
  );

const FirewallCell = ({ data }: CellProps<RunSummary>) => data && <Firewall run={data} />;
const OutcomeCell = ({ data }: CellProps<RunSummary>) => data && <Outcome run={data} />;

// A money column writes the run's amount if its money is in this column, and nothing otherwise.
const MoneyCell = ({ data, place }: CellProps<RunSummary> & { place: MoneyPlace }) => {
  const placed = data ? placeOf(data) : null;
  if (!placed || placed.place !== place) return null;
  return (
    <span className="money-cell">
      <Amount cents={placed.cents} tone={placed.tone} />
      <span className={`money-cell-note money-cell-note-${placed.noteTone}`}>{placed.note}</span>
    </span>
  );
};

const MONEY_HEADS: Record<MoneyPlace, { name: string; glyph: MoneyState }> = {
  held: { name: "Held", glyph: "held" },
  moved: { name: "Moved", glyph: "captured" },
  voided: { name: "Voided", glyph: "voided" },
};

const MoneyHead = ({ place }: HeaderProps<{ place: MoneyPlace }>) => (
  <span className="money-head">
    <MoneyGlyph state={MONEY_HEADS[place].glyph} size={18} />
    {MONEY_HEADS[place].name}
  </span>
);

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
  const money = (place: MoneyPlace, width: number): GridColumn<RunSummary> => ({
    colId: place,
    headerName: MONEY_HEADS[place].name,
    headerComponent: MoneyHead,
    headerComponentParams: { place },
    // Where the money is isn't a sort of its own: the outcome and the time are.
    sortable: false,
    width,
    minWidth: width,
    cellRenderer: MoneyCell,
    cellRendererParams: { place },
    // The three money columns are ruled off from the rest and from each other.
    cellClass: "col-money",
    headerClass: "col-money",
  });
  return [
    {
      ...column("verdict"),
      headerName: "Outcome",
      pinned: "left",
      lockPinned: true,
      width: 188,
      minWidth: 180,
      cellRenderer: OutcomeCell,
    },
    {
      ...column("scenario"),
      headerName: "Scenario",
      // The scenario stays in view when the other columns scroll past it.
      pinned: "left",
      lockPinned: true,
      width: 208,
      minWidth: 190,
      cellRenderer: RunCell,
      cellRendererParams: { titles },
    },
    {
      ...column("firewall"),
      headerName: "Firewall",
      flex: 1,
      minWidth: 112,
      cellRenderer: FirewallCell,
    },
    money("held", 120),
    money("moved", 168),
    money("voided", 108),
    {
      ...column("started"),
      headerName: "Started",
      width: 164,
      minWidth: 150,
      // Newest first is where a click on it starts.
      sortingOrder: ["desc", "asc"],
      cellRenderer: StartedCell,
    },
    {
      colId: "run",
      headerName: "Run",
      sortable: false,
      width: 184,
      minWidth: 184,
      cellRenderer: RunIdCell,
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

  const counts = useMemo(
    () => outcomeCounts(runs, filters, scenarioTitles),
    [runs, filters, scenarioTitles],
  );
  const held = useMemo(() => heldRightNow(runs), [runs]);
  const countText =
    matching.length === 0
      ? "No runs match."
      : filtered
        ? `Showing ${matching.length} of ${runs.length} runs`
        : `${runs.length} runs`;

  return (
    <PageRoute
      title="Runs"
      lede="Every purchase an agent has tried, newest first. Each amount sits in the column that says where the money is."
      aside={refresh}
    >
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
          <Vault label="Held right now" className="held-vault">
            <div className="held-vault-amount">
              <span className="t-meta held-vault-label">Held right now</span>
              <Amount cents={held.cents} size="xl" />
            </div>
            <div className="held-vault-says">
              {held.waiting > 0 ? (
                <>
                  <Link to="/escalations">
                    {held.waiting} {held.waiting === 1 ? "run" : "runs"} waiting on you
                  </Link>
                  <span className="t-meta">
                    {held.oldestWaitingAt && `Oldest since ${formatTime(held.oldestWaitingAt)}. `}
                    Nothing is charged until you decide.
                  </span>
                </>
              ) : (
                <span className="t-meta">
                  {held.holds > 0
                    ? "No run is waiting on you."
                    : "Nothing is held, and nothing is waiting on you."}
                </span>
              )}
            </div>
          </Vault>

          <Station heading="Where the money went" className="runs-filters">
            <OutcomeChips
              value={filters.outcome}
              counts={counts}
              onChange={(outcome) => update({ outcome })}
            />
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
          </Station>

          <Station
            heading={
              <>
                <span role="status">{countText}</span>
                {matching.length > 0 && isDefaultSort(filters.sort) && ", newest first"}
              </>
            }
            className="runs-grid"
          >
            {matching.length === 0 ? (
              <div className="runs-none">
                <h3 className="t-item">No runs match these filters.</h3>
                <p>Loosen a filter, or clear them all to see every run.</p>
                <div>{clear}</div>
              </div>
            ) : (
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
          </Station>
        </>
      )}
    </PageRoute>
  );
}

// The outcomes as a radio group of chips, each with its glyph and how many runs choosing it would
// show. Real radio buttons, so the arrow keys, Tab leaving the group and the screen reader's
// announcement come for free; "All" is chosen when no outcome is.
function OutcomeChips({
  value,
  counts,
  onChange,
}: {
  value: Filters["outcome"];
  counts: ReturnType<typeof outcomeCounts>;
  onChange: (outcome: Filters["outcome"]) => void;
}) {
  // A chip for an outcome no run has is left out, unless it is the one chosen.
  const shown = OUTCOME_CHIP_ORDER.filter((o) => counts.byOutcome[o] > 0 || o === value);
  const choices: Filters["outcome"][] = [null, ...shown];
  return (
    <fieldset className="outcome-chips">
      <legend className="visually-hidden">Outcome</legend>
      {choices.map((outcome) => (
        <label key={outcome ?? "all"} className="outcome-chip">
          <input
            type="radio"
            name="outcome"
            className="visually-hidden"
            checked={outcome === value}
            onChange={() => onChange(outcome)}
          />
          {outcome && <MoneyGlyph state={MONEY_OF_OUTCOME[outcome]} size={22} />}
          <span>{outcome ? OUTCOME_LABELS[outcome] : "All"}</span>{" "}
          <span className="outcome-chip-count">
            {outcome ? counts.byOutcome[outcome] : counts.all}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
