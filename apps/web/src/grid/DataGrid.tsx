import {
  ClientSideRowModelModule,
  type ColDef,
  type ICellRendererParams,
  ModuleRegistry,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { gridTheme } from "./theme";

// AG Grid Community, behind one small component. The rest of the dashboard knows rows, columns and
// a label; it doesn't import AG. There is no AG license (decided Nov 1, docs/PLAN.md), so this uses
// only what the free packages include, and the day a license arrives the licensed grid, its modules
// and its theme are swapped in here and in theme.ts, and nothing else moves.
//
// Only the modules the page uses are registered, which keeps the bundle to the row model and the
// grid itself rather than every community feature.
ModuleRegistry.registerModules([ClientSideRowModelModule]);

// A column, as the dashboard describes it. Today it is AG's own column definition, which is the
// point of the alias: the rest of the dashboard says `GridColumn` and never `ColDef`.
export type GridColumn<Row> = ColDef<Row>;
export type CellProps<Row, Value = unknown> = ICellRendererParams<Row, Value>;

export interface DataGridProps<Row> {
  rows: readonly Row[];
  columns: GridColumn<Row>[];
  // What the table is, for assistive technology.
  label: string;
  rowId: (row: Row) => string;
  // Said in place of the table when no row passes the filters.
  emptyText: string;
}

export function DataGrid<Row>({ rows, columns, label, rowId, emptyText }: DataGridProps<Row>) {
  if (rows.length === 0) return <p className="data-grid-empty">{emptyText}</p>;
  return (
    <section className="data-grid" aria-label={label}>
      <AgGridReact<Row>
        theme={gridTheme}
        rowData={[...rows]}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={({ data }) => rowId(data)}
        // The whole table is drawn, so the page scrolls as a page and a keyboard user isn't caught in
        // a second scroll area.
        domLayout="autoHeight"
        suppressColumnVirtualisation
      />
    </section>
  );
}
