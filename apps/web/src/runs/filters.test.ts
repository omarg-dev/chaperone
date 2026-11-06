import { describe, expect, it } from "vitest";
import { escalated, run } from "../test-utils";
import {
  applyFilters,
  type Filters,
  filtersToParams,
  isFiltered,
  NO_FILTERS,
  parseFilters,
} from "./filters";

const at = "2026-10-24T10:00:00Z";
const parse = (query: string) => parseFilters(new URLSearchParams(query));
const filter = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

describe("the filters in the address", () => {
  it("reads every filter, and writes them back the same way", () => {
    const query = "outcome=blocked&firewall=full&scenario=sc_a01&kind=attack&q=mvsq&sort=-scenario";
    const filters = parse(query);
    expect(filters).toEqual({
      outcome: "blocked",
      config: "full",
      scenario: "sc_a01",
      kind: "attack",
      query: "mvsq",
      sort: { column: "scenario", direction: "desc" },
    });
    expect(filtersToParams(filters).toString()).toBe(query);
  });

  it("gives the plain history a plain address", () => {
    expect(parse("")).toEqual(NO_FILTERS);
    expect(filtersToParams(NO_FILTERS).toString()).toBe("");
    expect(isFiltered(NO_FILTERS)).toBe(false);
    // A sort changes the order, not which runs are shown.
    expect(isFiltered(filter({ sort: { column: "verdict", direction: "asc" } }))).toBe(false);
    expect(isFiltered(filter({ kind: "benign" }))).toBe(true);
  });

  it("leaves out a value that means nothing, such as one from an old link", () => {
    expect(parse("outcome=exploded&firewall=max&kind=both&sort=cost&q=%20%20")).toEqual(NO_FILTERS);
    expect(parse("sort=-").sort).toEqual(NO_FILTERS.sort);
  });

  it("ignores the page an old link names, since the history isn't paged any more", () => {
    expect(parse("outcome=blocked&page=3")).toEqual(filter({ outcome: "blocked" }));
    expect(filtersToParams(parse("page=3&kind=attack")).toString()).toBe("kind=attack");
  });

  it("writes a sort only when it differs from newest first", () => {
    expect(filtersToParams(filter({ sort: { column: "started", direction: "desc" } })).size).toBe(
      0,
    );
    expect(
      filtersToParams(filter({ sort: { column: "started", direction: "asc" } })).toString(),
    ).toBe("sort=started");
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

  it("searches a scenario by its ID or the title it is shown under", () => {
    const titles = { sc_a01: "Wireless tactile keyboard", sc_b01: "Tactile keyboard under $120" };
    const found = (query: string) =>
      applyFilters(runs, filter({ query }), titles).map((r) => r.runId);
    expect(found("wireless")).toEqual(["run_ab12", "run_cd34"]);
    expect(found("UNDER $120")).toEqual(["run_ef56", "run_gh78", "run_kl12", "run_mn34"]);
    expect(found("sc_a")).toEqual(["run_ab12", "run_cd34"]);
    // Without the titles it still finds a run by its IDs, and a run with no scenario by its own.
    expect(applyFilters(runs, filter({ query: "wireless" }))).toEqual([]);
    expect(found("ij90")).toEqual(["run_ij90"]);
  });

  it("combines them", () => {
    expect(ids({ kind: "attack", config: "full" })).toEqual(["run_cd34"]);
    expect(ids({ kind: "benign", outcome: "blocked" })).toEqual([]);
  });
});
