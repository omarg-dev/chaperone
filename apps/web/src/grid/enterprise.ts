import { ModuleRegistry } from "ag-grid-community";
import { MasterDetailModule } from "ag-grid-enterprise";

// The Enterprise modules the grids use, and no others. Importing this file registers them, so it is
// loaded only when `flag.ts` says Enterprise is on, by the grid's lazy loader in `index.tsx` and by
// nothing else. It is licensed software used without a key under the hackathon allowance (see
// `flag.ts`), so each module here is one a page uses:
//
// - `MasterDetailModule`: a row opens its detail under it (the dashboard's drill-down).
ModuleRegistry.registerModules([MasterDetailModule]);
