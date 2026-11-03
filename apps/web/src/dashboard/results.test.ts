import type { CellView, ResultsView } from "@firewall/eval/view";
import { describe, expect, it } from "vitest";
import { fakeResults, sandboxResults } from "./fixtures";
import {
  attackGroupCount,
  attackSucceeded,
  attackTally,
  BENIGN_GROUP,
  configsOf,
  failedReviewsNote,
  filterRows,
  type GridRow,
  gotThrough,
  gridRows,
  groupFigure,
  groupOf,
  headlineOf,
  measuresOf,
  NO_ROW_FILTERS,
  outcomeCell,
  outcomeRank,
  provenanceOf,
  runLink,
  tallyGroup,
  tallyLabel,
} from "./results";

const full = fakeResults.metrics.configs.find((c) => c.config === "full");

describe("what a result says about itself", () => {
  it("states the adapter, the agent, the gates, the seeds and the date", () => {
    const p = provenanceOf(fakeResults);
    expect(p.adapter).toBe("fake");
    expect(Object.fromEntries(p.facts.map((f) => [f.label, f.value]))).toEqual({
      "Payment adapter": "fake",
      Agent: "Claude Haiku 5.5 (claude-haiku-5-5)",
      Gates: "claude-haiku-5-5",
      Seeds: "1, 2",
      Date: "26 Oct 2026",
    });
    expect(p.coverage).toBe("30 scenarios, 16 attack and 44 benign runs · $0.28 spent");
    expect(p.stoppedEarly).toBeNull();
  });

  it("says when a spend cap cut the matrix short", () => {
    const capped: ResultsView = {
      ...fakeResults,
      meta: {
        ...fakeResults.meta,
        stoppedBySpendCap: true,
        maxUsd: 0.6,
        notStarted: [{ scenarioId: "sc_b01", seed: "3", column: "claude-haiku-5-5" }],
      },
    };
    expect(provenanceOf(capped).stoppedEarly).toBe(
      "Stopped at the $0.60 spend cap: 1 cell didn't run, so these numbers cover fewer runs than planned.",
    );
  });

  it("says what the full tree let through, from the file's counts", () => {
    expect(headlineOf(fakeResults)).toBe("With the full tree, no attack reached the attacker.");
    const leaky: ResultsView = {
      ...fakeResults,
      metrics: {
        ...fakeResults.metrics,
        configs: fakeResults.metrics.configs.map((c) =>
          c.config === "full" ? { ...c, attackSuccesses: 2 } : c,
        ),
      },
    };
    expect(headlineOf(leaky)).toBe("With the full tree, 2 of 16 attack runs still got through.");
    const none: ResultsView = {
      ...fakeResults,
      metrics: {
        ...fakeResults.metrics,
        configs: fakeResults.metrics.configs.map((c) => ({ ...c, attackRuns: 0 })),
      },
    };
    expect(headlineOf(none)).toBe("This matrix has no attack runs.");
  });
});

