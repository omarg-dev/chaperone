import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HAIKU_COLUMN, type LiveModels } from "@firewall/agent";
import { baseCatalog, buildArena, createArenaService, findScenario } from "@firewall/arena";
import {
  CAIRN,
  gatesReplaying,
  HALVARD,
  loadGate2Recording,
  shopping,
  TERN,
} from "@firewall/eval/test-helpers";
import { type Event, type EventLog, openEventLog } from "@firewall/events";
import {
  arenaVocabulary,
  createAnthropicClient,
  createMandateBuilder,
  lockedMandateOf,
  MandateBuildError,
  type MandateBuilder,
  type RecordedResponse,
  replayFetch,
} from "@firewall/mandate";
import { createFakePaymentAdapter, type FakePaymentAdapter } from "@firewall/payments";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { PaymentSetup } from "./payments.js";

// Live runs over HTTP, on a real SQLite event log in a temp folder. No model is called: the
// mandate builder is the real one answering from the recordings in packages/mandate/fixtures, the
// shopping agent is the scripted one the eval's tests use, the gates replay the recordings in
// packages/firewall/fixtures, and the payment platform is the in-memory fake.

const SEED = "gate2-1";
const FIXTURES = new URL("../../../packages/mandate/fixtures/requests/", import.meta.url);
const recordings: RecordedResponse[] = readdirSync(FIXTURES).map((name) =>
  JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")),
);

// What the gates' recording of an honest purchase was made on: the agent looks at both keyboards
// and buys the right one.
const honestShopper = () => shopping({ open: [TERN, HALVARD], buy: [HALVARD], search: true });

// The real builder, answering each scenario's request from its recording.
function recordedBuilder(newMandateId = () => "md_gate2case"): MandateBuilder {
  return {
    model: "claude-haiku-5-5",
    request: (requestText) => builderFor(requestText).request(requestText),
    draft: (requestText) => builderFor(requestText).draft(requestText),
  };
  function builderFor(requestText: string) {
    const found = recordings.find((r) => r.requestText === requestText);
    if (!found) throw new Error(`No recording for "${requestText}"`);
    return createMandateBuilder({
      client: createAnthropicClient(
        { apiKey: "the-apps-own-key", baseUrl: "https://models.firewall.test" },
        { fetch: replayFetch(found.response).fetch, maxRetries: 0 },
      ),
      vocabulary: arenaVocabulary(),
      newMandateId,
    });
  }
}

let dir: string;
let log: EventLog;
let fake: FakePaymentAdapter;
// The log's clock and the service's: the day's budget is read from the first and compared with the
// second. The day is the one the gates' recordings were made against, so the mandate they audit
// hashes the same.
let clock: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "server-live-"));
  clock = new Date("2026-10-23T09:00:00.000Z");
  log = openEventLog({ path: join(dir, "events.db"), clock: () => clock });
  fake = createFakePaymentAdapter();
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Setup {
  model?: unknown;
  gates?: LiveModels["gates"];
  builder?: MandateBuilder;
  models?: LiveModels | null;
  payments?: PaymentSetup | null;
  capUsd?: number;
  // A second server over the same log, with its own arena: what a restart leaves.
  arena?: ReturnType<typeof createArenaService>;
}

function makeApp(setup: Setup = {}) {
  const models: LiveModels | null =
    setup.models === undefined
      ? {
          column: HAIKU_COLUMN,
          model: (setup.model ?? honestShopper()) as LiveModels["model"],
          builder: setup.builder ?? recordedBuilder(),
          gates: setup.gates ?? gatesReplaying(loadGate2Recording("honest")),
          gateModel: HAIKU_COLUMN.modelId,
        }
      : setup.models;
  const payments: PaymentSetup | undefined =
    setup.payments === null
      ? undefined
      : (setup.payments ?? { name: "fake", adapter: fake, vaultId: "FAKE-WALLET" });
  return createApp({
    log,
    arena: setup.arena ?? createArenaService({ log }),
    ...(payments && { payments }),
    live: { models, capUsd: setup.capUsd ?? 1, now: () => clock },
  });
}
type App = ReturnType<typeof makeApp>;

