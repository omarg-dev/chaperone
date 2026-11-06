// The one switch for AG Grid Enterprise. The AG Grid team said on the hackathon Discord (Nov 2) that
// entrants may use the Enterprise edition without a license key, with its watermark showing, so the
// dashboard and the Runs history use it, and nothing sets a key anywhere. Turning it off is this one
// line: `enterprise.ts` and `charts.ts` are then never imported (the build leaves out
// `ag-grid-enterprise` and `ag-charts-enterprise` entirely), the wrapper ignores the props that need
// them, and the pages hide the controls for them. The tables are then plain community tables, without
// their drill-down, grouping, charts, status bar and export.
export const ENTERPRISE = true;
