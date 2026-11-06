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
  // 60 runs would be a page of their own: past this the table scrolls inside itself.
  autoHeightMaxBodyHeight: 616,
  // The grid has no menus, filters or editors of its own on this page (the toolbar above it filters),
  // but the ones AG would draw follow the same tokens.
  chromeBackgroundColor: "var(--sunk)",
  menuBackgroundColor: "var(--surface)",
  inputBorder: "1px solid var(--line-strong)",
  focusShadow: "0 0 0 2px var(--focus)",
});
