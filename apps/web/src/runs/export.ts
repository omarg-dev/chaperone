import type { RunSummary } from "../api";
import { formatDate } from "../format";
import { taskWords } from "../words/plain";
import type { Filters } from "./filters";
import { moneyIn } from "./money";
import { scenarioName } from "./sort";
import { configLabel, configOf, OUTCOME_LABELS, outcomeOf } from "./state";

// "Download as a spreadsheet": the Runs history, as the filters leave it, in an Excel file. What goes in
// each cell is decided here, in plain functions, and the grid only writes the file: a cell of the grid
// draws a pill or an amount, which is no use in a spreadsheet, so each column says what it holds.

// The columns the file holds, in order. The run's ID is one, though the page doesn't show it: a sheet
// found later needs it to find the run again.
export const EXPORT_COLUMNS = [
  "verdict",
  "scenario",
  "firewall",
  "held",
  "moved",
  "voided",
  "started",
  "run",
] as const;

// A column's value for a run: a word, or an amount in dollars as a number, so the sheet can add it up.
export function exportCell(
  run: RunSummary,
  colId: string,
  titles: Record<string, string>,
): string | number | null {
  const dollars = (place: "held" | "moved" | "voided") => {
    const cents = moneyIn(run, place);
    return cents === null ? null : cents / 100;
  };
  switch (colId) {
    case "verdict":
      return OUTCOME_LABELS[outcomeOf(run)];
    case "scenario":
      return scenarioName(run, titles) || "No task";
    case "firewall": {
      const last = configOf(run);
      return last ? configLabel(last) : "Not checked";
    }
    case "held":
    case "moved":
    case "voided":
      return dollars(colId);
    case "started":
      return run.startedAt;
    case "run":
      return run.runId;
    default:
      return null;
  }
}

// What the file says about itself above the table, so a sheet found later says which runs it holds.
export function evidenceIntro(
  filters: Filters,
  shown: number,
  total: number,
  titles: Record<string, string>,
  exportedAt: Date,
): string[] {
  const applied = [
    filters.outcome && `Outcome: ${OUTCOME_LABELS[filters.outcome]}`,
    filters.config && `Check: ${configLabel(filters.config)}`,
    filters.scenario && `Task: ${taskWords(filters.scenario, titles)}`,
    filters.kind && `Attack: ${filters.kind === "attack" ? "With an attack" : "No attack"}`,
    filters.query && `Search: ${filters.query}`,
  ].filter((line): line is string => Boolean(line));
  return [
    "Chaperone runs",
    `Exported ${formatDate(exportedAt.toISOString().slice(0, 10))}`,
    applied.length > 0 ? `Filters: ${applied.join("; ")}` : "Filters: none",
    shown === total ? `${total} runs` : `${shown} of ${total} runs`,
  ];
}

export const evidenceFileName = (exportedAt: Date) =>
  `chaperone-runs-${exportedAt.toISOString().slice(0, 10)}`;
