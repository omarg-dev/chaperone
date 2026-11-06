import type { RunSummary } from "../api";
import { CONFIGS, configOf, OUTCOMES, outcomeOf, type RunOutcome } from "./state";

// The history's filters, kept in the URL query so a filtered view can be shared. Pure: the page
// reads them from the address, and the same functions write them back.
//
//   outcome=blocked   firewall=full   scenario=sc_a01   kind=attack   q=mvsq   page=2

export const PAGE_SIZE = 50;

export type Kind = "attack" | "benign";

export interface Filters {
  outcome: RunOutcome | null;
  // The firewall configuration of the run's last review.
  config: string | null;
  scenario: string | null;
  kind: Kind | null;
  // Part of a run ID, in any case.
  query: string;
  page: number;
}

export const NO_FILTERS: Filters = {
  outcome: null,
  config: null,
  scenario: null,
  kind: null,
  query: "",
  page: 1,
};

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.find((candidate) => candidate === value) ?? null;

// A value the address carries that means nothing (an old link, a typo) is left out, not an error.
export function parseFilters(params: URLSearchParams): Filters {
  const page = Number(params.get("page"));
  return {
    outcome: oneOf(params.get("outcome"), OUTCOMES),
    config: oneOf(params.get("firewall"), CONFIGS),
    scenario: params.get("scenario") || null,
    kind: oneOf(params.get("kind"), ["attack", "benign"] as const),
    query: params.get("q")?.trim() ?? "",
    page: Number.isInteger(page) && page > 1 ? page : 1,
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
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export const isFiltered = (filters: Filters) =>
  filters.outcome !== null ||
  filters.config !== null ||
  filters.scenario !== null ||
  filters.kind !== null ||
  filters.query !== "";

export function applyFilters(runs: readonly RunSummary[], filters: Filters): RunSummary[] {
  const needle = filters.query.toLowerCase();
  return runs.filter(
    (run) =>
      (!filters.outcome || outcomeOf(run) === filters.outcome) &&
      (!filters.config || configOf(run) === filters.config) &&
      (!filters.scenario || run.scenarioId === filters.scenario) &&
      (!filters.kind || run.kind === filters.kind) &&
      (!needle || run.runId.toLowerCase().includes(needle)),
  );
}

export interface Page<T> {
  items: T[];
  // The page actually shown: a page past the end falls back to the last one.
  page: number;
  pages: number;
  total: number;
  // 1-based positions of the first and last item shown, 0 and 0 when there are none.
  from: number;
  to: number;
}

export function paginate<T>(items: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const shown = Math.min(Math.max(1, page), pages);
  const start = (shown - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: shown,
    pages,
    total: items.length,
    from: slice.length > 0 ? start + 1 : 0,
    to: start + slice.length,
  };
}
