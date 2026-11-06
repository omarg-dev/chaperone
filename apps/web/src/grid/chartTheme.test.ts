import { describe, expect, it } from "vitest";
import { type ChartTokens, chartThemeFrom, readChartTokens } from "./chartTheme";

const tokens: ChartTokens = {
  surface: "#ffffff",
  ink: "#170f1b",
  ink2: "#463b4a",
  muted: "#64586a",
  line: "#e0d9df",
  fontUi: "Archivo Variable",
  series: ["#64586a", "#2b4a6b", "#4a2348"],
};

describe("the chart theme", () => {
  it("is made of the tokens it is given, one colour for each series", () => {
    const theme = chartThemeFrom(tokens);
    expect(theme.palette.fills).toEqual(tokens.series);
    expect(theme.overrides.common.background.fill).toBe(tokens.surface);
    expect(theme.overrides.common.axes.number.label.fontFamily).toBe("Archivo Variable");
    expect(theme.overrides.common.axes.category.gridLine.enabled).toBe(false);
    expect(theme.overrides.common.axes.number.gridLine.style[0]?.stroke).toBe(tokens.line);
  });

  it("never uses the attacker's red for a series", () => {
    // Red means money reached an attacker (docs/design.md), so no series wears it, whichever theme.
    const attacker = ["#b3261e", "#ff7b6e"];
    for (const light of [true, false]) {
      const theme = chartThemeFrom(
        light ? tokens : { ...tokens, series: ["#a396a5", "#a9c3e0", "#d2aacb"] },
      );
      for (const fill of theme.palette.fills) expect(attacker).not.toContain(fill.toLowerCase());
    }
  });

  it("reads each token from the page's style, trimmed", () => {
    const root = document.createElement("div");
    root.style.setProperty("--surface", " #fff ");
    root.style.setProperty("--hold", "#4a2348");
    document.body.append(root);
    const read = readChartTokens(root);
    expect(read.surface).toBe("#fff");
    expect(read.series[2]).toBe("#4a2348");
    root.remove();
  });
});
