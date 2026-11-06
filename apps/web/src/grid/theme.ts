import { themeQuartz } from "ag-grid-community";

// The grid wears Chaperone's tokens. AG Grid's Theming API takes CSS values, so every parameter is a
// `var(--token)` from styles/tokens.css and the grid follows light, dark and the theme switch
// without a second theme object. Nothing here is a raw colour: a change of palette is a change to
// tokens.css.
//
// This is the one place AG's look is set. A licensed theme (or a different grid) replaces this file.
export const gridTheme = themeQuartz.withParams({
  accentColor: "var(--hold)",
  backgroundColor: "var(--bg)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--line)",
  // The rows are ruled by a hairline, and the header by a 2px rule in the ink: the table is read as
  // a ledger, not drawn as a box. No wrapper border, and nearly square corners.
  headerBackgroundColor: "var(--bg)",
  headerTextColor: "var(--muted)",
  headerFontWeight: 700,
  headerFontSize: "var(--text-meta)",
  headerFontFamily: "var(--font-ui)",
  headerRowBorder: "2px solid var(--ink)",
  rowBorder: "1px solid var(--line)",
  columnBorder: false,
  wrapperBorder: false,
  wrapperBorderRadius: "var(--radius)",
  borderRadius: "var(--radius)",
  rowHoverColor: "var(--sunk)",
  selectedRowBackgroundColor: "var(--hold-tint)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-body)",
  cellHorizontalPadding: 12,
  rowHeight: 62,
  headerHeight: 46,
  // The pinned columns (the outcome and the scenario) are told apart from the ones that scroll under
  // them by a line, and a column's edge is still dragged to resize it, with no line drawn on it.
  pinnedColumnBorder: "1px solid var(--line-strong)",
  headerColumnResizeHandleColor: "transparent",
  // A table that draws every row (the dashboard's) is a page of its own at 60 runs: past this it
  // scrolls inside itself. The Runs history sets its own height and draws only what is in view.
  autoHeightMaxBodyHeight: 616,
  // The grids have no menus, filters or editors of AG's own (the toolbars above them filter), but the
  // ones AG would draw follow the same tokens.
  chromeBackgroundColor: "var(--sunk)",
  menuBackgroundColor: "var(--surface)",
  inputBorder: "1px solid var(--line-strong)",
  focusShadow: "0 0 0 2px var(--focus)",
});
