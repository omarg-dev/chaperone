import type { ResultsSummary, ResultsView } from "@firewall/eval/view";
import { describe, expect, it } from "vitest";
import { gateModelLabel, proofOf, proofViews, selectResults, sharedOf } from "./proof";

const file = (
  name: string,
  columnId: string,
  startedAt: string,
  over: Partial<ResultsSummary> = {},
): ResultsSummary => ({
  name,
  paymentAdapter: "sandbox",
  column: { columnId, label: `Label ${columnId}`, modelId: columnId },
  gateModel: "claude-haiku-5-5",
  seeds: ["1"],
  scenarios: ["sc_a01", "sc_b01"],
  date: startedAt.slice(0, 10),
  startedAt,
  ...over,
});

const held = { scenarios: ["sc_h01", "sc_h02"] };

describe("selectResults", () => {
  it("picks the newest sandbox file of our own scenarios for each model that has one", () => {
    const picked = selectResults([
      file("old", "claude-haiku-5-5", "2026-11-06T10:00:00Z"),
      file("new", "claude-haiku-5-5", "2026-11-07T10:00:00Z"),
      file("luna", "gpt-6-luna", "2026-11-07T11:00:00Z"),
    ]);
    expect(picked.own.map((p) => p.file)).toEqual(["new", "luna"]);
    expect(picked.heldOut).toEqual([]);
  });

  it("shows only models with a file, with no placeholder for one that never ran", () => {
    const picked = selectResults([file("luna", "gpt-6-luna", "2026-11-07T11:00:00Z")]);
    expect(picked.own.map((p) => p.columnId)).toEqual(["gpt-6-luna"]);
    expect(selectResults([])).toEqual({ own: [], heldOut: [] });
  });

  it("puts the known models first, in order, and any other after them by label", () => {
    const picked = selectResults([
      file("zeta", "zeta-model", "2026-11-07T12:00:00Z"),
      file("alpha", "alpha-model", "2026-11-07T12:00:00Z"),
      file("luna", "gpt-6-luna", "2026-11-07T12:00:00Z"),
      file("haiku", "claude-haiku-5-5", "2026-11-07T12:00:00Z"),
    ]);
    expect(picked.own.map((p) => p.file)).toEqual(["haiku", "luna", "alpha", "zeta"]);
  });

  it("never picks a fake file, even when it is the newest", () => {
    const picked = selectResults([
      file("real", "claude-haiku-5-5", "2026-11-06T10:00:00Z"),
      file("fake", "claude-haiku-5-5", "2026-11-07T10:00:00Z", { paymentAdapter: "fake" }),
      file("only-fake", "gpt-6-luna", "2026-11-07T10:00:00Z", { paymentAdapter: "fake" }),
      file("fake-held", "gpt-6-luna", "2026-11-07T10:00:00Z", {
        paymentAdapter: "fake",
        ...held,
      }),
    ]);
    expect(picked.own.map((p) => p.file)).toEqual(["real"]);
    expect(picked.heldOut).toEqual([]);
  });

  it("keeps the held-out set apart from our own, one file per model", () => {
    const picked = selectResults([
      file("own", "claude-haiku-5-5", "2026-11-06T10:00:00Z"),
      file("held-old", "claude-haiku-5-5", "2026-11-06T10:00:00Z", held),
      file("held", "claude-haiku-5-5", "2026-11-07T10:00:00Z", held),
      file("held-luna", "gpt-6-luna", "2026-11-07T10:00:00Z", held),
    ]);
    expect(picked.own.map((p) => p.file)).toEqual(["own"]);
    expect(picked.heldOut.map((p) => p.file)).toEqual(["held", "held-luna"]);
  });
});

const view = (over: { attackRuns?: number; label?: string; date?: string } = {}): ResultsView =>
  ({
    meta: {
      column: { label: over.label ?? "Claude Haiku 5.5" },
      date: over.date ?? "2026-11-07",
      seeds: ["1", "2"],
      scenarios: ["sc_h01", "sc_h02", "sc_h01"],
      gateModel: "claude-haiku-5-5",
    },
    metrics: {
      configs: [
        {
          config: "off",
          attackRuns: over.attackRuns ?? 32,
          attackFooled: 23,
          attackSuccesses: 23,
          attackSuccessRate: 0.71875,
          cleanCarts: 97,
          cleanBlocked: 0,
          cleanEscalated: 0,
        },
        {
          config: "full",
          attackRuns: over.attackRuns ?? 32,
          attackFooled: 23,
          attackSuccesses: 1,
          attackSuccessRate: 0.03125,
          cleanCarts: 97,
          cleanBlocked: 0,
          cleanEscalated: 1,
        },
      ],
    },
  }) as unknown as ResultsView;

describe("proofOf", () => {
  it("takes the file's own counts and rates, and what the full tree did to clean carts", () => {
    expect(proofOf(view())).toMatchObject({
      off: { attackSuccesses: 23, attackRuns: 32, attackSuccessRate: 0.71875 },
      full: { attackSuccesses: 1, attackRuns: 32, attackSuccessRate: 0.03125 },
      cleanCarts: 97,
      falseBlocks: 0,
      falseEscalations: 1,
      seeds: 2,
      scenarios: 2,
    });
  });

  it("has nothing to say for a file with no attack runs", () => {
    expect(proofOf(view({ attackRuns: 0 }))).toBeNull();
  });
});

describe("proofViews", () => {
  it("leaves out a model whose file wasn't read or has nothing to compare", () => {
    const picked = selectResults([
      file("a", "claude-haiku-5-5", "2026-11-07T10:00:00Z"),
      file("b", "gpt-6-luna", "2026-11-07T10:00:00Z"),
    ]).own;
    expect(proofViews(picked, { a: view() }).map((v) => v.file)).toEqual(["a"]);
    expect(proofViews(picked, { a: view(), b: view({ attackRuns: 0 }) })).toHaveLength(1);
    expect(proofViews(picked, {})).toEqual([]);
  });

  it("names a model by the label its file gives it", () => {
    const picked = selectResults([file("b", "gpt-6-luna", "2026-11-07T10:00:00Z")]).own;
    expect(proofViews(picked, { b: view({ label: "OpenAI GPT-6 Luna" }) })[0]?.label).toBe(
      "OpenAI GPT-6 Luna",
    );
  });
});

describe("what the views share", () => {
  const picked = selectResults([
    file("a", "claude-haiku-5-5", "2026-11-07T10:00:00Z"),
    file("b", "gpt-6-luna", "2026-11-07T10:00:00Z"),
  ]).own;

  it("is said once when every model agrees, and not at all when they differ", () => {
    const same = proofViews(picked, { a: view(), b: view({ label: "Luna" }) });
    expect(sharedOf(same, (p) => p.date)).toBe("2026-11-07");
    const apart = proofViews(picked, { a: view(), b: view({ date: "2026-11-08" }) });
    expect(sharedOf(apart, (p) => p.date)).toBeNull();
    expect(sharedOf([], (p) => p.date)).toBeNull();
  });

  it("names the gate model by its column's label when a column runs on it", () => {
    const views = proofViews(picked, { a: view(), b: view({ label: "Luna" }) });
    expect(gateModelLabel(views)).toBe("Claude Haiku 5.5");
    expect(gateModelLabel(views.slice(1))).toBe("claude-haiku-5-5");
  });
});
