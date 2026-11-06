import { describe, expect, it } from "vitest";
import { cellOf, detailOf } from "./detail";
import { fakeResults } from "./fixtures";
import { gridRows } from "./results";

const rows = gridRows(fakeResults, {});
const row = (id: string) => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(id);
  return found;
};
const detailFor = (rowId: string) => {
  const cell = cellOf(fakeResults, rowId);
  if (!cell) throw new Error(rowId);
  return detailOf(cell, row(rowId));
};

// A cell the full tree approved and Gate 0 alone did too: every gate ran under the full tree.
const approved = rows.find((r) => {
  const cell = cellOf(fakeResults, r.id);
  return cell?.outcomes.find((o) => o.config === "full")?.gates.length === 3;
});
// A cell Gate 0 blocked: the full tree stopped there, and skipped the model gates.
const stopped = rows.find((r) => {
  const cell = cellOf(fakeResults, r.id);
  return (cell?.outcomes.find((o) => o.config === "full")?.skipped.length ?? 0) > 0;
});

describe("the drill-down's data", () => {
  it("finds the cell a row stands for, and none for an unknown row", () => {
    for (const r of rows) expect(cellOf(fakeResults, r.id)).toBeDefined();
    expect(cellOf(fakeResults, "sc_nope:1:claude-haiku-5-5")).toBeUndefined();
  });

  it("has the three settings in the page's order, whatever order the file has them", () => {
    const detail = detailFor((approved ?? rows[0])?.id ?? "");
    expect(detail.settings.map((s) => s.name)).toEqual(["Off", "Gate 0 only", "Full tree"]);
    expect(detail.settings.map((s) => s.what)).toEqual([
      "No review",
      "Rules, no model",
      "Every gate",
    ]);
  });

  it("says nobody reviewed the cart when the firewall is off", () => {
    const [off] = detailFor((approved ?? rows[0])?.id ?? "").settings;
    expect(off?.verdict).toEqual({ kind: "none", text: "No review" });
    expect(off?.gates.gate0).toEqual({ kind: "absent" });
  });

  it("gives each gate's verdict, time and cost under the settings that ran it", () => {
    expect(approved).toBeDefined();
    const detail = detailFor(approved?.id ?? "");
    const [, gate0, full] = detail.settings;
    // Gate 0 only runs the rules; the full tree runs all three, and the model gates cost money.
    expect(gate0?.gates.gate0).toMatchObject({ kind: "ran", verdict: "approve", cost: null });
    expect(gate0?.gates.gate1).toEqual({ kind: "absent" });
    const cell = cellOf(fakeResults, approved?.id ?? "");
    const gate1 = cell?.outcomes.find((o) => o.config === "full")?.gates[1];
    expect(full?.gates.gate1).toEqual({
      kind: "ran",
      verdict: gate1?.verdict,
      time: expect.stringMatching(/ (ms|s)$/),
      cost: expect.stringMatching(/^\$0\.\d{4}$/),
    });
    expect(detail.gates).toEqual(["gate0", "gate1", "gate2"]);
  });

  it("words why the tree skipped a gate, without a code name", () => {
    expect(stopped).toBeDefined();
    const detail = detailFor(stopped?.id ?? "");
    const full = detail.settings[2];
    expect(full?.verdict).toEqual({ kind: "verdict", verdict: "block" });
    expect(full?.gates.gate1).toEqual({
      kind: "skipped",
      why: "Gate 0 blocked, which ends the review",
    });
    expect(full?.gates.gate2).toMatchObject({ kind: "skipped" });
    // The reason is said once, for the two gates that share it.
    expect(detail.notes).toEqual([
      "Gate 1 and Gate 2 didn't run under Full tree. Gate 0 blocked, which ends the review.",
    ]);
  });

  it("has no notes when every gate that was planned ran", () => {
    expect(detailFor(approved?.id ?? "").notes).toEqual([]);
  });

  it("takes the totals from the file, worded", () => {
    const cell = cellOf(fakeResults, approved?.id ?? "");
    const full = cell?.outcomes.find((o) => o.config === "full");
    const setting = detailFor(approved?.id ?? "").settings[2];
    expect(setting?.cost).toBe(`$${full?.costUsd.toFixed(4)}`);
    expect(setting?.time).toMatch(/ (ms|s)$/);
  });

  it("says when a review failed or a setting wasn't run", () => {
    const cell = structuredClone(cellOf(fakeResults, approved?.id ?? ""));
    if (!cell) throw new Error("no cell");
    const full = cell.outcomes.find((o) => o.config === "full");
    if (full) {
      full.failed = "Gate 2's model didn't answer";
      full.verdict = null;
    }
    cell.outcomes = cell.outcomes.filter((o) => o.config !== "gate0");
    const detail = detailOf(cell, approved ?? row(rows[0]?.id ?? ""));
    expect(detail.settings[2]?.verdict).toEqual({ kind: "none", text: "Review failed" });
    expect(detail.settings[1]).toMatchObject({
      verdict: { kind: "none", text: "Not run" },
      cost: "n/a",
      time: "n/a",
    });
  });
});
