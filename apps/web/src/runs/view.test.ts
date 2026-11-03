import { describe, expect, it } from "vitest";
import { filtersToParams, NO_FILTERS, parseFilters } from "./filters";
import { parseGrouped, withGrouping } from "./view";

describe("the history's grouping, in the address", () => {
  it("is on only for the one value it knows, and means nothing otherwise", () => {
    expect(parseGrouped(new URLSearchParams("group=scenario"))).toBe(true);
    expect(parseGrouped(new URLSearchParams(""))).toBe(false);
    expect(parseGrouped(new URLSearchParams("group=outcome"))).toBe(false);
    expect(parseGrouped(new URLSearchParams("group="))).toBe(false);
  });

  it("is written beside the filters, and left out when off, so the plain history has a plain address", () => {
    const filters = { ...NO_FILTERS, kind: "attack" as const };
    const on = withGrouping(filtersToParams(filters), true);
    expect(on.toString()).toBe("kind=attack&group=scenario");
    expect(withGrouping(on, false).toString()).toBe("kind=attack");
    expect(withGrouping(filtersToParams(NO_FILTERS), false).toString()).toBe("");
  });

  it("is not a filter: the filters read the same with it on", () => {
    const params = new URLSearchParams("kind=attack&group=scenario");
    expect(parseFilters(params)).toEqual(parseFilters(new URLSearchParams("kind=attack")));
  });
});
