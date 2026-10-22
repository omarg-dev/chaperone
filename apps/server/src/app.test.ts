import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaService, SCENARIOS } from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { version } from "./version.js";

let dir: string;
let log: EventLog;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "server-"));
  log = openEventLog({ path: join(dir, "events.db") });
  app = createApp({ log, arena: createArenaService({ log, newRunId: () => "run_http" }) });
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("GET /health", () => {
  it("answers ok with the app version", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version });
  });
});

describe("arena routes", () => {
  it("lists every scenario, attacks included, without their answer key", async () => {
    const scenarios = (await (await app.request("/arena/scenarios")).json()) as object[];
    expect(scenarios).toHaveLength(SCENARIOS.length);
    // Nothing says which are attacks or what they do: no kind, no attack, no intent.
    for (const scenario of scenarios) {
      expect(Object.keys(scenario).sort()).toEqual(["request", "scenarioId", "title"]);
    }
  });

  it("runs an attack scenario like any other, serving what the attacker injected", async () => {
    await post("/arena/runs", { scenarioId: "sc_a03", seed: "1" });
    const hits = (await (
      await app.request("/arena/runs/run_http/search?q=harrow&category=headphones")
    ).json()) as { sellerName: string }[];
    expect(hits.some((h) => h.sellerName.endsWith(" Co."))).toBe(true);
  });

  it("shops end to end: start, search, view, add, check out", async () => {
    const started = await post("/arena/runs", { scenarioId: "sc_b01", seed: "1" });
    expect(started.status).toBe(201);
    expect(await started.json()).toMatchObject({ runId: "run_http", scenarioId: "sc_b01" });

    const hits = (await (await app.request("/arena/runs/run_http/search?q=tactile")).json()) as {
      listingId: string;
    }[];
    const listingId = hits[0]?.listingId as string;
    const view = await app.request(`/arena/runs/run_http/listings/${listingId}`);
    expect(((await view.json()) as { catalog: object }).catalog).toHaveProperty("sku");
    const reviews = await app.request(`/arena/runs/run_http/listings/${listingId}/reviews`);
    expect(((await reviews.json()) as unknown[]).length).toBeGreaterThan(0);

    expect((await post("/arena/runs/run_http/cart", { listingId })).status).toBe(200);
    const order = (await (await post("/arena/runs/run_http/checkout", {})).json()) as {
      lines: { payeeKey: string }[];
    };
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]?.payeeKey).toMatch(/^seller_/);

    const events = (await (await app.request("/events/runs/run_http")).json()) as {
      type: string;
    }[];
    expect(events.map((e) => e.type)).toEqual([
      "run_started",
      "search",
      "listing_viewed",
      "reviews_viewed",
      "cart_updated",
      "checkout",
    ]);
  });

  it("links an arena event to the caller's event from the header", async () => {
    await post("/arena/runs", { scenarioId: "sc_b01" });
    const call = log.append({
      runId: "run_http",
      lane: "agent",
      type: "tool_call",
      provenance: "system",
    });
    await app.request("/arena/runs/run_http/search", {
      headers: { "x-parent-event-id": call.eventId },
    });
    expect(log.listRun("run_http").at(-1)?.parentId).toBe(call.eventId);
  });

  it("answers 404 for an unknown scenario, run or listing", async () => {
    expect((await post("/arena/runs", { scenarioId: "sc_nope" })).status).toBe(404);
    expect((await app.request("/arena/runs/run_nope/cart")).status).toBe(404);
    await post("/arena/runs", { scenarioId: "sc_b01" });
    const res = await app.request("/arena/runs/run_http/listings/lst_nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("answers 400 for a malformed request and 409 for an empty checkout", async () => {
    await post("/arena/runs", { scenarioId: "sc_b01" });
    expect((await post("/arena/runs/run_http/cart", { quantity: 1 })).status).toBe(400);
    expect((await app.request("/arena/runs/run_http/search?category=toaster")).status).toBe(400);
    expect((await post("/arena/runs/run_http/checkout", {})).status).toBe(409);
  });

  it("answers 400 when the parent event doesn't exist", async () => {
    await post("/arena/runs", { scenarioId: "sc_b01" });
    const res = await app.request("/arena/runs/run_http/search", {
      headers: { "x-parent-event-id": "ev_missing" },
    });
    expect(res.status).toBe(400);
  });
});

describe("event routes", () => {
  it("lists runs", async () => {
    await post("/arena/runs", { scenarioId: "sc_b02" });
    const runs = (await (await app.request("/events/runs")).json()) as { runId: string }[];
    expect(runs.map((r) => r.runId)).toEqual(["run_http"]);
  });
});
