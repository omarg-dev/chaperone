import { describe, expect, it } from "vitest";
import { escalated, run } from "../test-utils";
import {
  applyFilters,
  type Filters,
  filtersToParams,
  isFiltered,
  NO_FILTERS,
  PAGE_SIZE,
  paginate,
  parseFilters,
} from "./filters";

const at = "2026-10-24T10:00:00Z";
const parse = (query: string) => parseFilters(new URLSearchParams(query));
const filter = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

describe("the filters in the address", () => {
  it("reads every filter, and writes them back the same way", () => {
    const query = "outcome=blocked&firewall=full&scenario=sc_a01&kind=attack&q=mvsq&page=3";
    const filters = parse(query);
    expect(filters).toEqual({
      outcome: "blocked",
      config: "full",
      scenario: "sc_a01",
      kind: "attack",
      query: "mvsq",
      page: 3,
    });
    expect(filtersToParams(filters).toString()).toBe(query);
  });

  it("gives the plain history a plain address", () => {
    expect(parse("")).toEqual(NO_FILTERS);
    expect(filtersToParams(NO_FILTERS).toString()).toBe("");
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered(filter({ page: 4 }))).toBe(false);
    expect(isFiltered(filter({ kind: "benign" }))).toBe(true);
  });

  it("leaves out a value that means nothing, such as one from an old link", () => {
    expect(parse("outcome=exploded&firewall=max&kind=both&page=-2&q=%20%20")).toEqual(NO_FILTERS);
    expect(parse("page=abc").page).toBe(1);
    expect(parse("page=2.5").page).toBe(1);
  });
});

describe("applying the filters", () => {
  const runs = [
    run("run_ab12", "sc_a01", at, {
      kind: "attack",
      decidedBy: "no_review",
      attackerPaid: true,
      reviews: ["off"],
    }),
    run("run_cd34", "sc_a01", at, {
      kind: "attack",
      verdict: "block",
      decidedBy: "review",
      reviews: ["off", "gate0", "full"],
    }),
    run("run_ef56", "sc_b01", at, {
      kind: "benign",
      verdict: "approve",
      decidedBy: "review",
      reviews: ["full"],
    }),
    run("run_gh78", "sc_b01", at, { kind: "benign", ...escalated.waiting, reviews: ["gate0"] }),
    run("run_ij90", null, at),
    // Decided, but the platform hasn't moved the money: still held for a person.
    run("run_kl12", "sc_b01", at, { kind: "benign", ...escalated.unfinished("approve") }),
    // An eval cell's escalation, its hold voided with nobody deciding.
    run("run_mn34", "sc_b01", at, { kind: "benign", ...escalated.released, reviews: ["full"] }),
  ];
  const ids = (filters: Partial<Filters>) =>
    applyFilters(runs, filter(filters)).map((r) => r.runId);

  it("keeps everything with no filters", () => {
    expect(ids({})).toEqual(runs.map((r) => r.runId));
  });

  it("filters by outcome", () => {
    expect(ids({ outcome: "attacker_paid" })).toEqual(["run_ab12"]);
    expect(ids({ outcome: "blocked" })).toEqual(["run_cd34"]);
    expect(ids({ outcome: "approved" })).toEqual(["run_ef56"]);
    expect(ids({ outcome: "held" })).toEqual(["run_gh78", "run_kl12"]);
    expect(ids({ outcome: "released" })).toEqual(["run_mn34"]);
    expect(ids({ outcome: "not_reviewed" })).toEqual(["run_ij90"]);
    expect(ids({ outcome: "firewall_off" })).toEqual([]);
  });

  it("filters by the firewall setting the outcome comes from, the last review's", () => {
    expect(ids({ config: "full" })).toEqual(["run_cd34", "run_ef56", "run_mn34"]);
    expect(ids({ config: "off" })).toEqual(["run_ab12"]);
    expect(ids({ config: "gate0" })).toEqual(["run_gh78"]);
  });

  it("filters by scenario, and by attack or benign", () => {
    const benign = ["run_ef56", "run_gh78", "run_kl12", "run_mn34"];
    expect(ids({ scenario: "sc_b01" })).toEqual(benign);
    expect(ids({ kind: "attack" })).toEqual(["run_ab12", "run_cd34"]);
    expect(ids({ kind: "benign" })).toEqual(benign);
  });

  it("searches a run ID by any part of it, in any case", () => {
    expect(ids({ query: "CD34" })).toEqual(["run_cd34"]);
    expect(ids({ query: "run_" })).toHaveLength(7);
    expect(ids({ query: "nothing" })).toEqual([]);
  });

  it("combines them", () => {
    expect(ids({ kind: "attack", config: "full" })).toEqual(["run_cd34"]);
    expect(ids({ kind: "benign", outcome: "blocked" })).toEqual([]);
  });
});

describe("paging", () => {
  const items = Array.from({ length: 130 }, (_, i) => i);

  it("shows a page at a time, and says which", () => {
    const first = paginate(items, 1);
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first).toMatchObject({ page: 1, pages: 3, total: 130, from: 1, to: 50 });
    expect(paginate(items, 3)).toMatchObject({ from: 101, to: 130 });
    expect(paginate(items, 3).items).toHaveLength(30);
  });

  it("falls back to the last page when the address asks for one past the end", () => {
    expect(paginate(items, 9)).toMatchObject({ page: 3, from: 101 });
    expect(paginate(items, 0).page).toBe(1);
  });

  it("has a single empty page with nothing in it", () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
  });
});
