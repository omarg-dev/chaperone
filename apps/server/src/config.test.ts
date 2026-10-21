import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("readConfig", () => {
  it("defaults the port to 3000", () => {
    expect(readConfig({})).toEqual({ port: 3000 });
  });

  it("reads PORT", () => {
    expect(readConfig({ PORT: "8080" })).toEqual({ port: 8080 });
  });

  it.each(["abc", "0", "70000", "3000.5"])("refuses PORT=%s", (value) => {
    expect(() => readConfig({ PORT: value })).toThrow(/PORT must be/);
  });
});
