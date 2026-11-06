import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Event, type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MandateBuildError } from "./builder.js";
import { verifyMandate } from "./mandate.js";
import {
  acceptsDraftAsIs,
  buildMandate,
  type Decision,
  draftMandate,
  lockedMandateOf,
  mandateProgressOf,
  type Person,
  type SessionContext,
  scriptedPerson,
  stepMandate,
} from "./session.js";
import {
  builderAnswering,
  messageWith,
  tactileDraft,
  tactileTerms,
  vocabulary,
} from "./test-helpers.js";

let dir: string;
let log: EventLog;
let context: SessionContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mandate-"));
  log = openEventLog({ path: join(dir, "events.db") });
  context = {
    log,
    runId: "run_m1",
    scenarioId: "sc_b01",
    vocabulary,
    clock: () => new Date("2026-11-01T12:00:00.000Z"),
  };
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

const REQUEST = tactileDraft.requestText;

function build(person: Person, terms: unknown = tactileTerms) {
  const { builder } = builderAnswering(messageWith(JSON.stringify(terms)));
  return buildMandate(context, { builder, requestText: REQUEST, person });
}

const shape = (events: Event[]) => events.map((e) => [e.type, e.lane, e.provenance]);
const byType = (events: Event[], type: string) => events.find((e) => e.type === type) as Event;

describe("building a mandate with a person who accepts the draft as it is", () => {
  it("locks exactly the draft the builder wrote", async () => {
    const outcome = await build(acceptsDraftAsIs);
    if (outcome.outcome !== "locked") throw new Error("expected a locked mandate");
    expect(verifyMandate(outcome.mandate).intact).toBe(true);
    const { hash: _h, confirmedAt, confirmedByUser, ...rest } = outcome.mandate;
    // Locking sorts the requirements, so the same mandate always hashes the same.
    const sorted = [...tactileDraft.constraints].sort((a, b) =>
      a.attribute.localeCompare(b.attribute),
    );
    expect(rest).toEqual({ ...tactileDraft, constraints: sorted });
    expect({ confirmedAt, confirmedByUser }).toEqual({
      confirmedAt: "2026-11-01T12:00:00.000Z",
      confirmedByUser: true,
    });
  });

  it("logs the person's acts as user on the human lane, and the builder's as system on the mandate lane", async () => {
    await build(acceptsDraftAsIs);
    const events = log.listRun("run_m1");
    expect(shape(events)).toEqual([
      ["mandate_requested", "human", "user"],
      ["mandate_drafted", "mandate", "system"],
      ["mandate_confirmed", "human", "user"],
      ["mandate_locked", "mandate", "system"],
    ]);
    expect(events.every((e) => e.scenarioId === "sc_b01")).toBe(true);
  });

  it("chains each event to the one that caused it, back to the request", async () => {
    await build(acceptsDraftAsIs);
    const [requested, drafted, confirmed, locked] = log.listRun("run_m1") as Event[];
    expect(requested?.parentId).toBeNull();
    expect(drafted?.parentId).toBe(requested?.eventId);
    expect(confirmed?.parentId).toBe(drafted?.eventId);
    expect(locked?.parentId).toBe(confirmed?.eventId);
    expect(requested?.payload).toEqual({ requestText: REQUEST });
  });

  it("records the draft's tokens and cost on its event", async () => {
    await build(acceptsDraftAsIs);
    const drafted = byType(log.listRun("run_m1"), "mandate_drafted");
    expect(drafted.costUsd).toBeCloseTo(0.000475, 9);
    expect(drafted.payload).toMatchObject({
      model: "claude-haiku-5-5",
      tokens: { inputTokens: 4000, outputTokens: 150 },
      draft: tactileDraft,
    });
  });

  it("leaves a locked mandate a gate can find and verify", async () => {
    const outcome = await build(acceptsDraftAsIs);
    expect(lockedMandateOf(log.listRun("run_m1"))).toEqual(
      outcome.outcome === "locked" ? outcome.mandate : null,
    );
  });

  it("rejects, with the reason, a draft it can't accept as is", async () => {
    const outcome = await build(acceptsDraftAsIs, { ...tactileTerms, maxUnitPriceCents: null });
    expect(outcome.outcome).toBe("rejected");
    expect(shape(log.listRun("run_m1")).map(([type]) => type)).toEqual([
      "mandate_requested",
      "mandate_drafted",
      "mandate_confirm_failed",
      "mandate_rejected",
    ]);
    expect(outcome.outcome === "rejected" && outcome.reason).toMatch(/price ceiling/);
  });
});

