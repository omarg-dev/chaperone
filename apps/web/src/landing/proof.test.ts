import type { ResultsSummary, ResultsView } from "@firewall/eval/view";
import { describe, expect, it } from "vitest";
import { columnViews, headlineOf, proofOf, selectResults } from "./proof";

const file = (
  name: string,
  columnId: string,
  startedAt: string,
  over: Partial<ResultsSummary> = {},
): ResultsSummary => ({
  name,
  paymentAdapter: "sandbox",
  column: { columnId, label: columnId, modelId: columnId },
  gateModel: "claude-haiku-5-5",
  seeds: ["1"],
  scenarios: ["sc_a01", "sc_b01"],
  date: startedAt.slice(0, 10),
  startedAt,
  ...over,
});

describe("selectResults", () => {
  it("picks the newest sandbox file of our own scenarios for each column", () => {
    const picked = selectResults([
      file("old", "claude-haiku-5-5", "2026-11-06T10:00:00Z"),
      file("new", "claude-haiku-5-5", "2026-11-07T10:00:00Z"),
      file("gem", "gemini-3.5-flash-lite", "2026-11-07T11:00:00Z"),
    ]);
    expect(picked.columns.map((c) => c.file)).toEqual(["new", null, "gem"]);
    expect(picked.heldOut).toBeNull();
  });

  it("never picks a fake file, even when it is the newest", () => {
    const picked = selectResults([
      file("real", "claude-haiku-5-5", "2026-11-06T10:00:00Z"),
      file("fake", "claude-haiku-5-5", "2026-11-07T10:00:00Z", { paymentAdapter: "fake" }),
      file("only-fake", "gpt-6-luna", "2026-11-07T10:00:00Z", { paymentAdapter: "fake" }),
    ]);
    expect(picked.columns.map((c) => c.file)).toEqual(["real", null, null]);
  });

  it("keeps the held-out set apart from our own", () => {
    const picked = selectResults([
      file("own", "claude-haiku-5-5", "2026-11-06T10:00:00Z"),
      file("held", "claude-haiku-5-5", "2026-11-07T10:00:00Z", { scenarios: ["sc_h01", "sc_h02"] }),
    ]);
    expect(picked.columns[0]?.file).toBe("own");
    expect(picked.heldOut).toBe("held");
  });
});

const view = (over: { attackRuns?: number } = {}): ResultsView =>
  ({
    meta: {
      column: { label: "Claude Haiku 5.5" },
      date: "2026-11-07",
      seeds: ["1", "2"],
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
  it("takes the file's own counts and rates", () => {
    expect(proofOf(view())).toMatchObject({
      fooled: 23,
      off: { attackSuccesses: 23, attackSuccessRate: 0.71875 },
      full: { attackSuccesses: 1, attackSuccessRate: 0.03125 },
      cleanCarts: 97,
      falseBlocks: 0,
      falseEscalations: 1,
    });
  });

  it("has nothing to say for a file with no attack runs", () => {
    expect(proofOf(view({ attackRuns: 0 }))).toBeNull();
  });
});

describe("columnViews", () => {
  it("shows a column with no file, or an unread one, as running", () => {
    const selection = selectResults([file("a", "claude-haiku-5-5", "2026-11-07T10:00:00Z")]);
    const views = columnViews(selection, { a: view() });
    expect(views.map((v) => v.status)).toEqual(["ready", "running", "running"]);
    expect(columnViews(selection, {})[0]?.status).toBe("running");
    expect(headlineOf(views)?.columnId).toBe("claude-haiku-5-5");
    expect(headlineOf(columnViews(selectResults([]), {}))).toBeNull();
  });
});
