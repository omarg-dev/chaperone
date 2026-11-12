// The charts wear Chaperone's tokens, as the grid does. A chart is drawn on a canvas, which can't read
// `var(--token)`, so the tokens are read from the page's computed style (`readChartTokens`) when the
// theme changes, and a pure function (`chartThemeFrom`) turns them into AG Charts' theme. Nothing here
// is a raw colour: a change of palette is a change to tokens.css.
//
// The series are told apart by hue and lightness, not by red: red means money reached an attacker, and
// a chart of how many attacks got through under each firewall setting is a chart of settings.

export interface ChartTokens {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  fontUi: string;
  // The colour of each series in turn: Off, Rules only, the full check.
  series: [string, string, string];
}

// The tokens a chart reads, and what each is for.
const TOKENS = {
  surface: "--surface",
  ink: "--ink",
  ink2: "--ink-2",
  muted: "--muted",
  line: "--line",
  fontUi: "--font-ui",
  off: "--muted",
  gate0: "--z-cat-ink",
  full: "--hold",
} as const;

export function readChartTokens(element: Element): ChartTokens {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    surface: read(TOKENS.surface),
    ink: read(TOKENS.ink),
    ink2: read(TOKENS.ink2),
    muted: read(TOKENS.muted),
    line: read(TOKENS.line),
    fontUi: read(TOKENS.fontUi),
    series: [read(TOKENS.off), read(TOKENS.gate0), read(TOKENS.full)],
  };
}

// AG Charts' theme for the tokens: the palette, then the chart's ground, text, axes and legend.
export function chartThemeFrom(tokens: ChartTokens) {
  const text = { color: tokens.ink2, fontFamily: tokens.fontUi, fontSize: 13 };
  const axis = {
    line: { stroke: tokens.line },
    gridLine: { style: [{ stroke: tokens.line, lineDash: [] as number[] }] },
    label: text,
    title: { ...text, color: tokens.muted, fontWeight: 700 },
  };
  // Only the rules across (the values') are drawn, and the attacks' names are written flat.
  const category = { ...axis, gridLine: { enabled: false }, label: { ...text, rotation: 0 } };
  // Grouped rows make a "grouped-category" axis, which is the category axis with the groups nested.
  const axes = { category, "grouped-category": category, number: axis };
  return {
    baseTheme: "ag-default" as const,
    palette: { fills: tokens.series, strokes: tokens.series },
    overrides: {
      common: {
        background: { fill: tokens.surface },
        title: { ...text, color: tokens.ink, fontSize: 16, fontWeight: 700 },
        subtitle: text,
        legend: { item: { label: text } },
        axes,
      },
      // The column and bar charts set their axes for themselves, which outranks `common`.
      bar: { axes },
      line: { axes },
    },
  };
}
