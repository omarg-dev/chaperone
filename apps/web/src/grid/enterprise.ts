import { ModuleRegistry } from "ag-grid-community";
import { AggregationModule, MasterDetailModule, RowGroupingModule } from "ag-grid-enterprise";

// The Enterprise modules the grids use, and no others. Importing this file registers them, so it is
// loaded only when `flag.ts` says Enterprise is on, by the grid's lazy loader in `index.tsx` and by
// nothing else. It is licensed software used without a key under the hackathon allowance (see
// `flag.ts`), so each module here is one a page uses:
//
// - `MasterDetailModule`: a row opens its detail under it (the dashboard's drill-down).
// - `RowGroupingModule`: rows grouped under a column's values, a group row for each (the dashboard's
//   attack types, the Runs history's scenarios).
// - `AggregationModule`: a group row's own figure for a column (how many of its runs got through),
//   which is also what a chart of the groups reads.
ModuleRegistry.registerModules([MasterDetailModule, RowGroupingModule, AggregationModule]);
