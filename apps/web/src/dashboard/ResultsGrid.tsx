import type { ResultsView } from "@firewall/eval/view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Pill, Toggle } from "../design";
import { type CellProps, DataGrid, ENTERPRISE, type GridColumn } from "../grid";
import { CellDetailPanel } from "./CellDetail";
import { type CellDetail, cellOf, detailOf } from "./detail";
import {
  CONFIG_INFO,
  CONFIG_ORDER,
  type Config,
  filterRows,
  type GridRow,
  gotThrough,
  groupFigure,
  groupOf,
  isRowFiltered,
  NO_ROW_FILTERS,
  OUTCOME_FILTERS,
  type OutcomeCell,
  type OutcomeFilter,
  outcomeRank,
  type RowFilters,
  runLink,
  tallyGroup,
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

const Chevron = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M5.5 3.5 10.5 8l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

// A group row opens and closes, and AG tells a cell renderer nothing about that, so it is listened to.
function useExpanded(node: CellProps<GridRow>["node"]) {
  const [expanded, setExpanded] = useState(node.expanded);
  useEffect(() => {
    const update = () => setExpanded(node.expanded);
    node.addEventListener("expandedChanged", update);
    return () => node.removeEventListener("expandedChanged", update);
  }, [node]);
  return expanded;
}

// What a group row says in the scenario column: the attack, how many runs it has, and the control
// that opens them.
function GroupCell({ node, value }: CellProps<GridRow>) {
  const expanded = useExpanded(node);
  const runs = node.allChildrenCount ?? 0;
  return (
    <div className="cell-open">
      <button
        type="button"
        className="row-toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} the runs of ${value}`}
        onClick={() => node.setExpanded(!expanded)}
      >
        <Chevron />
      </button>
      <div className="cell-stack">
        <span className="cell-title">{String(value)}</span>
        <span className="t-data">{runs === 1 ? "1 run" : `${runs} runs`}</span>
      </div>
    </div>
  );
}

// The scenario, and the control that opens the cell under each setting. It is a real button, so the
// open state is said to assistive technology; a click on it reaches the row, which toggles, so it has
// no handler of its own.
function ScenarioCell(props: CellProps<GridRow> & { openId: string | null }) {
  const { data, openId } = props;
  if (props.node.group) return <GroupCell {...props} />;
  return (
    data && (
      <div className="cell-open">
        <button
          type="button"
          className="row-toggle"
          aria-expanded={openId === data.id}
          aria-label={`Show ${data.title}, seed ${data.seed}, under each setting`}
        >
          <Chevron />
        </button>
        <div className="cell-stack">
          <span className="cell-title" title={data.title}>
            {data.title}
          </span>
          <span className="t-data">{data.scenarioId}</span>
        </div>
      </div>
    )
  );
}

const KindCell = ({ data }: CellProps<GridRow>) =>
  data && (
    <div className="cell-stack">
      <span>{data.kind === "attack" ? "Attack" : "Benign"}</span>
      {data.attack && <span className="t-meta">{data.attack}</span>}
    </div>
  );

// A group row's figure under one setting: how many of its attack runs got through. Red only when
// money reached an attacker, like everywhere else.
function GroupFigure({ node, config }: CellProps<GridRow> & { config: Config }) {
  const rows = (node.allLeafChildren ?? []).flatMap((leaf) => (leaf.data ? [leaf.data] : []));
  const tally = tallyGroup(rows, config);
  if (tally.attacks === 0) return <span className="t-meta">{groupFigure(tally)}</span>;
  return (
    <span className={`group-figure${tally.paidAttacker > 0 ? " group-figure-attacker" : ""}`}>
      <strong>{tally.succeeded}</strong> <span>of {tally.attacks} got through</span>
    </span>
  );
}

function OutcomeColumnCell(props: CellProps<GridRow> & { config: Config }) {
  if (props.node.group) return <GroupFigure {...props} />;
  return props.data && <OutcomeView cell={props.data.outcomes[props.config]} />;
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

function columnsFor(
  known: ReadonlySet<string>,
  withCause: boolean,
  openId: string | null,
  grouped: boolean,
): GridColumn<GridRow>[] {
  return [
    // The attack a run carried, which the table is grouped by. It is a column of its own, hidden, so
    // the group's key is the attack and not something a header shows twice.
    ...(grouped
      ? [
          {
            colId: "attack",
            headerName: "Attack",
            rowGroup: true,
            hide: true,
            valueGetter: ({ data }: { data?: GridRow }) => (data ? groupOf(data) : ""),
          } satisfies GridColumn<GridRow>,
        ]
      : []),
    {
      headerName: "Scenario",
      field: "title",
      // The group rows are drawn in this column, so the attack's name and its control sit where the
      // scenarios' do.
      ...(grouped ? { showRowGroup: "attack" } : {}),
      // The scenario stays in view while the settings' columns scroll past it.
      pinned: "left",
      lockPinned: true,
      width: 330,
      cellRenderer: ScenarioCell,
      cellRendererParams: { openId },
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
    { headerName: "Agent", field: "agent", flex: 1.2, minWidth: 110 },
    ...CONFIG_ORDER.map(
      (config): GridColumn<GridRow> => ({
        headerName: CONFIG_INFO[config].name,
        colId: config,
        // One for a run whose attack got through under this setting, which a group row adds up and a
        // chart reads. It sorts worst first, so an ascending sort puts the attacks that got through
        // at the top: a run by what its money did, a group by how many got through.
        valueGetter: ({ data }) => (data ? gotThrough(data, config) : 0),
        aggFunc: grouped ? "sum" : undefined,
        comparator: (a: number, b: number, nodeA, nodeB) =>
          nodeA.data && nodeB.data
            ? outcomeRank(nodeA.data.outcomes[config]) - outcomeRank(nodeB.data.outcomes[config])
            : b - a,
        flex: 1.6,
        minWidth: 170,
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
      minWidth: 170,
      cellRenderer: RunCell,
      cellRendererParams: { known },
    },
  ];
}

// Tall enough for the heading, the gates, the verdict, cost and time, and a line for each note.
const detailHeight = (detail: CellDetail) => 384 + detail.notes.length * 34;

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
  results,
  rows,
  knownRunIds,
}: {
  results: ResultsView;
  rows: readonly GridRow[];
  knownRunIds: ReadonlySet<string>;
}) {
  const [filters, setFilters] = useState<RowFilters>(NO_ROW_FILTERS);
  // Whether the runs are drawn under their attack, which is a way to read the table and not a filter.
  const [grouped, setGrouped] = useState(false);
  // The row whose cell is open under each setting: one at a time, and a click on it again closes it.
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const columns = useMemo(
    () =>
      columnsFor(
        knownRunIds,
        rows.some((r) => r.cause !== null),
        openId,
        grouped,
      ),
    [knownRunIds, rows, openId, grouped],
  );
  const toggle = useCallback(
    (row: GridRow) => setOpenId((now) => (now === row.id ? null : row.id)),
    [],
  );
  const heightOf = useCallback(
    (row: GridRow) => {
      const cell = cellOf(results, row.id);
      return cell ? detailHeight(detailOf(cell, row)) : 0;
    },
    [results],
  );
  const renderDetail = useCallback(
    (row: GridRow) => {
      const cell = cellOf(results, row.id);
      return (
        cell && <CellDetailPanel detail={detailOf(cell, row)} onClose={() => setOpenId(null)} />
      );
    },
    [results],
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
        {ENTERPRISE && (
          <div className="filter-clear">
            <Toggle
              checked={grouped}
              onChange={setGrouped}
              hint="One row for each attack, with how many of its runs got through under each setting. Open a row for its runs."
            >
              Group by attack
            </Toggle>
          </div>
        )}
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
        activateOnClick
        onRowActivate={toggle}
        detail={{ openId, height: heightOf, render: renderDetail }}
      />
    </div>
  );
}
