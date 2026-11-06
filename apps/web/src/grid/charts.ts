import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import { ModuleRegistry } from "ag-grid-community";
import { IntegratedChartsModule } from "ag-grid-enterprise";

// Integrated charts: a chart drawn from cells of the grid. It needs AG Charts Enterprise, which is
// most of what Enterprise adds to the bundle, so this is a chunk of its own: the dashboard's grid
// loads it, and the Runs history never does. Registered here and nowhere else, like `enterprise.ts`.
ModuleRegistry.registerModules([IntegratedChartsModule.with(AgChartsEnterpriseModule)]);
