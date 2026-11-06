// How the history is laid out, kept in the address beside the filters (`group=scenario`) so a grouped
// view can be shared. It isn't a filter: it says how the runs are drawn, not which, so it isn't part of
// `Filters`, and "Clear filters" leaves it as it is, like the sort.

// A value that means nothing (an old link, a typo) is no grouping.
export const parseGrouped = (params: URLSearchParams): boolean =>
  params.get("group") === "scenario";

// The address for these filters, with or without the grouping.
export function withGrouping(params: URLSearchParams, grouped: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  if (grouped) next.set("group", "scenario");
  else next.delete("group");
  return next;
}
