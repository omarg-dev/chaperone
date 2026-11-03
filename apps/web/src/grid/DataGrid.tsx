import {
  type CellKeyDownEvent,
  CellStyleModule,
  ClientSideRowModelModule,
  type ColDef,
  ColumnApiModule,
  type GridApi,
  type GridOptions,
  type ICellRendererParams,
  type IHeaderParams,
  type IRowNode,
  ModuleRegistry,
  RowApiModule,
  type RowClickedEvent,
  type RowDataUpdatedEvent,
  RowStyleModule,
  ScrollApiModule,
  type SortChangedEvent,
  ValidationModule,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { ENTERPRISE } from "./flag";
import { gridTheme } from "./theme";

// AG Grid, behind one small component. The pages know rows, columns and a label; they don't import
// AG. This file imports only `ag-grid-community`: the Enterprise features (master/detail, row
// grouping, the status bar, Excel export, integrated charts) are options of the same grid, switched
// on by the modules `enterprise.ts` and `charts.ts` register, which `index.tsx` loads only when
// `flag.ts` says Enterprise is on (the hackathon allowance, no license key). With the flag off the
// props below that need them are ignored.
//
// Every page that has a grid shares this file, so the grid is one chunk the Runs page and the
// dashboard both load. Only the modules the grids use are registered, which keeps that chunk to the
// client-side row model and the few features below.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  // `getColumnState`, which says which column is sorted.
  ColumnApiModule,
  // `getRowClass`, which marks the row whose detail is open.
  RowStyleModule,
  // `cellClass`, which rules off a column.
  CellStyleModule,
  // `getRowNode`, `forEachNode` and `getDisplayedRowAtIndex`, which find the row whose detail is open.
  RowApiModule,
  // `ensureIndexVisible`, which brings an opened detail into view.
  ScrollApiModule,
  // AG's development checks (it names a module a page needs and didn't register). Left out of the
  // production build, which is why the grid chunk doesn't carry it.
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);

// A column, as the pages describe it. Today it is AG's own column definition, which is the point of
// the alias: a page says `GridColumn` and never `ColDef`.
export type GridColumn<Row> = ColDef<Row>;
export type CellProps<Row, Value = unknown> = ICellRendererParams<Row, Value>;
// What a custom header gets: the column's name, and whatever the column definition passed it.
export type HeaderProps<Params = object> = IHeaderParams & Params;

// Which column is sorted, and which way. `null` is no sort.
export interface GridSort {
  colId: string;
  direction: "asc" | "desc";
}

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
  // Opens the row with this ID, showing `render(row)` full width under it (AG's master/detail, an
  // Enterprise feature: with `ENTERPRISE` off a row has no detail). One row at a time.
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

// The component AG draws across the grid for a detail row. A detail row's data is its master's.
function DetailRow<Row>({ data, context }: ICellRendererParams<Row, unknown, GridContext<Row>>) {
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
  const openId = ENTERPRISE ? (detail?.openId ?? null) : null;
  const grid = useRef<AgGridReact<Row>>(null);

  // The row whose ID the page says is open is the one expanded, and no other: the page owns which.
  // It is applied again when the rows change, since a row that was filtered away comes back closed.
  const syncOpen = useCallback((api: GridApi<Row>) => {
    api.forEachNode((node) => {
      if (node.master) node.setExpanded(node.id === openRef.current);
    });
  }, []);
  const openRef = useRef(openId);
  openRef.current = openId;
  useEffect(() => {
    const api = grid.current?.api;
    if (!api) return;
    syncOpen(api);
    if (openId === null) return;
    // A detail opened near the bottom of the table is scrolled into view, no further than it needs.
    const timer = setTimeout(() => {
      if (api.isDestroyed()) return;
      // The detail is the row right after its master.
      const at = api.getRowNode(openId)?.rowIndex;
      if (at != null) api.ensureIndexVisible(at + 1);
    }, 0);
    return () => clearTimeout(timer);
  }, [openId, syncOpen]);

  // The sort, when the page owns it: each column says whether it is the sorted one.
  const columnDefs = useMemo(
    () =>
      (sort === undefined
        ? columns
        : columns.map((column) => ({
            ...column,
            sort: sort !== null && column.colId === sort.colId ? sort.direction : null,
          }))) as ColDef<Row>[],
    [columns, sort],
  );

  const sortChanged = useCallback(
    ({ api }: SortChangedEvent<Row>) => {
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
    (node: IRowNode<Row> | null, how: "click" | "key") => {
      // A detail row and a group row aren't runs: only a row with its own data is activated.
      if (node?.data && !node.detail && !node.group) onRowActivate?.(node.data, how);
    },
    [onRowActivate],
  );

  const options: GridOptions<Row> = {
    ...(ENTERPRISE && detail
      ? {
          masterDetail: true,
          detailCellRenderer: DetailRow,
          // Tall enough for what the page draws, which can depend on the row. A detail's data is its
          // master's.
          getRowHeight: ({ node, data: row }) => {
            if (!node.detail || !row) return undefined;
            return typeof detail.height === "number" ? detail.height : detail.height(row);
          },
        }
      : {}),
    getRowClass: ({ node, data: row }) => {
      if (node.detail) return "is-detail";
      return row && openId !== null && rowId(row) === openId ? "is-open" : undefined;
    },
  };

  if (rows.length === 0) return <p className="data-grid-empty">{emptyText}</p>;
  return (
    <section className={`data-grid data-grid-${layout}`} aria-label={label}>
      <AgGridReact<Row>
        ref={grid}
        theme={gridTheme}
        rowData={rows as Row[]}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={({ data: row }) => rowId(row)}
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
        onRowDataUpdated={({ api }: RowDataUpdatedEvent<Row>) => syncOpen(api)}
        onRowClicked={(event: RowClickedEvent<Row>) => {
          if (activateOnClick && !isInteractive(event.event?.target ?? null)) {
            activate(event.node, "click");
          }
        }}
        onCellKeyDown={(event: CellKeyDownEvent<Row>) => {
          const key = event.event as KeyboardEvent | null;
          if (!key || (key.key !== "Enter" && key.key !== " ") || isInteractive(key.target)) return;
          key.preventDefault();
          activate(event.node, "key");
        }}
        {...options}
      />
    </section>
  );
}
