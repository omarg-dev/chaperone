import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The clasp moment is plain CSS driven by the run's state. These pin the durations the design spec
// gives and that each animation has its end state under prefers-reduced-motion.
const styles = join(dirname(fileURLToPath(import.meta.url)), "../styles");
const run = readFileSync(join(styles, "run.css"), "utf8");
const timeline = readFileSync(join(styles, "timeline.css"), "utf8");

describe("the clasp motion", () => {
  it("draws a block's right arm in 320ms and strikes the amount after it", () => {
    expect(run).toMatch(/\.run-arm-right\s*{[^}]*animation: arm-draw 320ms/);
    expect(run).toMatch(/\.run-strike\s*{[^}]*animation: strike 260ms[^;]*320ms/);
  });

  it("slides an approval's money out in 500ms", () => {
    expect(run).toMatch(
      /\.run-money-captured \.amt,\s*\.run-money-attacker \.amt\s*{[^}]*animation: token-out 500ms/,
    );
  });

  it("gives an escalation one amber ring pulse", () => {
    expect(timeline).toMatch(/\.tl-exit-dot\s*{[^}]*animation: ring-pulse 900ms[^;]*both/);
    expect(timeline).toMatch(/@keyframes ring-pulse[\s\S]*var\(--v-escalate\)/);
    expect(timeline).not.toMatch(/animation:[^;]*infinite/);
  });

  it("shows the end state, with no animation, under prefers-reduced-motion", () => {
    const reduced = (css: string) => css.slice(css.indexOf("prefers-reduced-motion: reduce"));
    for (const name of [".run-arm-right", ".run-strike", ".run-money-captured .amt"]) {
      expect(reduced(run)).toContain(name);
    }
    expect(reduced(run)).toMatch(/animation: none/);
    expect(reduced(timeline)).toMatch(/\.tl-exit-dot[^}]*animation: none/);
  });
});
