import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaService } from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

let dir: string;
let webDir: string;
let log: EventLog;
let app: ReturnType<typeof createApp>;

const html = { accept: "text/html" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "server-web-"));
  webDir = join(dir, "web");
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Chaperone</title>");
  writeFileSync(join(webDir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(join(webDir, "assets", "index-abc123.js"), "console.log('app')");
  // Next to the web folder, to prove a path can't climb out of it.
  writeFileSync(join(dir, "secret.txt"), "not for the browser");
  log = openEventLog({ path: join(dir, "events.db") });
  app = createApp({ log, arena: createArenaService({ log }), webDir });
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("serving the web app", () => {
  it("serves index.html at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>Chaperone</title>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("still answers /health and /events/runs as the API", async () => {
    const health = await app.request("/health", { headers: html });
    expect(health.headers.get("content-type")).toContain("application/json");
    expect(((await health.json()) as { status: string }).status).toBe("ok");

    const runs = await app.request("/events/runs", { headers: html });
    expect(runs.status).toBe(200);
    expect(await runs.json()).toEqual([]);
  });

  it("serves built files with their type, and caches hashed assets for good", async () => {
    const asset = await app.request("/assets/index-abc123.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await app.request("/favicon.svg")).headers.get("content-type")).toBe("image/svg+xml");
  });

  it("gives the app to a browser at the app's own pages, /arena included", async () => {
    for (const path of ["/runs", "/runs/run_1", "/escalations", "/dashboard", "/arena"]) {
      const res = await app.request(path, { headers: html });
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain("<title>Chaperone</title>");
    }
  });

  it("keeps /arena the API for anything that isn't a browser navigation", async () => {
    expect((await app.request("/arena/scenarios")).headers.get("content-type")).toContain(
      "application/json",
    );
    const bare = await app.request("/arena", { headers: { accept: "application/json" } });
    expect(bare.status).toBe(404);
  });

  it("answers 404 for a missing file or an unknown API path, never the page", async () => {
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    const unknown = await app.request("/nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "not_found" });
  });

  it("does not serve a file outside the web folder", async () => {
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("not for the browser");
    }
  });

  it("is the API alone when there is no web folder", async () => {
    const bare = createApp({ log, arena: createArenaService({ log }) });
    expect((await bare.request("/")).status).toBe(404);
    expect((await bare.request("/health")).status).toBe(200);
  });
});
