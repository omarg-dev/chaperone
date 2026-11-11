import type { CellView, OutcomeView, ResultsView } from "@firewall/eval/view";
import { formatCost, formatDuration } from "../format";
import { CONFIG_INFO, CONFIG_ORDER, type Config, type GridRow } from "./results";

// What the dashboard's drill-down says about one cell of the matrix: the same recorded checkout read
// by each firewall setting, with what each gate said and what it cost. Pure, and only what the
// results file holds: nothing here is worked out again, it is picked from the file and worded.

export type Verdict = NonNullable<OutcomeView["verdict"]>;
export type GateName = OutcomeView["gates"][number]["gate"];

export const GATE_NAMES: Record<GateName, string> = {
  gate0: "Gate 0",
  gate1: "Gate 1",
  gate2: "Gate 2",
  gate3: "Gate 3",
};

// What one gate did under one setting, for the table's cell.
export type GateCell =
  // The gate ran, said this, and took this long (and cost this, when it called a model).
  | { kind: "ran"; verdict: Verdict; time: string; cost: string | null }
  // The tree stopped before it. A block ends a review.
  | { kind: "skipped"; why: string }
  // The setting doesn't include this gate (Off has none, Rules only has the first).
  | { kind: "absent" };

export interface SettingDetail {
  config: Config;
  name: string;
  what: string;
  // The review's verdict, or why there isn't one.
  verdict: { kind: "verdict"; verdict: Verdict } | { kind: "none"; text: string };
  gates: Record<GateName, GateCell>;
  cost: string;
  time: string;
}

export interface CellDetail {
  rowId: string;
  title: string;
  seed: string;
  // The gates any setting ran or skipped, in order: the table's rows.
  gates: GateName[];
  settings: SettingDetail[];
  // Why a gate didn't run, said once for the gates that share a reason, not in every cell.
  notes: string[];
}

const GATE_ORDER: readonly GateName[] = ["gate0", "gate1", "gate2", "gate3"];

// The file writes why a gate was skipped as code does ("gate0 blocked, which ends the review").
const skippedWhy = (reason: string) =>
  reason.replace(/\bgate(\d)\b/g, "Gate $1").replace(/^./, (c) => c.toUpperCase());

function settingOf(config: Config, outcome: OutcomeView | undefined): SettingDetail {
  const info = CONFIG_INFO[config];
  const gates = Object.fromEntries(
    GATE_ORDER.map((gate): [GateName, GateCell] => [gate, { kind: "absent" }]),
  ) as Record<GateName, GateCell>;
  if (!outcome) {
    return {
      config,
      name: info.name,
      what: info.what,
      verdict: { kind: "none", text: "Not run" },
      gates,
      cost: "n/a",
      time: "n/a",
    };
  }
  for (const gate of outcome.gates) {
    gates[gate.gate] = {
      kind: "ran",
      verdict: gate.verdict,
      time: formatDuration(gate.latencyMs),
      // Gate 0 is rules and costs nothing; saying "No cost" on it every time would be noise.
      cost: gate.costUsd > 0 ? formatCost(gate.costUsd) : null,
    };
  }
  for (const skipped of outcome.skipped) {
    gates[skipped.gate] = { kind: "skipped", why: skippedWhy(skipped.reason) };
  }
  const verdict: SettingDetail["verdict"] = outcome.failed
    ? { kind: "none", text: "Review failed" }
    : outcome.verdict
      ? { kind: "verdict", verdict: outcome.verdict }
      : { kind: "none", text: config === "off" ? "No review" : "No verdict" };
  return {
    config,
    name: info.name,
    what: info.what,
    verdict,
    gates,
    cost: formatCost(outcome.costUsd),
    time: formatDuration(outcome.latencyMs),
  };
}

// The cell a table row stands for (its ID is the cell's scenario, seed and model column).
export const cellOf = (results: ResultsView, rowId: string): CellView | undefined =>
  results.cells.find(({ input }) => `${input.scenarioId}:${input.seed}:${input.column}` === rowId);

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

// "Gate 1 and Gate 2 didn't run under Full check. Gate 0 blocked, which ends the review."
function notesOf(settings: readonly SettingDetail[]): string[] {
  return settings.flatMap((setting) => {
    const byReason = new Map<string, GateName[]>();
    for (const gate of GATE_ORDER) {
      const cell = setting.gates[gate];
      if (cell.kind === "skipped")
        byReason.set(cell.why, [...(byReason.get(cell.why) ?? []), gate]);
    }
    return [...byReason].map(
      ([why, gates]) =>
        `${list(gates.map((g) => GATE_NAMES[g]))} didn't run under ${setting.name}. ${why}.`,
    );
  });
}

export function detailOf(cell: CellView, row: GridRow): CellDetail {
  const settings = CONFIG_ORDER.map((config) =>
    settingOf(
      config,
      cell.outcomes.find((o) => o.config === config),
    ),
  );
  // A gate gets a row when some setting ran it or skipped it, so a tree with no Gate 3 has no row
  // that is empty in every column.
  const gates = GATE_ORDER.filter((gate) =>
    settings.some((setting) => setting.gates[gate].kind !== "absent"),
  );
  return {
    rowId: row.id,
    title: row.title,
    seed: row.seed,
    gates,
    settings,
    notes: notesOf(settings),
  };
}