const post = (app: App, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
// biome-ignore lint/suspicious/noExplicitAny: the tests read a JSON answer field by field.
const read = async (res: Response) => (await res.json()) as Record<string, any>;

async function draft(app: App, scenarioId = "sc_b01", seed = SEED) {
  const res = await post(app, "/live/runs", { scenarioId, seed });
  return { res, body: await read(res) };
}
const decide = (app: App, runId: string, body: unknown) =>
  post(app, `/live/runs/${runId}/mandate`, body);
const start = (app: App, runId: string, firewall = "gate0") =>
  post(app, `/live/runs/${runId}/start`, { firewall });

async function locked(app: App, scenarioId = "sc_b01", seed = SEED) {
  const { body } = await draft(app, scenarioId, seed);
  const res = await decide(app, body.runId, { action: "confirm" });
  expect(res.status).toBe(200);
  return body.runId as string;
}

// Waits for the live run in progress to finish, as the page does: by asking.
async function finished(app: App) {
  for (let i = 0; i < 500; i++) {
    const status = await read(await app.request("/live/status"));
    if (!status.busy) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("The live run never finished");
}

const types = (events: Event[]) => events.map((e) => `${e.lane}:${e.type}`);
const summary = async (app: App, runId: string) =>
  ((await (await app.request("/events/runs")).json()) as { runId: string }[]).find(
    (r) => r.runId === runId,
  );

// An earlier live run's spend, written the way a run writes its cost: on an event of a run that
// says it came from the web app.
let earlier = 0;
function earlierSpend(usd: number, at = clock.toISOString(), origin: string | null = "web") {
  const runId = `run_earlier_${++earlier}`;
  const now = clock;
  clock = new Date(at);
  log.append({
    runId,
    scenarioId: "sc_b01",
    lane: "arena",
    type: "run_started",
    provenance: "user",
    payload: { seed: "1", request: "x", ...(origin && { origin }) },
  });
  log.append({
    runId,
    scenarioId: "sc_b01",
    lane: "agent",
    type: "model_turn",
    provenance: "system",
    costUsd: usd,
    payload: {},
  });
  clock = now;
  return runId;
}

describe("GET /live/status", () => {
  it("says live runs are available, what holds the money, and how much of the day is left", async () => {
    const status = await read(await makeApp().request("/live/status"));
    expect(status).toMatchObject({
      available: true,
      reason: null,
      payments: "fake",
      busy: false,
      agentModel: "Claude Haiku 5.5",
      gateModel: "claude-haiku-5-5",
      budget: {
        capUsd: 1,
        spentUsd: 0,
        remainingUsd: 1,
        resetsAt: "2026-10-24T00:00:00.000Z",
      },
    });
  });

  it("is off, in plain words, without a model key, and the rest of the server works", async () => {
    const app = makeApp({ models: null });
    const status = await read(await app.request("/live/status"));
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/FIREWALL_ANTHROPIC_API_KEY/);
    const refused = await draft(app);
    expect(refused.res.status).toBe(503);
    expect(refused.body).toMatchObject({ error: "live_off" });
    // Nothing was started, so nothing is on the log.
    expect(log.listRuns()).toEqual([]);
    expect((await app.request("/events/runs")).status).toBe(200);
    expect((await app.request("/arena/scenarios")).status).toBe(200);
    expect((await app.request("/health")).status).toBe(200);
  });

  it("is off when there is no payment adapter, or the sandbox has no wallet to hold money against", async () => {
    expect((await read(await makeApp({ payments: null }).request("/live/status"))).reason).toMatch(
      /no payment adapter/,
    );
    const noWallet = makeApp({ payments: { name: "sandbox", adapter: fake, vaultId: null } });
    const status = await read(await noWallet.request("/live/status"));
    expect(status).toMatchObject({ available: false, payments: "sandbox" });
    expect(status.reason).toMatch(/SANDBOX_BUYER_VAULT_ID/);
    expect((await draft(noWallet)).res.status).toBe(503);
  });
});

describe("choosing a task and drafting the mandate", () => {
  it("starts a run marked as the web's, on the adapter in use, and writes what the command line writes", async () => {
    const app = makeApp();
    const { res, body } = await draft(app);
    expect(res.status).toBe(201);
    const events = log.listRun(body.runId);
    expect(events[0]).toMatchObject({
      lane: "arena",
      type: "run_started",
      payload: { seed: SEED, origin: "web", payments: "fake" },
    });
    // The same two events, on the same lanes with the same provenance, as `buildMandate` writes
    // for the person's request and the builder's draft.
    expect(events.slice(1).map((e) => [e.lane, e.type, e.provenance])).toEqual([
      ["human", "mandate_requested", "user"],
      ["mandate", "mandate_drafted", "system"],
    ]);
    expect(events[2]?.parentId).toBe(events[1]?.eventId);
    expect(events[2]?.costUsd).toBeGreaterThan(0);
  });

  it("shows the person's request and each term in words, and says which can be edited", async () => {
    const { body } = await draft(makeApp());
    expect(body).toMatchObject({
      scenarioId: "sc_b01",
      request: findScenario("sc_b01")?.request,
      state: "drafted",
      problems: [],
      canConfirm: true,
      lock: null,
    });
    const rows = body.rows as { label: string; value: string; field: string | null }[];
    expect(rows.map((r) => r.label)).toEqual([
      "Category",
      "Requirements",
      "Brands",
      "Price ceiling",
      "Quantity",
      "Extras allowed",
      "Sellers",
      "Price tolerance",
      "Not covered",
    ]);
    expect(rows.find((r) => r.label === "Price ceiling")).toMatchObject({
      value: "$120.00 each",
      field: "maxUnitPriceCents",
      editText: "120.00",
    });
    expect(rows.find((r) => r.label === "Sellers")).toMatchObject({ field: null, editText: null });
    expect(rows.find((r) => r.label === "Not covered")?.value).toBe('"mid-range"');
  });

  it("never says which scenarios are attacks", async () => {
    const app = makeApp();
    const attack = await draft(app, "sc_a01", "1");
    expect(attack.res.status).toBe(201);
    const text = JSON.stringify(attack.body).toLowerCase();
    expect(text).not.toContain("attack");
    expect(Object.keys(attack.body)).not.toContain("kind");
  });

  it("refuses an unknown scenario, a bad seed and a malformed body, and starts nothing", async () => {
    const app = makeApp();
    expect((await draft(app, "sc_nope")).res.status).toBe(404);
    expect((await draft(app, "sc_b01", "../x")).res.status).toBe(400);
    expect((await post(app, "/live/runs", {})).status).toBe(400);
    expect(log.listRuns()).toEqual([]);
  });

  it("says so when the builder can't draft, and leaves a run that says why", async () => {
    const app = makeApp({
      builder: {
        model: "scripted",
        request: () => {
          throw new Error("not used");
        },
        draft: async () => {
          throw new MandateBuildError("api_error", "The model API answered 529", {});
        },
      },
    });
    const { res, body } = await draft(app);
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ error: "draft_failed" });
    expect(body.message).not.toMatch(/529/);
    const events = log.listRun(body.runId);
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "mandate_requested",
      "mandate_draft_failed",
    ]);
    // Nothing can be confirmed or started from it.
    expect((await decide(app, body.runId, { action: "confirm" })).status).toBe(409);
    expect((await start(app, body.runId)).status).toBe(409);
  });
});

