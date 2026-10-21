import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { version } from "./version.js";

describe("GET /health", () => {
  it("answers ok with the app version", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version });
  });
});
