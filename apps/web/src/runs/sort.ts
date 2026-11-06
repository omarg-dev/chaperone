import type { RunSummary } from "../api";
import { CONFIGS, configOf, outcomeRank } from "./state";

// How the history is ordered, kept in the address as `sort=started` (oldest first), `sort=-started`
// (newest first) or the same for another column, so a sorted view can be shared. Pure: the grid
// sorts with `compareRuns`, the page reads and writes the address with these, and the tests check
// the order without a grid.

export const SORT_COLUMNS = ["scenario", "started", "firewall", "verdict"] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = "asc" | "desc";

export interface Sort {
  column: SortColumn;
  direction: SortDirection;
}

// Newest first, which is the order the server sends and the order the plain address has.
export const DEFAULT_SORT: Sort = { column: "started", direction: "desc" };

export const isDefaultSort = (sort: Sort) =>
  sort.column === DEFAULT_SORT.column && sort.direction === DEFAULT_SORT.direction;

// A value the address carries that means nothing (an old link, a typo) is the default order.
export function parseSort(value: string | null): Sort {
  if (!value) return DEFAULT_SORT;
  const direction: SortDirection = value.startsWith("-") ? "desc" : "asc";
  const name = direction === "desc" ? value.slice(1) : value;
  const column = SORT_COLUMNS.find((candidate) => candidate === name);
  return column ? { column, direction } : DEFAULT_SORT;
}

// Null for the default order, so the plain history has a plain address.
export const sortToParam = (sort: Sort): string | null =>
  isDefaultSort(sort) ? null : `${sort.direction === "desc" ? "-" : ""}${sort.column}`;

// The firewall setting's place among the settings, with a run that no review reached after them.
const configRank = (run: RunSummary): number => {
  const config = configOf(run);
  const index = (CONFIGS as readonly (string | null)[]).indexOf(config);
  if (index >= 0) return index;
  return config === null ? CONFIGS.length + 1 : CONFIGS.length;
};

const time = (run: RunSummary) => Date.parse(run.startedAt) || 0;

// What the scenario column shows first: the title when the server knows it, else the ID.
export const scenarioName = (run: RunSummary, titles: Record<string, string>): string =>
  run.scenarioId ? (titles[run.scenarioId] ?? run.scenarioId) : "";

// Ascending order of one column. Equal runs compare equal, so a stable sort keeps the order they
// came in (newest first) among them.
export function compareRuns(
  a: RunSummary,
  b: RunSummary,
  column: SortColumn,
  titles: Record<string, string> = {},
): number {
  switch (column) {
    case "scenario": {
      const [x, y] = [scenarioName(a, titles), scenarioName(b, titles)];
      return x.localeCompare(y, "en", { numeric: true });
    }
    case "started":
      return time(a) - time(b);
    case "firewall":
      return configRank(a) - configRank(b);
    case "verdict":
      return outcomeRank(a) - outcomeRank(b);
  }
}

export function sortRuns(
  runs: readonly RunSummary[],
  sort: Sort,
  titles: Record<string, string> = {},
): RunSummary[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...runs].sort((a, b) => sign * compareRuns(a, b, sort.column, titles));
}
