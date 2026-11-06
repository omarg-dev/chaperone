import type { RunSummary } from "../api";
import { DEFAULT_SORT, parseSort, type Sort, sortToParam } from "./sort";
import { CONFIGS, configOf, OUTCOMES, outcomeOf, type RunOutcome } from "./state";

// The history's filters and its sort, kept in the URL query so a filtered view can be shared. Pure:
// the page reads them from the address, and the same functions write them back. These are the one
// way the history is filtered: the grid is given the rows that pass and draws them, so what the page
// says (the count, "no runs match") never has to be read back from the grid.
//
//   outcome=blocked   firewall=full   scenario=sc_a01   kind=attack   q=mvsq   sort=-started
//
// An old link's `page=2` is ignored: the history isn't paged any more, the grid draws the rows that
// are in view as they scroll.

export type Kind = "attack" | "benign";

export interface Filters {
  outcome: RunOutcome | null;
  // The firewall configuration of the run's last review.
  config: string | null;
  scenario: string | null;
  kind: Kind | null;
  // Part of a run ID, a scenario ID or a scenario's title, in any case.
  query: string;
  sort: Sort;
}

export const NO_FILTERS: Filters = {
  outcome: null,
  config: null,
  scenario: null,
  kind: null,
  query: "",
  sort: DEFAULT_SORT,
};

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.find((candidate) => candidate === value) ?? null;

// A value the address carries that means nothing (an old link, a typo) is left out, not an error.
export function parseFilters(params: URLSearchParams): Filters {
  return {
    outcome: oneOf(params.get("outcome"), OUTCOMES),
    config: oneOf(params.get("firewall"), CONFIGS),
    scenario: params.get("scenario") || null,
    kind: oneOf(params.get("kind"), ["attack", "benign"] as const),
    query: params.get("q")?.trim() ?? "",
    sort: parseSort(params.get("sort")),
  };
}

// Only what differs from "show everything" is written, so the plain history has a plain address.
export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.config) params.set("firewall", filters.config);
  if (filters.scenario) params.set("scenario", filters.scenario);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.query) params.set("q", filters.query);
  const sort = sortToParam(filters.sort);
  if (sort) params.set("sort", sort);
  return params;
}

export const isFiltered = (filters: Filters) =>
  filters.outcome !== null ||
  filters.config !== null ||
  filters.scenario !== null ||
  filters.kind !== null ||
  filters.query !== "";

// `titles` are the scenarios' titles by ID, for the search to find a run by the name it is shown under.
export function applyFilters(
  runs: readonly RunSummary[],
  filters: Filters,
  titles: Record<string, string> = {},
): RunSummary[] {
  const needle = filters.query.toLowerCase();
  return runs.filter(
    (run) =>
      (!filters.outcome || outcomeOf(run) === filters.outcome) &&
      (!filters.config || configOf(run) === filters.config) &&
      (!filters.scenario || run.scenarioId === filters.scenario) &&
      (!filters.kind || run.kind === filters.kind) &&
      (!needle || searchable(run, titles).includes(needle)),
  );
}

const searchable = (run: RunSummary, titles: Record<string, string>) =>
  [run.runId, run.scenarioId, run.scenarioId ? titles[run.scenarioId] : null]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