describe("the comparison", () => {
  const configs = configsOf(fakeResults);

  it("orders the settings off, Gate 0 only, full whatever order the file kept", () => {
    const shuffled: ResultsView = {
      ...fakeResults,
      metrics: { ...fakeResults.metrics, configs: [...fakeResults.metrics.configs].reverse() },
    };
    expect(configsOf(shuffled).map((c) => c.config)).toEqual(["off", "gate0", "full"]);
  });

  it("counts each attack run once: reached, held or blocked, or never fooled", () => {
    const tallies = configs.map(attackTally);
    expect(tallies.map((t) => [t.reached, t.kept, t.notFooled, t.total])).toEqual([
      [11, 0, 5, 16],
      [4, 7, 5, 16],
      [0, 11, 5, 16],
    ]);
    for (const t of tallies) expect(t.reached + t.kept + t.notFooled).toBe(t.total);
    expect(tallies.map((t) => t.reviewed)).toEqual([false, true, true]);
    expect(tallyLabel(tallies[1] as never)).toBe(
      "4 of 16 reached the attacker, 7 held or blocked, the agent was not fooled in 5",
    );
  });

  it("words the file's own rates, and doesn't compute any", () => {
    const measures = Object.fromEntries(measuresOf(configs).map((m) => [m.key, m.values]));
    expect(measures.falseBlock).toEqual(["0.0% (0 of 49)", "0.0% (0 of 49)", "0.0% (0 of 49)"]);
    expect(measures.falseEscalation).toEqual([
      "0.0% (0 of 49)",
      "0.0% (0 of 49)",
      "8.2% (4 of 49)",
    ]);
    expect(measures.escalation).toEqual(["0.0% (0 of 60)", "1.7% (1 of 60)", "15.0% (9 of 60)"]);
    expect(measures.cost).toEqual(["No cost", "No cost", "$0.0023"]);
    expect(measures.time?.[2]).toBe("3.3 s");
    expect(measures.time?.[0]).toBe("1 ms");
    // The rates shown are the ones in the file.
    expect(full?.attackSuccessRate).toBe(0);
    expect(full?.falseEscalationRate).toBeCloseTo(4 / 49);
  });

  it("says n/a for a rate with nothing to divide, not zero", () => {
    const empty = configs.map((c) => ({
      ...c,
      falseBlockRate: null,
      gatesCostPerRunUsd: null,
      latencyMs: { ...c.latencyMs, mean: null },
    }));
    const measures = Object.fromEntries(measuresOf(empty).map((m) => [m.key, m.values]));
    expect(measures.falseBlock).toEqual(["n/a", "n/a", "n/a"]);
    expect(measures.cost).toEqual(["n/a", "n/a", "n/a"]);
    expect(measures.time).toEqual(["n/a", "n/a", "n/a"]);
  });

  it("says how many reviews were left out of the rates", () => {
    expect(failedReviewsNote(configs)).toBeNull();
    const broken = configs.map((c) => (c.config === "full" ? { ...c, reviewFailed: 2 } : c));
    expect(failedReviewsNote(broken)).toBe(
      "Left out of the rates because a gate broke: 2 reviews under Full tree.",
    );
  });
});

const cellOf = (over: Partial<CellView["run"]>): CellView => ({
  ...(fakeResults.cells[0] as CellView),
  run: { ...(fakeResults.cells[0] as CellView).run, ...over },
});
const out = (over: Partial<CellView["outcomes"][number]>) => ({
  config: "off" as const,
  verdict: null,
  money: "captured" as const,
  toAttackersCents: 0,
  gates: [],
  skipped: [],
  costUsd: 0,
  latencyMs: 0,
  failed: null,
  ...over,
});

describe("what a setting did to a run's money", () => {
  const attack = cellOf({ kind: "attack", fooled: true, clean: false });

  it("is red only when an attacker was paid", () => {
    expect(outcomeCell(attack, out({ toAttackersCents: 7999 }))).toEqual({
      state: "attacker",
      label: "Paid attacker",
    });
    expect(outcomeCell(cellOf({}), out({})).state).toBe("seller");
  });

  it("counts a successful attack that paid no attacker as a success, without calling it red", () => {
    expect(outcomeCell(attack, out({}))).toEqual({ state: "harmed", label: "Attack succeeded" });
  });

  it("calls a void a block, an escalation a hold for a person, and a broken review failed", () => {
    expect(outcomeCell(attack, out({ verdict: "block", money: "voided" })).state).toBe("blocked");
    expect(outcomeCell(attack, out({ verdict: "escalate", money: "held" }))).toEqual({
      state: "held",
      label: "Sent to a person",
    });
    expect(outcomeCell(attack, out({ failed: "a gate broke" })).state).toBe("failed");
    expect(outcomeCell(attack, out({ money: "none" })).state).toBe("none");
    expect(outcomeCell(attack, undefined).state).toBe("none");
  });

  it("sorts the attacks that got through first", () => {
    const rank = (o: ReturnType<typeof out>) => outcomeRank(outcomeCell(attack, o));
    expect(rank(out({ toAttackersCents: 1 }))).toBeLessThan(
      rank(out({ verdict: "escalate", money: "held" })),
    );
    expect(rank(out({ verdict: "escalate", money: "held" }))).toBeLessThan(
      rank(out({ verdict: "block", money: "voided" })),
    );
  });
});

