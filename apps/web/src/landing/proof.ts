import type { ConfigMetricsView, ResultsSummary, ResultsView } from "@firewall/eval/view";

// What the landing page says about the eval, from the results files and nothing typed in. Two
// steps, both pure: `selectResults` picks which files to read from the server's list, and
// `proofViews` takes the numbers out of them, as the files counted them. A model is shown only when
// a file for it exists: there is no placeholder for a model that hasn't run.

// The order the page draws the models it has files for. A model not named here comes after, by its
// label, so a new column shows up without a change here.
export const COLUMN_ORDER: readonly string[] = ["claude-haiku-5-5", "gpt-6-luna"];

// A held-out scenario is one ported from a published benchmark, and its id starts "sc_h". A file is
// the held-out set when every scenario in it is one. Our own set is every other sandbox file.
export const isHeldOutScenario = (scenarioId: string) => scenarioId.startsWith("sc_h");
export const isHeldOutFile = (file: Pick<ResultsSummary, "scenarios">) =>
  file.scenarios.length > 0 && file.scenarios.every(isHeldOutScenario);

export interface Picked {
  columnId: string;
  label: string;
  file: string;
}

export interface Selection {
  // The newest sandbox file of each model that has one, for our own scenarios and for the held-out
  // set, in the page's order.
  own: Picked[];
  heldOut: Picked[];
}

const newerFirst = (a: ResultsSummary, b: ResultsSummary) =>
  b.startedAt.localeCompare(a.startedAt) || b.name.localeCompare(a.name);

const rank = (columnId: string) => {
  const at = COLUMN_ORDER.indexOf(columnId);
  return at < 0 ? COLUMN_ORDER.length : at;
};

function newestPerColumn(files: ResultsSummary[]): Picked[] {
  const picked = new Map<string, ResultsSummary>();
  for (const file of [...files].sort(newerFirst)) {
    if (!picked.has(file.column.columnId)) picked.set(file.column.columnId, file);
  }
  return [...picked.values()]
    .sort(
      (a, b) =>
        rank(a.column.columnId) - rank(b.column.columnId) ||
        a.column.label.localeCompare(b.column.label),
    )
    .map((file) => ({ columnId: file.column.columnId, label: file.column.label, file: file.name }));
}

// A fake file is never picked: its money is practice money.
export function selectResults(list: readonly ResultsSummary[]): Selection {
  const sandbox = list.filter((file) => file.paymentAdapter === "sandbox");
  return {
    own: newestPerColumn(sandbox.filter((file) => !isHeldOutFile(file))),
    heldOut: newestPerColumn(sandbox.filter(isHeldOutFile)),
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
  seeds: number;
  // How many scenarios the matrix ran.
  scenarios: number;
  gateModel: string;
  // The firewall off, and the full tree, on the same carts.
  off: Side;
  full: Side;
  // Carts with nothing wrong in them (benign runs, and attacks the agent wasn't fooled by), and what
  // the full tree did to them by mistake.
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
    seeds: results.meta.seeds.length,
    scenarios: new Set(results.meta.scenarios).size,
    gateModel: results.meta.gateModel,
    off: side(off),
    full: side(full),
    cleanCarts: full.cleanCarts,
    falseBlocks: full.cleanBlocked,
    falseEscalations: full.cleanEscalated,
  };
}

// One model's numbers, as the page draws them.
export interface ColumnView {
  columnId: string;
  label: string;
  file: string;
  proof: Proof;
}

// The picked files that were read and have something to compare; any other is left out, so the page
// never draws a model it has no numbers for.
export function proofViews(
  picked: readonly Picked[],
  files: Readonly<Record<string, ResultsView>>,
): ColumnView[] {
  return picked.flatMap(({ columnId, file }) => {
    const view = files[file];
    const proof = view ? proofOf(view) : null;
    return proof ? [{ columnId, label: proof.label, file, proof }] : [];
  });
}

// What every view has in common, said once under the section, or null where they differ (then each
// model says its own).
export function sharedOf<T>(views: readonly ColumnView[], pick: (proof: Proof) => T): T | null {
  const first = views[0];
  if (!first) return null;
  const value = pick(first.proof);
  return views.every((v) => pick(v.proof) === value) ? value : null;
}

// The gate model by its column's label when a column runs on it ("Claude Haiku 5.5"), else its id.
export function gateModelLabel(views: readonly ColumnView[]): string | null {
  const id = sharedOf(views, (p) => p.gateModel);
  if (id === null) return null;
  return views.find((v) => v.columnId === id)?.label ?? id;
}
