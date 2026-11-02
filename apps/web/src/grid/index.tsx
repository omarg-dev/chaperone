import { lazy, type ReactElement, Suspense } from "react";
import type { DataGridProps } from "./DataGrid";

// What a page imports to draw a table. The grid itself (`./DataGrid`) is most of the web bundle, so it
// is loaded when a page first draws one: the Runs page, which is where people land, shows its filters
// and its count at once while the grid arrives, and the dashboard and the Runs page share the one
// chunk. Only types are imported from `./DataGrid` here, so nothing but this file reaches it.
export type { CellProps, DataGridProps, GridColumn, GridSort } from "./DataGrid";

const Grid = lazy(() => import("./DataGrid").then((module) => ({ default: module.DataGrid })));

export function DataGrid<Row>(props: DataGridProps<Row>) {
  const Typed = Grid as unknown as (props: DataGridProps<Row>) => ReactElement;
  return (
    <Suspense
      fallback={
        <div className={`data-grid data-grid-${props.layout ?? "auto"} data-grid-loading`}>
          <p className="t-meta" role="status">
            Loading the table…
          </p>
        </div>
      }
    >
      <Typed {...props} />
    </Suspense>
  );
}
