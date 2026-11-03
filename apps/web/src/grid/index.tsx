import { lazy, type ReactElement, Suspense } from "react";
import type { DataGridProps } from "./DataGrid";
import { ENTERPRISE } from "./flag";

// What a page imports to draw a table. The grid itself (`./DataGrid`) is most of the web bundle, so it
// is loaded when a page first draws one: the Runs page, which is where people land, shows its filters
// and its count at once while the grid arrives, and the dashboard and the Runs page share the one
// chunk. Only types are imported from `./DataGrid` here, so nothing but this file reaches it.
export type {
  CellProps,
  ChartRequest,
  DataGridProps,
  ExcelRequest,
  GridColumn,
  GridHandle,
  GridSort,
  HeaderProps,
} from "./DataGrid";
// Whether the Enterprise features are on (see flag.ts), for a page to leave out the controls that need
// them.
export { ENTERPRISE };

// The grid, and with it the Enterprise modules when `flag.ts` has them on (a constant, so with the flag
// off the build never includes them). The charts are a chunk of their own, loaded only by a grid that
// asks for them (`charts`), so the Runs page never pays for them.
const load = (charts: boolean) => async () => {
  const [module] = await Promise.all([
    import("./DataGrid"),
    ENTERPRISE ? import("./enterprise") : null,
    ENTERPRISE && charts ? import("./charts") : null,
  ]);
  return { default: module.DataGrid };
};
const Grid = lazy(load(false));
const GridWithCharts = lazy(load(true));

// What the test files load before they draw a grid (see `loadGrid` in test-utils.tsx).
export const loadGridChunks = () => Promise.all([load(false)(), load(true)()]);

export function DataGrid<Row>(props: DataGridProps<Row>) {
  const Typed = (props.charts ? GridWithCharts : Grid) as unknown as (
    props: DataGridProps<Row>,
  ) => ReactElement;
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