describe("a person who edits the draft", () => {
  it("writes each edit as a new event pointing at the version it changed, and locks the edited draft", async () => {
    const outcome = await build(
      scriptedPerson([
        { kind: "edit", edit: { field: "maxUnitPriceCents", value: 10000 } },
        { kind: "edit", edit: { field: "quantity", value: 2 } },
        { kind: "accept" },
      ]),
    );
    const events = log.listRun("run_m1");
    const [, drafted, firstEdit, secondEdit, confirmed, locked] = events as Event[];
    expect(shape(events).map(([type]) => type)).toEqual([
      "mandate_requested",
      "mandate_drafted",
      "mandate_edited",
      "mandate_edited",
      "mandate_confirmed",
      "mandate_locked",
    ]);
    expect(firstEdit?.parentId).toBe(drafted?.eventId);
    expect(secondEdit?.parentId).toBe(firstEdit?.eventId);
    expect(confirmed?.parentId).toBe(secondEdit?.eventId);
    expect(locked?.parentId).toBe(confirmed?.eventId);
    expect(firstEdit).toMatchObject({ lane: "human", provenance: "user" });
    expect(firstEdit?.payload).toMatchObject({
      field: "maxUnitPriceCents",
      from: 12000,
      to: 10000,
    });
    // The draft event still holds the draft as the builder wrote it.
    expect(drafted?.payload).toMatchObject({ draft: tactileDraft });
    expect(outcome.outcome === "locked" && outcome.mandate).toMatchObject({
      maxUnitPriceCents: 10000,
      quantity: 2,
    });
  });

  it("tells the person why an edit didn't fit, and logs the attempt without applying it", async () => {
    const seen: string[][] = [];
    const decisions: Decision[] = [
      {
        kind: "edit",
        edit: { field: "constraints", value: [{ attribute: "dpi", op: "gte", value: 800 }] },
      },
      { kind: "accept" },
    ];
    const person: Person = {
      async review(_draft, problems) {
        seen.push(problems);
        return decisions.shift() as Decision;
      },
    };
    const outcome = await build(person);
    expect(seen[0]).toEqual([]);
    expect(seen[1]?.join()).toMatch(/keyboard has no attribute "dpi"/);
    const failed = byType(log.listRun("run_m1"), "mandate_edit_failed");
    expect(failed).toMatchObject({ lane: "human", provenance: "user" });
    expect(failed.parentId).toBe(byType(log.listRun("run_m1"), "mandate_drafted").eventId);
    expect(outcome.outcome === "locked" && outcome.mandate.constraints).toEqual(
      [...tactileDraft.constraints].sort((a, b) => a.attribute.localeCompare(b.attribute)),
    );
  });

  it("can reject the draft, which locks nothing", async () => {
    const outcome = await build(scriptedPerson([{ kind: "reject", reason: " wrong product " }]));
    expect(outcome).toMatchObject({ outcome: "rejected", reason: "wrong product" });
    expect(shape(log.listRun("run_m1")).at(-1)).toEqual(["mandate_rejected", "human", "user"]);
    expect(() => lockedMandateOf(log.listRun("run_m1"))).toThrow(/no locked mandate/);
  });

  it("gives up on a person whose decisions never go through", async () => {
    const stuck: Person = { review: async () => ({ kind: "accept" }) };
    const { builder } = builderAnswering(
      messageWith(JSON.stringify({ ...tactileTerms, maxUnitPriceCents: null })),
    );
    await expect(
      buildMandate(context, { builder, requestText: REQUEST, person: stuck, maxDecisions: 3 }),
    ).rejects.toThrow(/after 3 tries/);
  });
});