describe("setting the mandate", () => {
  it("applies an edit as a new event pointing at the version it changed, and shows the new terms", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const res = await decide(app, body.runId, {
      action: "edit",
      field: "maxUnitPriceCents",
      input: "$99.50",
    });
    expect(res.status).toBe(200);
    const view = await read(res);
    expect(view.state).toBe("drafted");
    expect(view.rows.find((r: { label: string }) => r.label === "Price ceiling")).toMatchObject({
      value: "$99.50 each",
      editText: "99.50",
    });
    const events = log.listRun(body.runId);
    const drafted = events.find((e) => e.type === "mandate_drafted") as Event;
    const edited = events.find((e) => e.type === "mandate_edited") as Event;
    expect(edited).toMatchObject({ lane: "human", provenance: "user", parentId: drafted.eventId });
    expect(edited.payload).toMatchObject({ field: "maxUnitPriceCents", from: 12000, to: 9950 });
  });

  it("can edit every field the builder supports editing", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const edits: [string, string][] = [
      ["category", "mouse"],
      ["constraints", "wireless=yes"],
      ["brandPolicy", "any"],
      ["maxUnitPriceCents", "40"],
      ["quantity", "2"],
      ["allowedExtras", "keyboard"],
      ["tolerances", "10"],
    ];
    for (const [field, input] of edits) {
      const res = await decide(app, body.runId, { action: "edit", field, input });
      expect(res.status, `${field}: ${JSON.stringify(await res.clone().json())}`).toBe(200);
    }
    expect(log.listRun(body.runId).filter((e) => e.type === "mandate_edited")).toHaveLength(7);
  });

  it("answers a typo with what it couldn't read, writes nothing, and keeps the draft", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const before = log.listRun(body.runId).length;
    const res = await decide(app, body.runId, { action: "edit", field: "quantity", input: "lots" });
    expect(res.status).toBe(422);
    const answer = await read(res);
    expect(answer).toMatchObject({ error: "unreadable_edit" });
    expect(answer.message).toMatch(/isn't a whole number/);
    expect(answer.mandate.state).toBe("drafted");
    expect(log.listRun(body.runId)).toHaveLength(before);
  });

  it("refuses an edit that reads fine but doesn't fit the catalog, and logs the attempt", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const res = await decide(app, body.runId, {
      action: "edit",
      field: "constraints",
      input: "dpi>=800",
    });
    expect(res.status).toBe(422);
    expect(await read(res)).toMatchObject({ error: "edit_refused" });
    expect(log.listRun(body.runId).at(-1)).toMatchObject({
      lane: "human",
      type: "mandate_edit_failed",
    });
    // The terms are still the builder's.
    const view = await read(await app.request(`/live/runs/${body.runId}/mandate`));
    expect(view.rows.find((r: { label: string }) => r.label === "Requirements").value).toMatch(
      /switch_feel = tactile/,
    );
  });

  it("locks on confirm: each term the person agreed to, the hash, and the events the CLI writes", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const res = await decide(app, body.runId, { action: "confirm" });
    expect(res.status).toBe(200);
    const view = await read(res);
    expect(view).toMatchObject({ state: "locked", lock: { confirmedAt: clock.toISOString() } });
    // A locked mandate can't be edited from the page: no row has an edit box.
    expect(view.rows.every((r: { editText: unknown }) => r.editText === null)).toBe(true);
    const events = log.listRun(body.runId);
    expect(events.slice(3).map((e) => [e.lane, e.type, e.provenance])).toEqual([
      ["human", "mandate_confirmed", "user"],
      ["mandate", "mandate_locked", "system"],
    ]);
    // The gates read the same lock, and it verifies.
    expect(lockedMandateOf(events).hash).toBe(view.lock.hash);
  });

  it("refuses to lock a draft with no price ceiling, and says what's missing", async () => {
    const real = recordedBuilder();
    const app = makeApp({
      builder: {
        ...real,
        draft: async (text) => {
          const drafted = await real.draft(text);
          return { ...drafted, draft: { ...drafted.draft, maxUnitPriceCents: null } };
        },
      },
    });
    const { body } = await draft(app);
    expect(body.canConfirm).toBe(false);
    const res = await decide(app, body.runId, { action: "confirm" });
    expect(res.status).toBe(422);
    const answer = await read(res);
    expect(answer).toMatchObject({ error: "cannot_lock" });
    expect(answer.message).toMatch(/price ceiling/);
    // Setting one makes it lockable.
    await decide(app, body.runId, { action: "edit", field: "maxUnitPriceCents", input: "120" });
    expect((await decide(app, body.runId, { action: "confirm" })).status).toBe(200);
  });

  it("can be rejected, which locks nothing and starts nothing", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const res = await decide(app, body.runId, { action: "reject", reason: "  not what I meant " });
    expect(await read(res)).toMatchObject({ state: "rejected", note: "not what I meant" });
    expect(log.listRun(body.runId).at(-1)).toMatchObject({
      lane: "human",
      type: "mandate_rejected",
      provenance: "user",
    });
    const refused = await start(app, body.runId);
    expect(refused.status).toBe(409);
    expect(await read(refused)).toMatchObject({ error: "mandate_not_locked" });
    expect(log.listRun(body.runId).some((e) => e.lane === "agent")).toBe(false);
  });

  it("is closed once locked: no more edits, no second confirmation, no rejection", async () => {
    const app = makeApp();
    const runId = await locked(app);
    for (const action of [
      { action: "edit", field: "quantity", input: "3" },
      { action: "confirm" },
      { action: "reject" },
    ]) {
      const res = await decide(app, runId, action);
      expect(res.status).toBe(409);
      expect(await read(res)).toMatchObject({ error: "mandate_closed" });
    }
    expect(log.listRun(runId).filter((e) => e.type === "mandate_locked")).toHaveLength(1);
  });

  it("two confirmations at once lock it once", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const both = await Promise.all([
      decide(app, body.runId, { action: "confirm" }),
      decide(app, body.runId, { action: "confirm" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(log.listRun(body.runId).filter((e) => e.type === "mandate_locked")).toHaveLength(1);
  });

  it("validates what comes in: an unknown field or action is a 400", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    expect(
      (await decide(app, body.runId, { action: "edit", field: "hash", input: "x" })).status,
    ).toBe(400);
    expect((await decide(app, body.runId, { action: "approve" })).status).toBe(400);
    expect((await decide(app, body.runId, { action: "edit", field: "quantity" })).status).toBe(400);
  });

  it("only touches runs the web app started", async () => {
    const app = makeApp();
    const { runId } = log.append({
      runId: "run_from_the_eval",
      scenarioId: "sc_b01",
      lane: "arena",
      type: "run_started",
      provenance: "user",
      payload: { seed: "1", request: "x" },
    });
    expect((await decide(app, runId, { action: "confirm" })).status).toBe(404);
    expect((await start(app, runId)).status).toBe(404);
    expect((await app.request(`/live/runs/${runId}/mandate`)).status).toBe(404);
    expect((await app.request("/live/runs/run_nope/mandate")).status).toBe(404);
    expect(log.listRun(runId)).toHaveLength(1);
  });
});

