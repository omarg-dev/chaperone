import type { ConfigMetricsView, ResultsSummary, ResultsView } from "@firewall/eval/view";

// What the landing page says about the eval, from the results files and nothing typed in. Two
// steps, both pure: `selectResults` picks which files to read from the server's list, and
// `proofOf` takes the numbers out of a file, as the file counted them.

// The agent columns the page shows, in order. The label is what the page says until a file names
// the column itself.
export const COLUMNS = [
  { columnId: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { columnId: "gpt-6-luna", label: "OpenAI GPT-6 Luna" },
  { columnId: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
] as const;

// A held-out scenario is one ported from a published benchmark, and its id starts "sc_h". A file is
// the held-out set when every scenario in it is one. Our own set is every other sandbox file.
export const isHeldOutScenario = (scenarioId: string) => scenarioId.startsWith("sc_h");
export const isHeldOutFile = (file: Pick<ResultsSummary, "scenarios">) =>
  file.scenarios.length > 0 && file.scenarios.every(isHeldOutScenario);

export interface Selection {
  // One entry per column: the newest sandbox file of our own scenarios, or null while it runs.
  columns: { columnId: string; label: string; file: string | null }[];
  // The newest sandbox file of the held-out set, or null when there isn't one.
  heldOut: string | null;
}

const newest = (files: ResultsSummary[]) =>
  [...files].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.name.localeCompare(a.name),
  )[0];

// A fake file is never picked: its money is practice money.
export function selectResults(list: readonly ResultsSummary[]): Selection {
  const sandbox = list.filter((file) => file.paymentAdapter === "sandbox");
  const own = sandbox.filter((file) => !isHeldOutFile(file));
  return {
    columns: COLUMNS.map(({ columnId, label }) => ({
      columnId,
      label,
      file: newest(own.filter((file) => file.column.columnId === columnId))?.name ?? null,
    })),
    heldOut: newest(sandbox.filter(isHeldOutFile))?.name ?? null,
  };
}

export interface Side {
  attackRuns: number;
  attackSuccesses: number;
  attackSuccessRate: number | null;
}

export interface Proof {
  label: string;
  date: string;
  seeds: string[];
  gateModel: string;
  // The firewall off, and the full tree, on the same carts.
  off: Side;
  full: Side;
  // Attacks where the agent was fooled, with the firewall off.
  fooled: number;
  cleanCarts: number;
  falseBlocks: number;
  falseEscalations: number;
}

const side = (config: ConfigMetricsView): Side => ({
  attackRuns: config.attackRuns,
  attackSuccesses: config.attackSuccesses,
  attackSuccessRate: config.attackSuccessRate,
});

// Null when the file has no `off` or `full` setting to compare, or no attack runs.
export function proofOf(results: ResultsView): Proof | null {
  const off = results.metrics.configs.find((c) => c.config === "off");
  const full = results.metrics.configs.find((c) => c.config === "full");
  if (!off || !full || off.attackRuns === 0) return null;
  return {
    label: results.meta.column.label,
    date: results.meta.date,
    seeds: results.meta.seeds,
    gateModel: results.meta.gateModel,
    off: side(off),
    full: side(full),
    fooled: off.attackFooled,
    cleanCarts: full.cleanCarts,
    falseBlocks: full.cleanBlocked,
    falseEscalations: full.cleanEscalated,
  };
}

// What the page draws for one column: still running (no file, or one with nothing to compare), or
// the proof.
export type ColumnView =
  | { status: "running"; columnId: string; label: string }
  | { status: "ready"; columnId: string; label: string; file: string; proof: Proof };

export function columnViews(
  selection: Selection,
  files: Readonly<Record<string, ResultsView>>,
): ColumnView[] {
  return selection.columns.map(({ columnId, label, file }): ColumnView => {
    const view = file === null ? undefined : files[file];
    const proof = view ? proofOf(view) : null;
    return file !== null && proof
      ? { status: "ready", columnId, label: proof.label, file, proof }
      : { status: "running", columnId, label };
  });
}

// The headline column is the first one with a file: its off number is the page's big number.
export const headlineOf = (views: readonly ColumnView[]) =>
  views.find((v): v is Extract<ColumnView, { status: "ready" }> => v.status === "ready") ?? null;
