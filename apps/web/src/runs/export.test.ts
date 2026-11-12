import { describe, expect, it } from "vitest";
import { run } from "../test-utils";
import { EXPORT_COLUMNS, evidenceFileName, evidenceIntro, exportCell } from "./export";
import { NO_FILTERS } from "./filters";

const at = "2026-11-03T10:00:00Z";
const titles = { sc_a01: "Wireless tactile keyboard under $90" };

describe("what each column of the evidence holds", () => {
  const paid = run("run_a", "sc_a01", at, {
    attackerPaid: true,
    paidTo: ["Keyhaven Direct"],
    heldCents: 7999,
    reviews: ["off"],
    decidedBy: "no_review",
    verdict: "approve",
  });
  const voided = run("run_b", "sc_a01", at, {
    verdict: "block",
    decidedBy: "review",
    heldCents: 4000,
    reviews: ["off", "gate0", "full"],
  });

  it("writes words for the outcome, the scenario and the firewall setting", () => {
    expect(exportCell(paid, "verdict", titles)).toBe("Paid attacker");
    expect(exportCell(voided, "verdict", titles)).toBe("Blocked");
    expect(exportCell(paid, "scenario", titles)).toBe("Wireless tactile keyboard under $90");
    expect(exportCell(run("r", null, at), "scenario", titles)).toBe("No task");
    expect(exportCell(paid, "firewall", titles)).toBe("Off");
    expect(exportCell(voided, "firewall", titles)).toBe("Full check");
    expect(exportCell(run("r", "s", at), "firewall", titles)).toBe("Not checked");
  });

  it("writes an amount in dollars as a number, in the one money column the run's money is in", () => {
    expect(exportCell(paid, "moved", titles)).toBe(79.99);
    expect(exportCell(paid, "held", titles)).toBeNull();
    expect(exportCell(paid, "voided", titles)).toBeNull();
    expect(exportCell(voided, "voided", titles)).toBe(40);
    expect(exportCell(run("r", "s", at), "moved", titles)).toBeNull();
  });

  it("writes the time as it was recorded and the run's ID, so the run can be found again", () => {
    expect(exportCell(paid, "started", titles)).toBe(at);
    expect(exportCell(paid, "run", titles)).toBe("run_a");
    // The page doesn't show the ID, so the file names the column itself rather than following the
    // columns on screen.
    expect(EXPORT_COLUMNS).toContain("run");
    expect(exportCell(paid, "unknown", titles)).toBeNull();
  });
});

describe("what the file says about itself", () => {
  const when = new Date("2026-11-03T12:00:00Z");

  it("says which runs it holds: the filters, and how many of how many", () => {
    expect(evidenceIntro(NO_FILTERS, 66, 66, titles, when)).toEqual([
      "Chaperone runs",
      "Exported 3 Nov 2026",
      "Filters: none",
      "66 runs",
    ]);
    expect(
      evidenceIntro(
        { ...NO_FILTERS, outcome: "attacker_paid", config: "off", scenario: "sc_a01", query: "kb" },
        3,
        66,
        titles,
        when,
      ),
    ).toEqual([
      "Chaperone runs",
      "Exported 3 Nov 2026",
      "Filters: Outcome: Paid attacker; Check: Off; Task: Wireless tactile keyboard under $90; Search: kb",
      "3 of 66 runs",
    ]);
  });

  it("names the file for the day", () => {
    expect(evidenceFileName(when)).toBe("chaperone-runs-2026-11-03");
  });
});