describe("starting the run", () => {
  it("refuses a mandate that isn't locked, and runs nothing", async () => {
    const app = makeApp();
    const { body } = await draft(app);
    const res = await start(app, body.runId);
    expect(res.status).toBe(409);
    expect(await read(res)).toMatchObject({ error: "mandate_not_locked" });
    expect(log.listRun(body.runId).some((e) => e.lane === "agent" || e.lane === "payments")).toBe(
      false,
    );
    expect((await read(await app.request("/live/status"))).busy).toBe(false);
  });

  it("validates the firewall setting, and defaults it to the full tree", async () => {
    const app = makeApp();
    const runId = await locked(app);
    expect((await start(app, runId, "everything")).status).toBe(400);
    expect((await post(app, `/live/runs/${runId}/start`, {})).status).toBe(202);
    await finished(app);
    expect(log.listRun(runId).find((e) => e.type === "review_started")?.payload).toMatchObject({
      config: "full",
    });
  });

  it("runs the agent in the background with the locked mandate, and the run view's events are the pipeline's", async () => {
    const app = makeApp();
    const runId = await locked(app);
    const res = await start(app, runId, "full");
    expect(res.status).toBe(202);
    expect(await read(res)).toEqual({ runId, firewall: "full" });
    // It runs in this process while the request is answered: the page follows it by polling.
    await finished(app);

    const events = log.listRun(runId);
    expect(types(events)).toEqual(
      expect.arrayContaining([
        "arena:run_started",
        "human:mandate_requested",
        "mandate:mandate_drafted",
        "human:mandate_confirmed",
        "mandate:mandate_locked",
        "agent:agent_started",
        "agent:model_turn",
        "arena:checkout",
        "payments:payment_call",
        "gate0:verdict",
        "gate1:verdict",
        "gate2:verdict",
        "gate3:verdict",
        "review:review_finished",
        "review:enforced",
        "agent:run_finished",
      ]),
    );
    // One run: one start, one lock, the person's mandate ahead of everything the agent did.
    expect(events.filter((e) => e.type === "run_started")).toHaveLength(1);
    expect(events.filter((e) => e.type === "mandate_locked")).toHaveLength(1);
    const at = (type: string) => events.findIndex((e) => e.type === type);
    expect(at("mandate_locked")).toBeLessThan(at("agent_started"));
    expect(log.listRuns().filter((r) => r.runId === runId)).toHaveLength(1);

    expect(await summary(app, runId)).toMatchObject({
      origin: "web",
      payments: "fake",
      verdict: "approve",
      decidedBy: "review",
      reviews: ["full"],
    });
    // The honest seller was paid out of the fake the server owns, which holds the capture.
    expect(log.listRun(runId).find((e) => e.type === "enforced")?.payload).toMatchObject({
      money: "captured",
      payouts: [{ payeeKey: "seller_2", status: "PENDING" }],
    });
    expect(Object.keys(fake.balances())).toEqual(["FAKE-PLATFORM"]);
  });

  it("with the firewall off, an attacker's checkout is captured and paid; with Gate 0, it is voided", async () => {
    const scenario = findScenario("sc_a01");
    if (!scenario) throw new Error("no sc_a01");
    const { catalog } = buildArena(scenario, "1", baseCatalog);
    const sellers = new Map(catalog.sellers.map((s) => [s.sellerId, s]));
    const attacker = catalog.listings.find(
      (l) =>
        sellers.get(l.sellerId)?.role === "attacker" &&
        catalog.products.find((p) => p.sku === l.sku)?.category === scenario.intent.category,
    );
    if (!attacker) throw new Error("no attacker listing");
    const agent = () => shopping({ open: [attacker.listingId], buy: [attacker.listingId] });

    const off = makeApp({ model: agent() });
    const offRun = await locked(off, "sc_a01", "1");
    await start(off, offRun, "off");
    await finished(off);
    expect(await summary(off, offRun)).toMatchObject({
      decidedBy: "no_review",
      attackerPaid: true,
    });

    const guarded = makeApp({ model: agent() });
    const gatedRun = await locked(guarded, "sc_a01", "1");
    await start(guarded, gatedRun, "gate0");
    await finished(guarded);
    expect(await summary(guarded, gatedRun)).toMatchObject({
      verdict: "block",
      attackerPaid: false,
    });
    expect(
      log
        .listRun(gatedRun)
        .some((e) => (e.payload as { operation?: string }).operation === "capture"),
    ).toBe(false);
  });

  it("starts a run only once", async () => {
    const app = makeApp();
    const runId = await locked(app);
    expect((await start(app, runId)).status).toBe(202);
    expect((await start(app, runId)).status).toBe(409);
    await finished(app);
    const again = await start(app, runId);
    expect(again.status).toBe(409);
    expect(await read(again)).toMatchObject({ error: "already_started" });
    expect(log.listRun(runId).filter((e) => e.type === "agent_started")).toHaveLength(1);
  });

  it("says so on the run's own timeline when the run breaks before the agent could finish", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // A column the agent can't read breaks the run before its first model call.
    const app = makeApp({
      models: {
        column: undefined as never,
        model: honestShopper() as LiveModels["model"],
        builder: recordedBuilder(),
        gates: gatesReplaying(loadGate2Recording("honest")),
        gateModel: HAIKU_COLUMN.modelId,
      },
    });
    const runId = await locked(app);
    expect((await start(app, runId)).status).toBe(202);
    await finished(app);
    const ended = log.listRun(runId).find((e) => e.type === "run_finished");
    expect(ended).toMatchObject({ lane: "agent", payload: { status: "failed" } });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    // Free again: another run may start.
    expect((await read(await app.request("/live/status"))).busy).toBe(false);
  });

  it("can't start a run the server lost in a restart, and says so", async () => {
    const first = makeApp();
    const runId = await locked(first);
    const restarted = makeApp({ arena: createArenaService({ log }) });
    const res = await start(restarted, runId);
    expect(res.status).toBe(410);
    expect(await read(res)).toMatchObject({ error: "run_lost" });
    expect(log.listRun(runId).some((e) => e.type === "agent_started")).toBe(false);
    expect((await read(await restarted.request("/live/status"))).busy).toBe(false);
  });
});