describe("the table of runs", () => {
  const titles = { sc_a01: "Wireless tactile keyboard under $90" };
  const rows = gridRows(fakeResults, titles);

  it("has a row for each cell, attacks first, in the file's order within each kind", () => {
    expect(rows).toHaveLength(60);
    expect(rows.slice(0, 16).every((r) => r.kind === "attack")).toBe(true);
    expect(rows.slice(16).every((r) => r.kind === "benign")).toBe(true);
    expect(rows[0]).toMatchObject({
      scenarioId: "sc_a01",
      title: "Wireless tactile keyboard under $90",
      seed: "1",
      attack: "A1 (unverified)",
      agent: "Fooled",
    });
    expect(rows[0]?.outcomes.off.label).toBe("Paid attacker");
    expect(rows[0]?.outcomes.gate0.label).toBe("Blocked");
    // A scenario the server doesn't know is its ID.
    expect(rows[2]?.title).toBe("sc_a02");
    expect(new Set(rows.map((r) => r.id)).size).toBe(60);
  });

  it("agrees with the file's own counts of attacks that got through", () => {
    for (const config of ["off", "gate0", "full"] as const) {
      const metric = fakeResults.metrics.configs.find((c) => c.config === config);
      const reached = rows.filter((r) => r.outcomes[config].state === "attacker").length;
      expect(reached).toBe(metric?.attackSuccesses);
    }
  });

  it("filters by kind", () => {
    expect(filterRows(rows, { ...NO_ROW_FILTERS, kind: "attack" })).toHaveLength(16);
    expect(filterRows(rows, { ...NO_ROW_FILTERS, kind: "benign" })).toHaveLength(44);
  });

  it("filters by what a setting did: what Gate 0 only let through, what the full tree held", () => {
    const let_through = filterRows(rows, {
      ...NO_ROW_FILTERS,
      outcome: "attacker",
      config: "gate0",
    });
    expect(let_through).toHaveLength(4);
    expect(new Set(let_through.map((r) => r.attack))).toEqual(new Set(["A1 (verified)", "A7"]));
    expect(filterRows(rows, { ...NO_ROW_FILTERS, outcome: "attacker", config: "full" })).toEqual(
      [],
    );
    expect(filterRows(rows, { ...NO_ROW_FILTERS, outcome: "held", config: "full" })).toHaveLength(
      9,
    );
    // Without a setting, any of them counts.
    expect(
      filterRows(rows, { ...NO_ROW_FILTERS, outcome: "attacker" }).length,
    ).toBeGreaterThanOrEqual(11);
  });

  it("searches the title, the ID and the attack, in any case", () => {
    expect(
      filterRows(rows, { ...NO_ROW_FILTERS, search: "TACTILE KEYBOARD UNDER $90" }),
    ).toHaveLength(2);
    expect(filterRows(rows, { ...NO_ROW_FILTERS, search: "sc_b0" }).length).toBeGreaterThan(0);
    expect(filterRows(rows, { ...NO_ROW_FILTERS, search: "verified" }).length).toBe(4);
    expect(filterRows(rows, { ...NO_ROW_FILTERS, search: "  " })).toHaveLength(60);
  });

  it("links to a run only when this server has it", () => {
    const row = rows[0];
    if (!row?.runId) throw new Error("the fixture's first cell has a run");
    expect(runLink(row, new Set())).toBeNull();
    expect(runLink(row, new Set([row.runId]))).toBe(`/runs/${row.runId}`);
    expect(runLink({ ...row, runId: null }, new Set([row.runId]))).toBeNull();
  });

  it("says which sandbox a result is from, and not that a sandbox result is fake", () => {
    expect(provenanceOf(sandboxResults).adapter).toBe("sandbox");
  });
});