describe("when the builder fails", () => {
  it("logs mandate_draft_failed with the reason and the spend, then throws", async () => {
    const error = await build(acceptsDraftAsIs, { ...tactileTerms, category: "monitor" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MandateBuildError);
    const events = log.listRun("run_m1");
    expect(shape(events)).toEqual([
      ["mandate_requested", "human", "user"],
      ["mandate_draft_failed", "mandate", "system"],
    ]);
    expect(events[1]?.payload).toMatchObject({ code: "invalid_output" });
    expect(events[1]?.costUsd).toBeGreaterThan(0);
  });
});

describe("lockedMandateOf", () => {
  it("refuses a locked mandate that was altered after locking", async () => {
    await build(acceptsDraftAsIs);
    const events = log.listRun("run_m1").map((e) =>
      e.type === "mandate_locked"
        ? {
            ...e,
            payload: {
              mandate: {
                ...(e.payload as { mandate: Record<string, unknown> }).mandate,
                maxUnitPriceCents: 99900,
              },
            },
          }
        : e,
    );
    expect(() => lockedMandateOf(events)).toThrow(/was altered.*hash mismatch/);
  });
});

// The web app's way in: the same decisions, one request at a time, with nothing held between them
// but the event log.
describe("taking the mandate one decision at a time", () => {
  async function drafted() {
    const { builder } = builderAnswering(messageWith(JSON.stringify(tactileTerms)));
    return draftMandate(context, builder, REQUEST);
  }
  const progress = () => mandateProgressOf(log.listRun("run_m1"));

  it("reads where a mandate stands from the log alone", async () => {
    expect(progress()).toEqual({ status: "none" });
    const { draftEvent, requestEvent } = await drafted();
    expect(progress()).toEqual({
      status: "drafted",
      draft: tactileDraft,
      versionId: draftEvent.eventId,
      requestEventId: requestEvent.eventId,
    });
  });

  it("writes the same events as the terminal flow, edit by edit, and ends at a lock a gate can find", async () => {
    await drafted();
    const decisions: Decision[] = [
      { kind: "edit", edit: { field: "maxUnitPriceCents", value: 10000 } },
      { kind: "edit", edit: { field: "quantity", value: 2 } },
      { kind: "accept" },
    ];
    for (const decision of decisions) {
      const now = progress();
      if (now.status !== "drafted") throw new Error("expected a draft");
      const step = stepMandate(context, now, decision);
      if (decision.kind === "edit") expect(step.outcome).toBe("open");
    }
    const events = log.listRun("run_m1");
    expect(shape(events)).toEqual([
      ["mandate_requested", "human", "user"],
      ["mandate_drafted", "mandate", "system"],
      ["mandate_edited", "human", "user"],
      ["mandate_edited", "human", "user"],
      ["mandate_confirmed", "human", "user"],
      ["mandate_locked", "mandate", "system"],
    ]);
    const [, draftEvent, firstEdit, secondEdit, confirmed] = events as Event[];
    expect(firstEdit?.parentId).toBe(draftEvent?.eventId);
    expect(secondEdit?.parentId).toBe(firstEdit?.eventId);
    expect(confirmed?.parentId).toBe(secondEdit?.eventId);
    expect(lockedMandateOf(events)).toMatchObject({ maxUnitPriceCents: 10000, quantity: 2 });
    const done = progress();
    expect(done.status).toBe("locked");
    expect(done.status === "locked" && done.mandate.hash).toBe(lockedMandateOf(events).hash);
  });

  it("says why an edit didn't fit and leaves the draft where it was", async () => {
    const { draftEvent } = await drafted();
    const now = progress();
    if (now.status !== "drafted") throw new Error("expected a draft");
    const step = stepMandate(context, now, {
      kind: "edit",
      edit: { field: "constraints", value: [{ attribute: "dpi", op: "gte", value: 800 }] },
    });
    expect(step).toMatchObject({ outcome: "open", versionId: draftEvent.eventId });
    expect(step.outcome === "open" && step.problems.join()).toMatch(/keyboard has no attribute/);
    expect(progress()).toMatchObject({ status: "drafted", versionId: draftEvent.eventId });
    expect(log.listRun("run_m1").at(-1)).toMatchObject({ type: "mandate_edit_failed" });
  });

  it("refuses to lock a draft with no price ceiling, and says so", async () => {
    const { builder } = builderAnswering(
      messageWith(JSON.stringify({ ...tactileTerms, maxUnitPriceCents: null })),
    );
    await draftMandate(context, builder, REQUEST);
    const now = progress();
    if (now.status !== "drafted") throw new Error("expected a draft");
    const step = stepMandate(context, now, { kind: "accept" });
    expect(step.outcome === "open" && step.problems.join()).toMatch(/price ceiling/);
    expect(log.listRun("run_m1").at(-1)).toMatchObject({ type: "mandate_confirm_failed" });
    expect(progress().status).toBe("drafted");
  });

  it("ends at a rejection that locks nothing", async () => {
    await drafted();
    const now = progress();
    if (now.status !== "drafted") throw new Error("expected a draft");
    stepMandate(context, now, { kind: "reject", reason: " not what I meant " });
    expect(progress()).toEqual({ status: "rejected", reason: "not what I meant" });
  });

  it("is not fooled by a lock that was altered afterwards", async () => {
    await drafted();
    const now = progress();
    if (now.status !== "drafted") throw new Error("expected a draft");
    stepMandate(context, now, { kind: "accept" });
    const altered = log.listRun("run_m1").map((e) =>
      e.type === "mandate_locked"
        ? {
            ...e,
            payload: {
              mandate: {
                ...(e.payload as { mandate: Record<string, unknown> }).mandate,
                maxUnitPriceCents: 99900,
              },
            },
          }
        : e,
    );
    expect(mandateProgressOf(altered).status).toBe("drafted");
  });
});