describe("one live run at a time", () => {
  function gated() {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = honestShopper();
    const model = new MockLanguageModelV4({
      modelId: HAIKU_COLUMN.modelId,
      doGenerate: async (options) => {
        await hold;
        return inner.doGenerate(options);
      },
    });
    return { model, release };
  }

  it("refuses a second start with a 409 while one is in progress, then allows it", async () => {
    const { model, release } = gated();
    const app = makeApp({ model });
    const first = await locked(app);
    const second = await locked(app);
    expect((await start(app, first)).status).toBe(202);
    expect((await read(await app.request("/live/status"))).busy).toBe(true);

    const refused = await start(app, second);
    expect(refused.status).toBe(409);
    expect(await read(refused)).toMatchObject({ error: "run_in_progress" });
    expect(log.listRun(second).some((e) => e.type === "agent_started")).toBe(false);

    release();
    await finished(app);
    expect((await start(app, second)).status).toBe(202);
    await finished(app);
    expect(log.listRun(second).some((e) => e.type === "agent_started")).toBe(true);
  });

  it("two starts at the same instant let one through", async () => {
    const { model, release } = gated();
    const app = makeApp({ model });
    const [a, b] = [await locked(app), await locked(app)];
    const answers = await Promise.all([start(app, a), start(app, b)]);
    expect(answers.map((r) => r.status).sort()).toEqual([202, 409]);
    release();
    await finished(app);
    const started = [a, b].filter((id) => log.listRun(id).some((e) => e.type === "agent_started"));
    expect(started).toHaveLength(1);
  });

  it("can still draft and confirm mandates while a run is in progress", async () => {
    const { model, release } = gated();
    const app = makeApp({ model });
    const runId = await locked(app);
    await start(app, runId);
    expect((await draft(app)).res.status).toBe(201);
    release();
    await finished(app);
  });
});

