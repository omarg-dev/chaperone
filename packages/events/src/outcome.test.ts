import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  escalationOf,
  facetsOf,
  holdStateOf,
  needsPerson,
  type OutcomeEvent,
  outcomeOf,
} from "./outcome.js";
import { type EventLog, openEventLog } from "./store.js";

const review = (type: string, payload: unknown): OutcomeEvent => ({
  lane: "review",
  type,
  payload,
});

describe("facetsOf", () => {
  it("is empty for a run with none of the events", () => {
    expect(facetsOf([])).toEqual({
      seed: null,
      reviews: [],
      paidPayees: [],
      origin: null,
      payments: null,
    });
  });

  it("reads the configurations in the order the reviews ran", () => {
    expect(
      facetsOf([
        review("review_started", { config: "off" }),
        review("review_started", { config: "full" }),
        // A review that doesn't say is the full tree, as the run view reads it.
        review("review_started", {}),
      ]).reviews,
    ).toEqual(["off", "full", "full"]);
  });

  it("takes the payouts of the last enforcement, and only the payees paid something", () => {
    const facets = facetsOf([
      review("enforced", { payouts: [{ payeeKey: "seller_1", amountCents: 100 }] }),
      review("enforced", {
        payouts: [
          { payeeKey: "attacker_1", amountCents: 250 },
          { payeeKey: "seller_3", amountCents: 0 },
          { amountCents: 5 },
          "junk",
        ],
      }),
    ]);
    expect(facets.paidPayees).toEqual(["attacker_1"]);
  });

  it("reads who started the run and which payment adapter holds its money", () => {
    const started = (payload: unknown): OutcomeEvent => ({
      lane: "arena",
      type: "run_started",
      payload,
    });
    expect(facetsOf([started({ seed: "1", origin: "web", payments: "fake" })])).toMatchObject({
      origin: "web",
      payments: "fake",
    });
    // A run from the eval or the command line says neither.
    expect(facetsOf([started({ seed: "1" })])).toMatchObject({ origin: null, payments: null });
    // Only the arena's run_started counts, and only text does.
    expect(
      facetsOf([
        { lane: "agent", type: "run_started", payload: { origin: "web" } },
        started({ origin: 3, payments: ["fake"] }),
      ]),
    ).toMatchObject({ origin: null, payments: null });
  });

  it("ignores a run_started that isn't the arena's or has no seed", () => {
    expect(
      facetsOf([{ lane: "agent", type: "run_started", payload: { seed: "9" } }]).seed,
    ).toBeNull();
    expect(
      facetsOf([{ lane: "arena", type: "run_started", payload: { seed: 1 } }]).seed,
    ).toBeNull();
    expect(facetsOf([{ lane: "arena", type: "run_started", payload: { seed: "2" } }]).seed).toBe(
      "2",
    );
  });
});

// A payment call the way `recordPayments` writes it: a result, or an error when the platform
// refused.
const payment = (
  operation: string,
  input: unknown[],
  outcome: { result: unknown } | { error: unknown },
) =>
  ({
    lane: "payments",
    type: "payment_call",
    payload: { operation, input, ...outcome },
  }) satisfies OutcomeEvent;
const authorized = (authorizationId: string, operation = "authorize_order") =>
  payment(operation, ["order_1"], { result: { authorizationId, status: "CREATED" } });
const closed = (operation: "capture" | "void", authorizationId: string) =>
  payment(operation, [authorizationId], { result: { authorizationId } });
const refused = (operation: "capture" | "void", authorizationId: string) =>
  payment(operation, [authorizationId], { error: { code: "platform_error", message: "down" } });
const verdict = (value: string | null) => review("review_finished", { verdict: value });
const decided = (decision: string): OutcomeEvent => ({
  lane: "human",
  type: "human_decision",
  payload: { decision },
});

describe("holdStateOf", () => {
  it("is open from the authorization until a capture or a void of it goes through", () => {
    expect(holdStateOf([])).toEqual({ authorizationId: null, closedBy: null });
    expect(holdStateOf([authorized("A1")])).toEqual({ authorizationId: "A1", closedBy: null });
    expect(holdStateOf([authorized("A1"), closed("void", "A1")]).closedBy).toBe("void");
    expect(holdStateOf([authorized("A1"), closed("capture", "A1")]).closedBy).toBe("capture");
  });

  it("is not closed by a call the platform refused, or by a call on another authorization", () => {
    expect(holdStateOf([authorized("A1"), refused("capture", "A1")]).closedBy).toBeNull();
    expect(holdStateOf([authorized("A1"), closed("void", "A0")]).closedBy).toBeNull();
  });

  it("follows a reauthorization: the fresh hold is the one that counts", () => {
    const events = [authorized("A1"), authorized("A2", "reauthorize")];
    expect(holdStateOf(events)).toEqual({ authorizationId: "A2", closedBy: null });
    expect(holdStateOf([...events, closed("capture", "A2")]).closedBy).toBe("capture");
    // A void of the hold it replaced doesn't close the fresh one.
    expect(holdStateOf([...events, closed("void", "A1")]).closedBy).toBeNull();
  });

  it("ignores payments events that aren't calls", () => {
    expect(
      holdStateOf([{ lane: "payments", type: "payment_webhook", payload: { operation: "void" } }]),
    ).toEqual({ authorizationId: null, closedBy: null });
  });
});

