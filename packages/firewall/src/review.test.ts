import { afterEach, describe, expect, it } from "vitest";
import { findGate2Case, type Gate2CaseRun, runGate2Case } from "./gate2-cases.js";
import { CONFIG_GATES, FIREWALL_CONFIGS, type FirewallConfig, runReview } from "./review.js";
import { gatesReplaying, loadGate2Recording } from "./test-helpers.js";

// The review tree over the Gate 2 fixture cases: real gates, with the models' answers replayed from
// the recordings made for Gate 2's tests. Nothing calls a model or the network.

let run: Gate2CaseRun | undefined;
afterEach(() => run?.close());

async function review(name: string, config: FirewallConfig) {
  run = await runGate2Case(findGate2Case(name));
  const replaying = gatesReplaying(run.catalog, loadGate2Recording(name));
  const result = await runReview(run.runId, { log: run.log, config, gates: replaying });
  const events = run.log.listRun(run.runId);
  const lane = (l: string) => events.filter((e) => e.lane === l);
  return { result, events, lane, replaying, run };
}

describe("the review tree", () => {
  it("runs Gate 0, then Gate 1, then Gate 2, and combines their verdicts", async () => {
    const { result, lane, events } = await review("honest", "full");
    expect(result.gates.map((g) => g.gate)).toEqual(["gate0", "gate1", "gate2"]);
    expect(result.verdict).toBe("approve");
    expect(result.skipped).toEqual([]);
    // The gates wrote to their own lanes in that order.
    const firstOf = (l: string) => events.findIndex((e) => e.lane === l);
    expect(firstOf("gate0")).toBeLessThan(firstOf("gate1"));
    expect(firstOf("gate1")).toBeLessThan(firstOf("gate2"));
    // Gate 2 was handed Gate 1's verdict.
    const gate2Start = lane("gate2").find((e) => e.type === "gate2_started");
    expect(JSON.stringify(gate2Start?.payload)).toContain(result.gates[1]?.verdictEventId);
  });

  it("ends the review at a Gate 0 block, with no model call and no cost", async () => {
    const { result, lane, replaying } = await review("wrong_product", "full");
    expect(result.verdict).toBe("block");
    expect(result.gates.map((g) => g.gate)).toEqual(["gate0"]);
    expect(result.skipped.map((s) => s.gate)).toEqual(["gate1", "gate2"]);
    expect(result.skipped[0]?.reason).toContain("gate0 blocked");
    expect(lane("gate1")).toEqual([]);
    expect(lane("gate2")).toEqual([]);
    expect(replaying.replay.sent()).toBe(0);
    expect(result.costUsd).toBe(0);
  });

  it("still runs the model gates after a Gate 0 escalation, and the worst verdict wins", async () => {
    const { result } = await review("unrequested_extra", "full");
    expect(result.gates[0]?.verdict).toBe("escalate");
    expect(result.gates.map((g) => g.gate)).toEqual(["gate0", "gate1", "gate2"]);
    expect(result.verdict).toBe("escalate");
  });

  it("records review_started and review_finished with each gate's verdict, event and cost", async () => {
    const { result, lane, events } = await review("honest", "full");
    const [started, finished] = lane("review");
    expect(started?.type).toBe("review_started");
    expect(finished?.type).toBe("review_finished");
    expect(finished?.eventId).toBe(result.finishedEventId);
    expect(finished?.parentId).toBe(started?.eventId);
    expect(started?.parentId).toBe(result.checkoutEventId);
    expect(started?.provenance).toBe("system");
    const payload = finished?.payload as {
      verdict: string;
      costUsd: number;
      gates: { gate: string; verdict: string; verdictEventId: string; costUsd: number }[];
    };
    expect(payload.verdict).toBe("approve");
    for (const g of payload.gates) {
      const gateEvent = events.find((e) => e.eventId === g.verdictEventId);
      expect(gateEvent?.lane).toBe(g.gate);
      expect(gateEvent?.type).toBe("verdict");
    }
    // The gates' own events carry the spend; the review's events carry none, so nothing counts twice.
    const gateSpend = events
      .filter((e) => e.lane.startsWith("gate"))
      .reduce((sum, e) => sum + e.costUsd, 0);
    expect(payload.costUsd).toBeCloseTo(gateSpend, 10);
    expect(payload.costUsd).toBeGreaterThan(0);
    expect(lane("review").every((e) => e.costUsd === 0)).toBe(true);
    expect(result.costUsd).toBe(payload.costUsd);
  });

  it("lists the gates each configuration runs, with Gate 3 still to come", () => {
    expect(FIREWALL_CONFIGS).toEqual(["off", "gate0", "full"]);
    expect(CONFIG_GATES).toEqual({ off: [], gate0: ["gate0"], full: ["gate0", "gate1", "gate2"] });
  });
});

describe("the firewall configurations", () => {
  it("off reviews nothing: no gate runs, and the verdict is null", async () => {
    const { result, lane } = await review("wrong_product", "off");
    expect(result.verdict).toBeNull();
    expect(result.gates).toEqual([]);
    for (const l of ["gate0", "gate1", "gate2"]) expect(lane(l)).toEqual([]);
    expect(lane("review").map((e) => e.type)).toEqual(["review_started", "review_finished"]);
  });

  it("gate0 runs the policy rules only", async () => {
    const { result, lane, replaying } = await review("wrong_product", "gate0");
    expect(result.verdict).toBe("block");
    expect(result.gates.map((g) => g.gate)).toEqual(["gate0"]);
    expect(result.skipped).toEqual([]);
    expect(lane("gate1")).toEqual([]);
    expect(replaying.replay.sent()).toBe(0);
  });

  it("gate0 lets through what the rules can't see, which the model gates then catch", async () => {
    // A verified store's honest-looking listing whose page steers the purchase: no rule is broken.
    const alone = await review("steered", "gate0");
    expect(alone.result.verdict).toBe("approve");
    run?.close();
    const full = await review("steered", "full");
    expect(full.result.gates[0]?.verdict).toBe("approve");
    expect(full.result.verdict).toBe("escalate");
  });

  it("full without the model gates is refused", async () => {
    run = await runGate2Case(findGate2Case("honest"));
    await expect(runReview(run.runId, { log: run.log, config: "full" })).rejects.toThrow(
      /needs the model gates/,
    );
  });

  it("a run that hasn't checked out has nothing to review", async () => {
    run = await runGate2Case({ ...findGate2Case("honest"), shop: () => {} });
    await expect(runReview(run.runId, { log: run.log, config: "gate0" })).rejects.toThrow(
      /no checkout/,
    );
  });

  it("a gate that breaks leaves review_failed and no verdict, so nothing gets enforced", async () => {
    run = await runGate2Case(findGate2Case("honest"));
    const gates = gatesReplaying(run.catalog, loadGate2Recording("honest"));
    const broken = {
      ...gates,
      extractor: {
        ...gates.extractor,
        extract: async () => {
          throw new Error("the network is down");
        },
      },
    };
    await expect(
      runReview(run.runId, { log: run.log, config: "full", gates: broken }),
    ).rejects.toThrow("the network is down");
    const types = run.log
      .listRun(run.runId)
      .filter((e) => e.lane === "review")
      .map((e) => e.type);
    expect(types).toEqual(["review_started", "review_failed"]);
  });
});
