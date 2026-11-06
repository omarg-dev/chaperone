import { describe, expect, it } from "vitest";
import { escalated, run } from "../test-utils";
import {
  compareRuns,
  DEFAULT_SORT,
  isDefaultSort,
  parseSort,
  type Sort,
  sortRuns,
  sortToParam,
} from "./sort";

describe("the sort in the address", () => {
  it("reads ascending as the name and descending as a dash before it", () => {
    expect(parseSort("started")).toEqual({ column: "started", direction: "asc" });
    expect(parseSort("-started")).toEqual({ column: "started", direction: "desc" });
    expect(parseSort("-verdict")).toEqual({ column: "verdict", direction: "desc" });
    expect(parseSort("scenario")).toEqual({ column: "scenario", direction: "asc" });
    expect(parseSort("firewall")).toEqual({ column: "firewall", direction: "asc" });
  });

  it("is newest first when there is nothing, or nothing it knows", () => {
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
    expect(parseSort("")).toEqual(DEFAULT_SORT);
    expect(parseSort("cost")).toEqual(DEFAULT_SORT);
    expect(parseSort("-")).toEqual(DEFAULT_SORT);
    expect(isDefaultSort(DEFAULT_SORT)).toBe(true);
  });

  it("writes back what it read, and nothing for the default", () => {
    for (const value of ["started", "scenario", "-scenario", "firewall", "-firewall", "verdict"]) {
      expect(sortToParam(parseSort(value))).toBe(value);
    }
    expect(sortToParam(DEFAULT_SORT)).toBeNull();
  });
});

describe("ordering the runs", () => {
  const runs = [
    run("run_a", "sc_b01", "2026-10-24T10:00:00Z", {
      verdict: "approve",
      decidedBy: "review",
      reviews: ["full"],
    }),
    run("run_b", "sc_a01", "2026-10-24T12:00:00Z", {
      kind: "attack",
      decidedBy: "no_review",
      attackerPaid: true,
      reviews: ["off"],
    }),
    run("run_c", "sc_b02", "2026-10-23T09:00:00Z", { ...escalated.waiting, reviews: ["gate0"] }),
    run("run_d", null, "2026-10-25T08:00:00Z"),
    run("run_e", "sc_b10", "2026-10-22T08:00:00Z", {
      verdict: "block",
      decidedBy: "review",
      reviews: ["off", "gate0", "full"],
    }),
  ];
  const titles = {
    sc_a01: "Wireless keyboard",
    sc_b01: "Tactile keyboard",
    sc_b02: "Headphones",
    sc_b10: "Mouse",
  };
  const order = (sort: Sort) => sortRuns(runs, sort, titles).map((r) => r.runId);

  it("puts the newest first by default, and the oldest first when asked", () => {
    expect(order(DEFAULT_SORT)).toEqual(["run_d", "run_b", "run_a", "run_c", "run_e"]);
    expect(order({ column: "started", direction: "asc" })).toEqual([
      "run_e",
      "run_c",
      "run_a",
      "run_b",
      "run_d",
    ]);
  });

  it("sorts scenarios by the title they are shown under, a run with none first", () => {
    expect(order({ column: "scenario", direction: "asc" })).toEqual([
      "run_d",
      "run_c",
      "run_e",
      "run_a",
      "run_b",
    ]);
    expect(order({ column: "scenario", direction: "desc" }).at(-1)).toBe("run_d");
  });

  it("sorts the settings in their own order, a run no review reached last", () => {
    expect(order({ column: "firewall", direction: "asc" })).toEqual([
      "run_b",
      "run_c",
      "run_a",
      "run_e",
      "run_d",
    ]);
  });

  it("sorts verdicts with money that reached an attacker first, then what is waiting", () => {
    expect(order({ column: "verdict", direction: "asc" })).toEqual([
      "run_b",
      "run_c",
      "run_e",
      "run_a",
      "run_d",
    ]);
    expect(order({ column: "verdict", direction: "desc" })[0]).toBe("run_d");
  });

  it("keeps the order runs came in when they compare equal, whichever way it sorts", () => {
    const same = [
      run("run_1", "sc_b01", "2026-10-24T10:00:00Z", { verdict: "block", decidedBy: "review" }),
      run("run_2", "sc_b01", "2026-10-24T10:00:00Z", { verdict: "block", decidedBy: "review" }),
      run("run_3", "sc_b01", "2026-10-24T10:00:00Z", { verdict: "block", decidedBy: "review" }),
    ];
    for (const direction of ["asc", "desc"] as const) {
      expect(sortRuns(same, { column: "verdict", direction }).map((r) => r.runId)).toEqual([
        "run_1",
        "run_2",
        "run_3",
      ]);
    }
  });

  it("compares one column ascending, which is what the grid sorts with", () => {
    const [a, b] = runs as [(typeof runs)[number], (typeof runs)[number]];
    expect(compareRuns(a, b, "started")).toBeLessThan(0);
    expect(compareRuns(b, a, "started")).toBeGreaterThan(0);
    expect(compareRuns(a, a, "scenario", titles)).toBe(0);
  });

  it("does not change the runs it is given", () => {
    const before = runs.map((r) => r.runId);
    sortRuns(runs, { column: "verdict", direction: "asc" });
    expect(runs.map((r) => r.runId)).toEqual(before);
  });
});
