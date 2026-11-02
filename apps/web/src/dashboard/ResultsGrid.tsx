import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Pill } from "../design";
import { type CellProps, DataGrid, type GridColumn } from "../grid";
import {
  CONFIG_INFO,
  CONFIG_ORDER,
  type Config,
  filterRows,
  type GridRow,
  isRowFiltered,
  NO_ROW_FILTERS,
  OUTCOME_FILTERS,
  type OutcomeCell,
  type OutcomeFilter,
  outcomeRank,
  type RowFilters,
  runLink,
} from "./results";

// What a firewall setting did to one run's money. Only money that reached an attacker is red; a
// block is neutral, and a held cart is the person's (amber).
function OutcomeView({ cell }: { cell: OutcomeCell }) {
  switch (cell.state) {
    case "attacker":
      return <Pill state="attacker" label={cell.label} />;
    case "seller":
      return <Pill state="approve" label={cell.label} />;
    case "blocked":
      return <Pill state="block" label={cell.label} />;
    case "held":
      return <Pill state="escalate" label={cell.label} />;
    case "harmed":
      // An attack that succeeded without paying an attacker: not red, since red says money reached
      // one, but not quiet either.
      return <strong className="outcome-plain">{cell.label}</strong>;
    default:
      return <span className="t-meta">{cell.label}</span>;
  }
}

const ScenarioCell = ({ data }: CellProps<GridRow>) =>
  data && (
    <div className="cell-stack">
      <span className="cell-title" title={data.title}>
        {data.title}
      </span>
      <span className="t-data">{data.scenarioId}</span>
    </div>
  );

const KindCell = ({ data }: CellProps<GridRow>) =>
  data && (
    <div className="cell-stack">
      <span>{data.kind === "attack" ? "Attack" : "Benign"}</span>
      {data.attack && <span className="t-meta">{data.attack}</span>}
    </div>
  );

function OutcomeColumnCell({ data, config }: CellProps<GridRow> & { config: Config }) {
  return data && <OutcomeView cell={data.outcomes[config]} />;
}

function RunCell({ data, known }: CellProps<GridRow> & { known: ReadonlySet<string> }) {
  if (!data?.runId) return <span className="t-meta">No run</span>;
  const to = runLink(data, known);
  // The eval's runs live in the results' own event log. This server's run view can only open one it
  // also holds, so a run it doesn't hold is named, not linked to an empty page.
  return to ? (
    <Link to={to} className="run-link t-data">
      Open run
    </Link>
  ) : (
    <span className="t-meta" title={data.runId}>
      Not on this server
    </span>
  );
}

function columnsFor(known: ReadonlySet<string>, withCause: boolean): GridColumn<GridRow>[] {
  return [
    {
      headerName: "Scenario",
      field: "title",
      flex: 3,
      minWidth: 240,
      cellRenderer: ScenarioCell,
    },
    { headerName: "Seed", field: "seed", width: 90, comparator: (a, b) => Number(a) - Number(b) },
    {
      headerName: "Kind",
      colId: "kind",
      valueGetter: ({ data }) => (data ? `${data.kind} ${data.attack ?? ""}` : ""),
      flex: 1.3,
      minWidth: 130,
      cellRenderer: KindCell,
    },
    { headerName: "Agent", field: "agent", flex: 1.2, minWidth: 120 },
    ...CONFIG_ORDER.map(
      (config): GridColumn<GridRow> => ({
        headerName: CONFIG_INFO[config].name,
        colId: config,
        // Sorted worst first, so an ascending sort puts the attacks that got through at the top.
        valueGetter: ({ data }) => (data ? outcomeRank(data.outcomes[config]) : 0),
        flex: 1.6,
        minWidth: 190,
        cellRenderer: OutcomeColumnCell,
        cellRendererParams: { config },
      }),
    ),
    ...(withCause
      ? [{ headerName: "Cause", field: "cause" as const, flex: 2, minWidth: 200 }]
      : []),
    {
      headerName: "Run",
      colId: "run",
      sortable: false,
      flex: 1.2,
      minWidth: 140,
      cellRenderer: RunCell,
      cellRendererParams: { known },
    },
  ];
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  any,
  disabled,
}: {
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  options: readonly { value: T; label: string }[];
  any: string;
  disabled?: boolean;
}) {
  return (
    <label className="filter">
      <span className="filter-label">{label}</span>
      <select
        className="filter-control"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
      >
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Every run of the matrix, one row each, with what each firewall setting did to its money. It is
// filtered by scenario kind, by setting and outcome ("what did Gate 0 only let through?") and by a
// search, and sorted by any column.
export function ResultsGrid({
  rows,
  knownRunIds,
}: {
  rows: readonly GridRow[];
  knownRunIds: ReadonlySet<string>;
}) {
  const [filters, setFilters] = useState<RowFilters>(NO_ROW_FILTERS);
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const columns = useMemo(
    () =>
      columnsFor(
        knownRunIds,
        rows.some((r) => r.cause !== null),
      ),
    [knownRunIds, rows],
  );
  const set = (patch: Partial<RowFilters>) => setFilters((now) => ({ ...now, ...patch }));

  return (
    <div className="results-grid">
      <div className="filters">
        <label className="filter filter-search">
          <span className="filter-label">Search</span>
          <input
            className="filter-control"
            type="search"
            placeholder="Scenario or attack"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </label>
        <Select
          label="Kind"
          value={filters.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: "attack", label: "Attacks" },
            { value: "benign", label: "Benign" },
          ]}
          any="All runs"
        />
        <Select<OutcomeFilter>
          label="Ended as"
          value={filters.outcome}
          onChange={(outcome) => set(outcome ? { outcome } : { outcome, config: null })}
          options={OUTCOME_FILTERS}
          any="Anything"
        />
        <Select<Config>
          label="Under"
          value={filters.config}
          onChange={(config) => set({ config })}
          options={CONFIG_ORDER.map((c) => ({ value: c, label: CONFIG_INFO[c].name }))}
          any="Any setting"
          disabled={filters.outcome === null}
        />
        {isRowFiltered(filters) && (
          <div className="filter-clear">
            <Button variant="secondary" small onClick={() => setFilters(NO_ROW_FILTERS)}>
              Clear filters
            </Button>
          </div>
        )}
      </div>
      <p className="t-meta run-count" role="status">
        {shown.length === rows.length
          ? `${rows.length} runs`
          : `${shown.length} of ${rows.length} runs`}
      </p>
      <DataGrid
        rows={shown}
        columns={columns}
        label="Every run in this matrix"
        rowId={(row) => row.id}
        emptyText="No run matches these filters."
      />
    </div>
  );
}
