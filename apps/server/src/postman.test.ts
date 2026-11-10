import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createArenaService } from "@firewall/arena";
import { type EventLog, openEventLog } from "@firewall/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createApp } from "./app.js";
import { addLineBody, couponBody, searchQuery, startRunBody } from "./routes/arena.js";
import { decisionBody } from "./routes/events.js";
import { draftBody, mandateActionBody, startBody } from "./routes/live.js";

// The Postman collection (docs/postman) is a map of the public API, so it must not drift from it:
// every request has to be a route the server registers, every example body has to pass that
// route's zod schema, and every API route has to be in the collection.

interface PostmanUrl {
  path: string[];
  query?: { key: string; value: string; disabled?: boolean }[];
  variable?: { key: string; value: string }[];
}
interface PostmanRequest {
  method: string;
  url: PostmanUrl;
  body?: { mode: string; raw: string };
}
interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  response?: { name: string; code: number; originalRequest: PostmanRequest; body: string }[];
}
interface Collection {
  info: { schema: string };
  variable: { key: string; value: string }[];
  item: PostmanItem[];
}

const read = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../docs/postman/${name}`, import.meta.url)), "utf8"),
  );
const collection: Collection = read("chaperone.postman_collection.json");

// Where each route's input is validated: the same schema objects the routes use.
const BODY_SCHEMAS: Record<string, z.ZodType> = {
  "POST /live/runs": draftBody,
  "POST /live/runs/:runId/mandate": mandateActionBody,
  "POST /live/runs/:runId/start": startBody,
  "POST /events/runs/:runId/decision": decisionBody,
  "POST /arena/runs": startRunBody,
  "POST /arena/runs/:runId/cart": addLineBody,
  "POST /arena/runs/:runId/coupons": couponBody,
};
const QUERY_SCHEMAS: Record<string, z.ZodType> = {
  "GET /arena/runs/:runId/search": searchQuery,
};
// The prefixes that make up the public API. Anything else the app serves (the web app, routes
// that belong to other features) is not this collection's to list.
const API_PREFIXES = ["/health", "/arena", "/events", "/live", "/eval"];

const variables = new Map(collection.variable.map((v) => [v.key, v.value]));
const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables.get(key) ?? "");

function requests(
  items: PostmanItem[],
): { name: string; request: PostmanRequest; item: PostmanItem }[] {
  return items.flatMap((item) =>
    item.item
      ? requests(item.item)
      : item.request
        ? [{ name: item.name, request: item.request, item }]
        : [],
  );
}

const keyOf = (request: PostmanRequest) => `${request.method} /${request.url.path.join("/")}`;

let dir: string;
let log: EventLog;
let registered: Set<string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "postman-"));
  log = openEventLog({ path: join(dir, "events.db") });
  const app = createApp({ log, arena: createArenaService({ log }) });
  registered = new Set(
    app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`),
  );
});

afterEach(() => {
  log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Postman collection", () => {
  it("is a v2.1 collection with a baseUrl for the hosted demo", () => {
    expect(collection.info.schema).toBe(
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    );
    expect(variables.get("baseUrl")).toBe("https://chaperone.omarg.dev");
  });

  it("has a local environment on the server's default port", () => {
    const environment = read("local.postman_environment.json");
    expect(environment.values).toEqual([
      expect.objectContaining({ key: "baseUrl", value: "http://localhost:3000" }),
    ]);
  });

  it("test_postman_collection_matches_the_routes: every request is a registered route", () => {
    const all = requests(collection.item);
    expect(all.length).toBeGreaterThan(0);
    for (const { name, request } of all) {
      expect(registered, `"${name}" is ${keyOf(request)}`).toContain(keyOf(request));
    }
  });

  it("names a path variable for each :param", () => {
    for (const { name, request } of requests(collection.item)) {
      const params = request.url.path.filter((s) => s.startsWith(":")).map((s) => s.slice(1));
      const declared = (request.url.variable ?? []).map((v) => v.key);
      expect(declared.sort(), name).toEqual(params.sort());
    }
  });

  it("lists every API route", () => {
    const listed = new Set(requests(collection.item).map(({ request }) => keyOf(request)));
    const missing = [...registered].filter(
      (route) =>
        API_PREFIXES.some((prefix) => route.split(" ")[1]?.startsWith(prefix)) &&
        !listed.has(route),
    );
    expect(missing).toEqual([]);
  });

  it("gives every request body, and every saved example's body, to the route's schema", () => {
    const checked = new Set<string>();
    for (const { name, request, item } of requests(collection.item)) {
      const key = keyOf(request);
      const bodies = [request, ...(item.response ?? []).map((example) => example.originalRequest)];
      for (const candidate of bodies) {
        const schema = BODY_SCHEMAS[key];
        if (candidate.body) {
          expect(schema, `${name} sends a body but ${key} has no schema`).toBeDefined();
          const parsed = (schema as z.ZodType).safeParse(JSON.parse(fill(candidate.body.raw)));
          expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
          checked.add(key);
        } else {
          expect(schema, `${name} has no body but ${key} needs one`).toBeUndefined();
        }
        const querySchema = QUERY_SCHEMAS[key];
        if (querySchema) {
          const query = Object.fromEntries(
            (candidate.url.query ?? [])
              .filter((q) => !q.disabled)
              .map((q) => [q.key, fill(q.value)]),
          );
          const parsed = querySchema.safeParse(query);
          expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
          checked.add(key);
        }
      }
    }
    // Every route with a schema is exercised by at least one request.
    expect([...checked].sort()).toEqual(
      [...Object.keys(BODY_SCHEMAS), ...Object.keys(QUERY_SCHEMAS)].sort(),
    );
  });

  it("covers all three mandate actions", () => {
    const actions = requests(collection.item)
      .filter(({ request }) => keyOf(request) === "POST /live/runs/:runId/mandate")
      .map(({ request }) => JSON.parse(request.body?.raw ?? "{}").action);
    expect(actions.sort()).toEqual(["confirm", "edit", "reject"]);
  });

  it("holds only JSON saved responses and no secrets", () => {
    const text = readFileSync(
      fileURLToPath(
        new URL("../../../docs/postman/chaperone.postman_collection.json", import.meta.url),
      ),
      "utf8",
    );
    for (const { item } of requests(collection.item)) {
      for (const example of item.response ?? []) JSON.parse(example.body);
    }
    expect(text).not.toMatch(/sk-ant|Bearer |client_secret|"apikey"/i);
  });
});
