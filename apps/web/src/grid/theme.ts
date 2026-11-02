import { themeQuartz } from "ag-grid-community";

// The grid wears Chaperone's tokens. AG Grid's Theming API takes CSS values, so every parameter is a
// `var(--token)` from styles/tokens.css and the grid follows light, dark and the theme switch
// without a second theme object. Nothing here is a raw colour: a change of palette is a change to
// tokens.css.
//
// This is the one place AG's look is set. A licensed theme (or a different grid) replaces this file.
export const gridTheme = themeQuartz.withParams({
  accentColor: "var(--hold)",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--line)",
  headerBackgroundColor: "var(--sunk)",
  headerTextColor: "var(--muted)",
  headerFontWeight: 600,
  headerFontSize: "var(--text-meta)",
  rowHoverColor: "var(--sunk)",
  selectedRowBackgroundColor: "var(--hold-tint)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-body)",
  wrapperBorderRadius: "var(--radius-lg)",
  borderRadius: "var(--radius-sm)",
  cellHorizontalPadding: "var(--space-4)",
  rowHeight: 56,
  headerHeight: 40,
  // The pinned column (the scenario) is told apart from the ones that scroll under it by a line, and
  // a column's edge shows where it can be dragged.
  pinnedColumnBorder: "1px solid var(--line-strong)",
  headerColumnResizeHandleColor: "var(--line-strong)",
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
