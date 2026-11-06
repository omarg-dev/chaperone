import {
  type CellKeyDownEvent,
  ClientSideRowModelModule,
  type ColDef,
  ColumnApiModule,
  type GridOptions,
  type ICellRendererParams,
  type IRowNode,
  ModuleRegistry,
  RowApiModule,
  type RowClickedEvent,
  RowStyleModule,
  ScrollApiModule,
  type SortChangedEvent,
  ValidationModule,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { gridTheme } from "./theme";

// AG Grid Community, behind one small component. The pages know rows, columns and a label; they
// don't import AG. There is no AG license (decided Nov 1, docs/PLAN.md), so this uses only what the
// free packages include, and the day a license arrives the licensed grid, its modules and its theme
// are swapped in here and in theme.ts, and nothing else moves.
//
// Every page that has a grid shares this file, so the grid is one chunk the Runs page and the
// dashboard both load. Only the modules the grids use are registered, which keeps that chunk to the
// client-side row model and the few features below: a feature a page wants that isn't in this list
// is registered here, deliberately, and nothing licensed ever is (AG's own module list for the
// community package has no master/detail, row grouping, pivoting, server-side row model, integrated
// charts or Excel export; `ag-grid-enterprise` isn't a dependency).
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  // `getColumnState`, which says which column is sorted.
  ColumnApiModule,
  // `getRowClass`, which marks the row whose detail is open.
  RowStyleModule,
  // `getRowNode` and `ensureNodeVisible`, which find an opened detail and bring it into view.
  RowApiModule,
  ScrollApiModule,
  // AG's development checks (it names a module a page needs and didn't register). Left out of the
  // production build, which is why the grid chunk doesn't carry it.
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);

// A column, as the pages describe it. Today it is AG's own column definition, which is the point of
// the alias: a page says `GridColumn` and never `ColDef`.
export type GridColumn<Row> = ColDef<Row>;
export type CellProps<Row, Value = unknown> = ICellRendererParams<Row, Value>;

// Which column is sorted, and which way. `null` is no sort.
export interface GridSort {
  colId: string;
  direction: "asc" | "desc";
}

// A row the grid is asked to show open under another: the same data as the row it belongs to, marked.
// It is a full-width row (a community feature: one component across the grid instead of cells), and
// it takes the place master/detail would, which is enterprise-only.
type Marked<Row> = Row & { __detailOf?: string };

const DETAIL_SUFFIX = "::detail";

export interface DataGridProps<Row> {
  rows: readonly Row[];
  columns: GridColumn<Row>[];
  // What the table is, for assistive technology.
  label: string;
  rowId: (row: Row) => string;
  // Said in place of the table when no row passes the filters.
  emptyText: string;
  // "auto" draws every row and lets the page scroll, for a table of a few dozen rows. "scroll" fits
  // the table to the window and draws only the rows in view as they scroll: for a history that can
  // have thousands.
  layout?: "auto" | "scroll";
  // The sort, when the page keeps it somewhere else (the address). Omitted, the grid keeps its own.
  sort?: GridSort | null;
  onSortChange?: (sort: GridSort | null) => void;
  // A row was chosen: by Enter or Space on it, and by a click when `activateOnClick` is set. A click
  // on a link or button inside the row is the link's or button's own.
  onRowActivate?: (row: Row, how: "click" | "key") => void;
  activateOnClick?: boolean;
  // Opens the row with this ID, showing `render(row)` full width under it. One row at a time.
  detail?: {
    openId: string | null;
    // Tall enough for what `render` draws, which can depend on the row.
    height: number | ((row: Row) => number);
    render: (row: Row) => ReactNode;
  };
}

interface GridContext<Row> {
  renderDetail: (row: Row) => ReactNode;
}

// The component AG draws across the grid for a detail row.
function DetailRow<Row>({
  data,
  context,
}: ICellRendererParams<Marked<Row>, unknown, GridContext<Row>>) {
  return data ? <div className="grid-detail">{context.renderDetail(data)}</div> : null;
}

const isInteractive = (target: EventTarget | null) =>
  target instanceof Element && target.closest("a, button, input, select, textarea") !== null;