describe("the daily cap", () => {
  it("counts the day's web runs from the log, and the status shows what is left", async () => {
    earlierSpend(0.25);
    earlierSpend(0.1);
    // Not counted: yesterday's, another origin's, and a run with no origin.
    earlierSpend(0.5, "2026-10-22T23:59:59.000Z");
    earlierSpend(0.5, clock.toISOString(), "cli");
    earlierSpend(0.5, clock.toISOString(), null);
    const status = await read(await makeApp().request("/live/status"));
    expect(status.budget).toMatchObject({ spentUsd: 0.35, remainingUsd: 0.65, capUsd: 1 });
  });

  it("refuses a new draft with a 429 and a clear message once the day's cap is reached, and starts nothing", async () => {
    earlierSpend(1);
    const app = makeApp();
    const before = log.listRuns().length;
    const { res, body } = await draft(app);
    expect(res.status).toBe(429);
    expect(body).toMatchObject({ error: "daily_cap", budget: { spentUsd: 1, remainingUsd: 0 } });
    expect(body.message).toMatch(/\$1\.00/);
    expect(body.message).toMatch(/midnight UTC/);
    expect(body.message).toMatch(/replay/i);
    expect(log.listRuns()).toHaveLength(before);
  });

  it("refuses a start with a 429 when the cap was reached after the mandate was locked", async () => {
    const app = makeApp();
    const runId = await locked(app);
    earlierSpend(1);
    const res = await start(app, runId);
    expect(res.status).toBe(429);
    expect(await read(res)).toMatchObject({ error: "daily_cap" });
    expect(log.listRun(runId).some((e) => e.lane === "agent" || e.lane === "payments")).toBe(false);
    expect((await read(await app.request("/live/status"))).busy).toBe(false);
  });

  it("counts a run's own cost: the draft and the agent and the gates", async () => {
    const app = makeApp();
    const runId = await locked(app);
    await start(app, runId, "full");
    await finished(app);
    const cost = log.listRun(runId).reduce((n, e) => n + e.costUsd, 0);
    expect(cost).toBeGreaterThan(0);
    const status = await read(await app.request("/live/status"));
    expect(status.budget.spentUsd).toBeCloseTo(cost, 6);
    expect(status.budget.remainingUsd).toBeCloseTo(1 - cost, 6);
  });

  it("allows runs until the cap is reached and none after, and never spends past it", async () => {
    // Two cents a day: a run's draft and agent cost about a fifth of a cent, so a few fit, and the
    // review's allowance is set aside before each.
    const app = makeApp({ capUsd: 0.02 });
    const answers: number[] = [];
    for (let i = 0; i < 40 && answers.at(-1) !== 429; i++) {
      const { res, body } = await draft(app);
      if (res.status !== 201) {
        answers.push(res.status);
        break;
      }
      await decide(app, body.runId, { action: "confirm" });
      answers.push((await start(app, body.runId, "gate0")).status);
      await finished(app);
    }
    expect(answers[0]).toBe(202);
    expect(answers.at(-1)).toBe(429);
    const status = await read(await app.request("/live/status"));
    expect(status.budget.spentUsd).toBeLessThanOrEqual(0.02);
    expect(status.budget.exhausted).toBe(true);
  });

  it("lowers the agent's own cap to what is left of the day, less the review's allowance", async () => {
    earlierSpend(0.97);
    const app = makeApp();
    const runId = await locked(app);
    expect((await start(app, runId, "gate0")).status).toBe(202);
    await finished(app);
    const started = log.listRun(runId).find((e) => e.type === "agent_started");
    const maxUsd =
      (started?.payload as { limits: { maxUsd: number } } | undefined)?.limits.maxUsd ?? 0;
    // 3 cents left, less the 1 cent held back for the review, less the draft this run already cost.
    expect(maxUsd).toBeLessThan(0.02);
    expect(maxUsd).toBeGreaterThan(0.018);
    const status = await read(await app.request("/live/status"));
    expect(status.budget.spentUsd).toBeLessThanOrEqual(1);
  });

  it("a run that can't be paid for to its end is refused rather than started and cut short", async () => {
    earlierSpend(0.995);
    const app = makeApp();
    const { res, body } = await draft(app);
    expect(res.status).toBe(429);
    expect(body).toMatchObject({ error: "daily_cap", budget: { exhausted: true } });
  });

  it("starts again at midnight UTC", async () => {
    earlierSpend(1);
    const app = makeApp();
    expect((await draft(app)).res.status).toBe(429);
    clock = new Date("2026-10-24T00:00:00.000Z");
    const next = await draft(app);
    expect(next.res.status).toBe(201);
    expect((await read(await app.request("/live/status"))).budget).toMatchObject({
      spentUsd: expect.any(Number),
      resetsAt: "2026-10-25T00:00:00.000Z",
    });
  });

  it("with a cap of zero, nothing runs", async () => {
    const app = makeApp({ capUsd: 0 });
    expect((await draft(app)).res.status).toBe(429);
  });

  it("an unset live option is no budget: live runs are off rather than uncapped", async () => {
    const app = createApp({ log, arena: createArenaService({ log }) });
    const status = await read(await app.request("/live/status"));
    expect(status.available).toBe(false);
    expect((await post(app, "/live/runs", { scenarioId: "sc_b01" })).status).toBe(503);
  });
});

