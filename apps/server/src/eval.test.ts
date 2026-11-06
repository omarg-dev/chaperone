import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaService } from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

// The eval's results over HTTP, from a real folder in a temp directory. The files are copies of the
// committed first matrix (a real `buildResults` file) with their settings changed.

const first = JSON.parse(
  readFileSync(
    new URL("../../../results/2026-10-26T0012-fake-claude-haiku-5-5.json", import.meta.url),
    "utf8",
  ),
);

let dir: string;
let resultsDir: string;
let log: EventLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "server-eval-"));
  resultsDir = join(dir, "results");
  mkdirSync(resultsDir);
  log = openEventLog({ path: join(dir, "events.db") });
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

const appFor = (folder: string | undefined) =>
  createApp({ log, arena: createArenaService({ log }), ...(folder && { resultsDir: folder }) });

const withMeta = (meta: Record<string, unknown>) => ({
  ...first,
  meta: { ...first.meta, ...meta },
});

// What the routes answer, as far as these tests look into it.
interface Listed {
  available: boolean;
  results: { name: string }[];
  unreadable: { name: string; reason: string }[];
}
interface One {
  name: string;
  error?: string;
  message?: string;
  results: {
    meta: { paymentAdapter: string };
    metrics: { configs: unknown };
    cells: unknown[];
  };
}
const listed = async (res: Response) => (await res.json()) as Listed;
const one = async (res: Response) => (await res.json()) as One;

const put = (name: string, content: unknown) =>
  writeFileSync(
    join(resultsDir, name),
    typeof content === "string" ? content : JSON.stringify(content),
  );

describe("GET /eval/results", () => {
  it("lists each file's adapter, model column, gate model, seeds and date, newest first", async () => {
    put("old-fake.json", withMeta({ startedAt: "2026-10-20T09:00:00.000Z", date: "2026-10-20" }));
    put(
      "new-sandbox.json",
      withMeta({
        paymentAdapter: "sandbox",
        startedAt: "2026-10-30T09:00:00.000Z",
        date: "2026-10-30",
        seeds: ["1", "2", "3"],
      }),
    );
    const res = await appFor(resultsDir).request("/eval/results");
    expect(res.status).toBe(200);
    const body = await listed(res);
    expect(body.available).toBe(true);
    expect(body.unreadable).toEqual([]);
    expect(body.results.map((r) => r.name)).toEqual(["new-sandbox", "old-fake"]);
    expect(body.results[0]).toEqual({
      name: "new-sandbox",
      paymentAdapter: "sandbox",
      column: {
        columnId: "claude-haiku-5-5",
        label: "Claude Haiku 5.5",
        modelId: "claude-haiku-5-5",
      },
      gateModel: "claude-haiku-5-5",
      seeds: ["1", "2", "3"],
      date: "2026-10-30",
      startedAt: "2026-10-30T09:00:00.000Z",
    });
  });

  it("serves only .json files, and says which it couldn't read and why", async () => {
    put("good.json", first);
    put("good.md", "# not served");
    put("good.events.db", "not served");
    put("broken.json", "{nope");
    put("old-shape.json", withMeta({ schemaVersion: 99 }));
    const body = await listed(await appFor(resultsDir).request("/eval/results"));
    expect(body.results.map((r) => r.name)).toEqual(["good"]);
    expect(body.unreadable).toEqual([
      { name: "broken", reason: "The file isn't valid JSON." },
      {
        name: "old-shape",
        reason: "The file isn't a results file this version reads (at meta.schemaVersion).",
      },
    ]);
  });

  it("says the folder is empty, not missing, when there are no files", async () => {
    const body = await listed(await appFor(resultsDir).request("/eval/results"));
    expect(body).toEqual({ available: true, results: [], unreadable: [] });
  });

  it("says the folder is missing when it isn't there, or when none is set", async () => {
    const missing = await appFor(join(dir, "nowhere")).request("/eval/results");
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ available: false, results: [], unreadable: [] });
    const unset = await appFor(undefined).request("/eval/results");
    expect(await unset.json()).toEqual({ available: false, results: [], unreadable: [] });
  });

  it("doesn't list a symbolic link, even to a real results file", async () => {
    writeFileSync(join(dir, "elsewhere.json"), JSON.stringify(first));
    symlinkSync(join(dir, "elsewhere.json"), join(resultsDir, "linked.json"));
    const body = await listed(await appFor(resultsDir).request("/eval/results"));
    expect(body.results).toEqual([]);
  });
});

describe("GET /eval/results/:name", () => {
  it("serves one file, validated, with the harness's own rates and no gate reasons", async () => {
    put("one.json", first);
    const res = await appFor(resultsDir).request("/eval/results/one");
    expect(res.status).toBe(200);
    const body = await one(res);
    expect(body.name).toBe("one");
    expect(body.results.meta.paymentAdapter).toBe("fake");
    expect(body.results.metrics.configs).toEqual(first.metrics.configs);
    expect(body.results.cells).toHaveLength(first.cells.length);
    expect(JSON.stringify(body)).not.toContain("is on the verified-seller list");
  });

  it("answers 404 for a file that isn't there", async () => {
    const res = await appFor(resultsDir).request("/eval/results/nope");
    expect(res.status).toBe(404);
    expect((await one(res)).error).toBe("not_found");
  });

  it("answers 404 when the server has no folder", async () => {
    put("one.json", first);
    expect((await appFor(undefined).request("/eval/results/one")).status).toBe(404);
  });

  it("answers 422 with the reason for a file that isn't a results file", async () => {
    put("broken.json", "{nope");
    put("wrong.json", { meta: {}, metrics: {}, cells: [] });
    const broken = await appFor(resultsDir).request("/eval/results/broken");
    expect(broken.status).toBe(422);
    expect(await broken.json()).toEqual({
      error: "invalid_results",
      message: "The file isn't valid JSON.",
    });
    const wrong = await appFor(resultsDir).request("/eval/results/wrong");
    expect(wrong.status).toBe(422);
  });

  it("is read-only", async () => {
    put("one.json", first);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await appFor(resultsDir).request("/eval/results/one", { method });
      expect(res.status).toBe(404);
    }
    expect(readFileSync(join(resultsDir, "one.json"), "utf8")).toBe(JSON.stringify(first));
  });

  describe("never reads outside the folder", () => {
    beforeEach(() => {
      // A real results file next to the folder, and one with a name that looks like a path.
      writeFileSync(join(dir, "secret.json"), JSON.stringify(first));
      writeFileSync(join(dir, "events.db.json"), JSON.stringify(first));
      put("inside.json", first);
    });

    it.each([
      "../secret",
      "..%2Fsecret",
      "%2e%2e%2fsecret",
      "..%252Fsecret",
      "..\\secret",
      "..%5Csecret",
      "/etc/passwd",
      "%2Fetc%2Fpasswd",
      "inside.json%00",
      "..",
      "%2e%2e",
      "inside/../../secret",
      "inside%2F..%2F..%2Fsecret",
    ])("treats %s as no such result", async (name) => {
      const res = await appFor(resultsDir).request(`/eval/results/${name}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("paymentAdapter");
    });

    it("doesn't follow a symbolic link out of the folder", async () => {
      symlinkSync(join(dir, "secret.json"), join(resultsDir, "linked.json"));
      expect((await appFor(resultsDir).request("/eval/results/linked")).status).toBe(404);
    });

    it("still serves the file it was asked for", async () => {
      expect((await appFor(resultsDir).request("/eval/results/inside")).status).toBe(200);
    });
  });
});