describe("escalationOf", () => {
  it("is the four states of an escalated run, and a person is needed in two", () => {
    expect(escalationOf(false, true)).toBe("waiting");
    expect(escalationOf(false, false)).toBe("released");
    expect(escalationOf(true, true)).toBe("unfinished");
    expect(escalationOf(true, false)).toBe("decided");
    expect(escalationOf(true, false, false)).toBe("unfinished");
    expect(
      ["waiting", "unfinished", "released", "decided", null].map((e) => needsPerson(e as never)),
    ).toEqual([true, true, false, false, false]);
  });
});

describe("outcomeOf, on a real event log", () => {
  let dir: string;
  let log: EventLog;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "outcome-"));
    log = openEventLog({ path: join(dir, "events.db") });
  });
  afterEach(() => {
    log.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Writes a run's events and reads its summary two ways: the run list's single query, and the pure
  // function over the run's own events. They must agree, since the web reads the second.
  function summarise(runId: string, events: OutcomeEvent[]) {
    for (const e of events) {
      log.append({
        runId,
        lane: e.lane as never,
        type: e.type,
        provenance: e.lane === "human" ? "user" : "system",
        payload: e.payload,
      });
    }
    const listed = log.listRuns().find((r) => r.runId === runId);
    const pure = outcomeOf(log.listRun(runId));
    expect(listed).toMatchObject(pure);
    return pure;
  }

  it("waiting: escalated, nobody decided and the hold is open", () => {
    expect(summarise("r", [authorized("A1"), verdict("escalate")])).toMatchObject({
      verdict: "escalate",
      decidedBy: "review",
      holdOpen: true,
      escalation: "waiting",
    });
  });

  it("released: escalated and the hold was voided with no decision, as the eval does", () => {
    expect(
      summarise("r", [authorized("A1"), verdict("escalate"), closed("void", "A1")]),
    ).toMatchObject({
      verdict: "escalate",
      decidedBy: "review",
      holdOpen: false,
      escalation: "released",
    });
  });

  it("unfinished: a person decided but the platform refused, so the hold is still open", () => {
    expect(
      summarise("r", [
        authorized("A1"),
        verdict("escalate"),
        decided("approve"),
        refused("capture", "A1"),
      ]),
    ).toMatchObject({
      verdict: "approve",
      decidedBy: "person",
      holdOpen: true,
      escalation: "unfinished",
    });
    expect(
      summarise("r2", [authorized("A1"), verdict("escalate"), decided("reject")]),
    ).toMatchObject({
      verdict: "block",
      decidedBy: "person",
      holdOpen: true,
      escalation: "unfinished",
    });
  });

  it("decided: a person decided and the hold is closed", () => {
    expect(
      summarise("r", [
        authorized("A1"),
        verdict("escalate"),
        decided("approve"),
        closed("capture", "A1"),
        review("enforced", {}),
      ]),
    ).toMatchObject({
      verdict: "approve",
      decidedBy: "person",
      holdOpen: false,
      escalation: "decided",
    });
    expect(
      summarise("r2", [
        authorized("A1"),
        verdict("escalate"),
        decided("reject"),
        closed("void", "A1"),
        review("enforced", {}),
      ]),
    ).toMatchObject({ verdict: "block", decidedBy: "person", escalation: "decided" });
  });

  it("unfinished: the capture went through but enforcement stopped before the payouts were done", () => {
    // The hold is closed, but no `enforced` event follows the decision: sellers may be unpaid, and
    // sending the same decision again finishes the payouts.
    expect(
      summarise("r", [
        authorized("A1"),
        verdict("escalate"),
        decided("approve"),
        closed("capture", "A1"),
      ]),
    ).toMatchObject({ verdict: "approve", holdOpen: false, escalation: "unfinished" });
    // An enforcement from before the decision (the escalation itself) doesn't settle it.
    expect(
      summarise("r2", [
        authorized("A1"),
        verdict("escalate"),
        review("enforced", {}),
        decided("approve"),
        closed("capture", "A1"),
      ]),
    ).toMatchObject({ escalation: "unfinished" });
  });

  it("an escalation with no authorization on record has no hold to be waiting on", () => {
    expect(summarise("r", [verdict("escalate")])).toMatchObject({
      holdOpen: false,
      escalation: "released",
    });
  });

  it("has no escalation unless the review escalated, whatever the hold is doing", () => {
    expect(summarise("a", [authorized("A1"), verdict("approve")])).toMatchObject({
      verdict: "approve",
      holdOpen: true,
      escalation: null,
    });
    expect(
      summarise("b", [authorized("A1"), verdict("block"), closed("void", "A1")]),
    ).toMatchObject({
      verdict: "block",
      holdOpen: false,
      escalation: null,
    });
    expect(summarise("c", [authorized("A1"), verdict(null)])).toMatchObject({ escalation: null });
    expect(summarise("d", [authorized("A1"), review("review_failed", {})])).toMatchObject({
      reviewFailed: true,
      holdOpen: true,
      escalation: null,
    });
  });

  it("reads an eval cell by its last review: escalated, then released", () => {
    expect(
      summarise("cell", [
        authorized("A1"),
        review("review_started", { config: "off" }),
        verdict(null),
        review("review_started", { config: "full" }),
        verdict("escalate"),
        review("escalated", {}),
        closed("void", "A1"),
      ]),
    ).toMatchObject({ verdict: "escalate", escalation: "released" });
  });
});