// A held purchase from a live run is decided from the run view or the inbox. On practice money the
// hold lives in the server's own fake, so the decision has to go through that same instance.
describe("deciding a live practice run", () => {
  // The agent buys the right keyboard and a mouse nobody asked for: Gate 0 pauses it for a person.
  const withExtra = () => shopping({ open: [HALVARD, CAIRN], buy: [HALVARD, CAIRN] });
  const decision = (app: App, runId: string, answer: string) =>
    post(app, `/events/runs/${runId}/decision`, { decision: answer });

  async function escalatedRun(app: App) {
    const runId = await locked(app);
    await start(app, runId, "gate0");
    await finished(app);
    expect(await summary(app, runId)).toMatchObject({ verdict: "escalate", escalation: "waiting" });
    return runId;
  }

  it("is carried out on the adapter the run held its money on", async () => {
    const app = makeApp({ model: withExtra() });
    const runId = await escalatedRun(app);
    expect(fake.balances()).toEqual({});
    const res = await decision(app, runId, "approve");
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ money: "captured", decidedBy: "person" });
    // The capture and the payouts happened in the fake the server holds.
    expect(Object.keys(fake.balances()).length).toBeGreaterThan(0);
    expect(await summary(app, runId)).toMatchObject({ escalation: "decided", holdOpen: false });
  });

  it("can reject it, which voids the hold in the same fake", async () => {
    const app = makeApp({ model: withExtra() });
    const runId = await escalatedRun(app);
    const res = await decision(app, runId, "reject");
    expect(await read(res)).toMatchObject({ money: "voided" });
    expect(fake.balances()).toEqual({});
  });

  it("can't be decided on another adapter: a second fake knows nothing of this run's hold", async () => {
    const app = makeApp({ model: withExtra() });
    const runId = await escalatedRun(app);
    const other = makeApp({
      payments: { name: "fake", adapter: createFakePaymentAdapter(), vaultId: "FAKE-WALLET" },
    });
    const res = await decision(other, runId, "approve");
    expect(res.status).toBe(502);
    expect(fake.balances()).toEqual({});
  });

  it("is refused, not attempted, when the run's money is on a different kind of adapter", async () => {
    const app = makeApp({ model: withExtra() });
    const runId = await escalatedRun(app);
    const sandbox = makeApp({ payments: { name: "sandbox", adapter: fake, vaultId: "V" } });
    const before = log.listRun(runId).length;
    const res = await decision(sandbox, runId, "approve");
    expect(res.status).toBe(409);
    expect(((await read(res)) as { message: string }).message).toMatch(/practice money/);
    expect(log.listRun(runId)).toHaveLength(before);
  });

  it("an eval or command-line run with no adapter recorded is refused on a practice-money server", async () => {
    const app = makeApp();
    log.append({
      runId: "run_cli",
      scenarioId: "sc_a01",
      lane: "arena",
      type: "run_started",
      provenance: "user",
      payload: { seed: "1", request: "x" },
    });
    const res = await decision(app, "run_cli", "approve");
    expect(res.status).toBe(409);
    expect(((await read(res)) as { message: string }).message).toMatch(/command line or the eval/);
  });
});