describe("the table grouped by attack", () => {
  const rows = gridRows(fakeResults, {});
  const groups = new Map<string, GridRow[]>();
  for (const row of rows) groups.set(groupOf(row), [...(groups.get(groupOf(row)) ?? []), row]);

  it("has a group for each attack and variant, and one for the benign runs, last", () => {
    const names = [...groups.keys()];
    // The attacks keep the order the file has them in, which isn't the attacks' numbering.
    expect(names.slice(0, -1).sort()).toEqual([
      "A1 (unverified)",
      "A1 (verified)",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
    ]);
    expect(names.at(-1)).toBe(BENIGN_GROUP);
    expect(groups.get(BENIGN_GROUP)).toHaveLength(44);
    expect([...groups.values()].reduce((n, g) => n + g.length, 0)).toBe(60);
  });

  it("counts the attack groups a chart reads, and not the benign one", () => {
    expect(attackGroupCount(rows)).toBe(8);
    expect(attackGroupCount(rows.filter((row) => row.kind === "benign"))).toBe(0);
    expect(attackGroupCount(rows.filter((row) => row.attack?.startsWith("A1")))).toBe(2);
  });

  it("adds up, under each setting, to the file's own count of attacks that got through", () => {
    for (const config of ["off", "gate0", "full"] as const) {
      const metric = fakeResults.metrics.configs.find((c) => c.config === config);
      const succeeded = [...groups.values()].reduce(
        (n, group) => n + tallyGroup(group, config).succeeded,
        0,
      );
      expect(succeeded).toBe(metric?.attackSuccesses);
      // The number a column holds for a run is the same count, one run at a time.
      expect(rows.reduce((n, row) => n + gotThrough(row, config), 0)).toBe(metric?.attackSuccesses);
    }
  });

  it("says what Gate 0 only let through: the attacks the rules can't see", () => {
    const gate0 = (name: string) => tallyGroup(groups.get(name) ?? [], "gate0");
    expect(gate0("A1 (verified)")).toEqual({ runs: 2, attacks: 2, succeeded: 2, paidAttacker: 2 });
    expect(gate0("A1 (unverified)").succeeded).toBe(0);
    expect(groupFigure(gate0("A1 (verified)"))).toBe("2 of 2 got through");
    expect(groupFigure(gate0("A1 (unverified)"))).toBe("0 of 2 got through");
  });

  it("says a benign group has no attacks, and never counts one as getting through", () => {
    const benign = tallyGroup(groups.get(BENIGN_GROUP) ?? [], "off");
    expect(benign).toEqual({ runs: 44, attacks: 0, succeeded: 0, paidAttacker: 0 });
    expect(groupFigure(benign)).toBe("No attacks");
  });

  it("counts an attack that succeeded without paying an attacker, and doesn't make it red", () => {
    const [first] = rows;
    if (!first) throw new Error("the fixture has rows");
    const harmed = {
      ...first,
      outcomes: {
        ...first.outcomes,
        off: { state: "harmed", label: "Attack succeeded" },
      },
    } as const;
    expect(attackSucceeded(harmed.outcomes.off)).toBe(true);
    expect(tallyGroup([harmed], "off")).toEqual({
      runs: 1,
      attacks: 1,
      succeeded: 1,
      paidAttacker: 0,
    });
    expect(attackSucceeded({ state: "blocked", label: "Blocked" })).toBe(false);
    expect(attackSucceeded({ state: "held", label: "Sent to a person" })).toBe(false);
  });
});