export function DataGrid<Row>({
  rows,
  columns,
  label,
  rowId,
  emptyText,
  layout = "auto",
  sort,
  onSortChange,
  onRowActivate,
  activateOnClick = false,
  detail,
}: DataGridProps<Row>) {
  const openId = detail?.openId ?? null;
  const grid = useRef<AgGridReact<Marked<Row>>>(null);

  // A detail opened near the bottom of the table is scrolled into view, no further than it needs.
  useEffect(() => {
    if (openId === null) return;
    const timer = setTimeout(() => {
      const api = grid.current?.api;
      const node = api?.getRowNode(`${openId}${DETAIL_SUFFIX}`);
      if (api && node) api.ensureNodeVisible(node);
    }, 0);
    return () => clearTimeout(timer);
  }, [openId]);

  const data = useMemo<Marked<Row>[]>(() => {
    const shown = [...rows] as Marked<Row>[];
    if (openId === null) return shown;
    const at = shown.findIndex((row) => rowId(row) === openId);
    // A row that was filtered away takes its detail with it.
    if (at >= 0) shown.splice(at + 1, 0, { ...(shown[at] as Marked<Row>), __detailOf: openId });
    return shown;
  }, [rows, openId, rowId]);

  // The sort, when the page owns it: each column says whether it is the sorted one.
  const columnDefs = useMemo(
    () =>
      (sort === undefined
        ? columns
        : columns.map((column) => ({
            ...column,
            sort: sort !== null && column.colId === sort.colId ? sort.direction : null,
          }))) as ColDef<Marked<Row>>[],
    [columns, sort],
  );

  const sortChanged = useCallback(
    ({ api }: SortChangedEvent<Marked<Row>>) => {
      const sorted = api.getColumnState().find((state) => state.sort);
      const next: GridSort | null = sorted?.sort
        ? { colId: sorted.colId, direction: sorted.sort }
        : null;
      // A sort the page just set comes back as an event too; only a different one is a change.
      if (next?.colId !== sort?.colId || next?.direction !== sort?.direction) onSortChange?.(next);
    },
    [sort, onSortChange],
  );

  const activate = useCallback(
    (row: Marked<Row> | undefined, how: "click" | "key") => {
      if (row && row.__detailOf === undefined) onRowActivate?.(row, how);
    },
    [onRowActivate],
  );

  const options: GridOptions<Marked<Row>> = {
    isFullWidthRow: ({ rowNode }) => rowNode.data?.__detailOf !== undefined,
    fullWidthCellRenderer: DetailRow,
    getRowHeight: ({ data: row }) => {
      if (row?.__detailOf === undefined || !detail) return undefined;
      return typeof detail.height === "number" ? detail.height : detail.height(row);
    },
    // The open row's detail sits directly under it whichever way the table is sorted: the detail is a
    // copy of its row, so it sorts beside it, and this puts it right after.
    postSortRows: ({ nodes }) => {
      const at = nodes.findIndex((node) => node.data?.__detailOf !== undefined);
      const detailNode = nodes[at];
      const parentId = detailNode?.data?.__detailOf;
      if (!detailNode || parentId === undefined) return;
      nodes.splice(at, 1);
      const parent = nodes.findIndex((node: IRowNode<Marked<Row>>) => node.id === parentId);
      nodes.splice(parent + 1, 0, detailNode);
    },
    getRowClass: ({ data: row }) => {
      if (row?.__detailOf !== undefined) return "is-detail";
      return row && openId !== null && rowId(row) === openId ? "is-open" : undefined;
    },
  };

  if (rows.length === 0) return <p className="data-grid-empty">{emptyText}</p>;
  return (
    <section className={`data-grid data-grid-${layout}`} aria-label={label}>
      <AgGridReact<Marked<Row>>
        ref={grid}
        theme={gridTheme}
        rowData={data}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={({ data: row }) =>
          row.__detailOf === undefined ? rowId(row) : `${row.__detailOf}${DETAIL_SUFFIX}`
        }
        context={{ renderDetail: detail?.render } as unknown as GridContext<Row>}
        // "auto" draws the whole table, so the page scrolls as a page and a keyboard user isn't caught
        // in a second scroll area; "scroll" is the grid's own scroll area, drawn as it moves.
        domLayout={layout === "auto" ? "autoHeight" : "normal"}
        suppressColumnVirtualisation
        // The rows are in the page in the order they are on screen, which is the order a screen reader
        // and the Tab key walk them in.
        ensureDomOrder
        // Tab leaves the grid after the cell in focus, instead of walking every cell of a long table.
        tabToNextCell={() => false}
        onSortChanged={sortChanged}
        onRowClicked={(event: RowClickedEvent<Marked<Row>>) => {
          if (activateOnClick && !isInteractive(event.event?.target ?? null)) {
            activate(event.data, "click");
          }
        }}
        onCellKeyDown={(event: CellKeyDownEvent<Marked<Row>>) => {
          const key = event.event as KeyboardEvent | null;
          if (!key || (key.key !== "Enter" && key.key !== " ") || isInteractive(key.target)) return;
          key.preventDefault();
          activate(event.data, "key");
        }}
        {...options}
      />
    </section>
  );
}
