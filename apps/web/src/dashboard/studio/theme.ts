import { type AgStudioThemeParams, studioTheme } from "ag-studio";

// AG Studio wears Chaperone's tokens, as the grids do: Studio shares AG Grid's Theming API, which
// takes CSS values, so every colour, font and radius is a `var(--token)` from styles/tokens.css and
// Studio follows light, dark and the theme switch with the page. The one thing a variable can't say
// is the browser's colour scheme (scrollbars, form controls), so it is set per mode, and the page
// names the mode on Studio's wrapper (`data-ag-theme-mode`).
//
// The chart palette is the models' colours: aubergine, slate blue, then the quiet inks. No series
// is red: red means money reached an attacker, and a chart here compares models and settings.
const tokens: Partial<AgStudioThemeParams> = {
  accentColor: "var(--hold)",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--muted)",
  borderColor: "var(--line)",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-ui)",
  focusShadow: "0 0 0 2px var(--focus)",
  rowHoverColor: "var(--sunk)",
  menuBackgroundColor: "var(--surface)",
  tooltipBackgroundColor: "var(--surface)",
  tooltipTextColor: "var(--ink)",
  invalidColor: "var(--escalate)",

  studioWrapperBackgroundColor: "var(--bg)",
  studioWrapperBorder: false,
  studioCanvasBackgroundColor: "var(--bg)",
  studioCanvasBorder: false,
  studioCanvasShadow: "none",
  studioPanelContainerBackgroundColor: "var(--surface)",
  studioWidgetBackgroundColor: "var(--surface)",
  studioWidgetBorder: "1px solid var(--line)",
  studioWidgetBorderRadius: "var(--radius)",
  studioWidgetTitleFontFamily: "var(--font-ui)",
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleFontSize: 15,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleFontFamily: "var(--font-ui)",
  studioWidgetTitleTextColor: "var(--ink)",
  studioWidgetSubtitleTextColor: "var(--muted)",
  studioWidgetCaptionTextColor: "var(--muted)",
  studioPanelHeaderFontFamily: "var(--font-ui)",

  gridHeaderBackgroundColor: "var(--surface)",
  gridHeaderTextColor: "var(--muted)",
  gridHeaderFontWeight: 700,
  gridRowBorder: "1px solid var(--line)",
  gridHeaderRowBorder: "2px solid var(--ink)",
  gridColumnBorder: false,
  gridWrapperBorder: false,

  chartFontFamily: "var(--font-ui)",
  chartTextColor: "var(--ink-2)",
  chartSubtleTextColor: "var(--muted)",
  chartAxisLineColor: "var(--line-strong)",
  chartGridLineColor: "var(--line)",
  chartPaletteFills1Color: "var(--hold)",
  chartPaletteFills2Color: "var(--z-cat-ink)",
  chartPaletteFills3Color: "var(--muted)",
  chartPaletteFills4Color: "var(--line-strong)",
};

export const benchmarkTheme = studioTheme
  .withParams(tokens)
  .withParams({ browserColorScheme: "light" }, "light")
  .withParams({ browserColorScheme: "dark" }, "dark");
