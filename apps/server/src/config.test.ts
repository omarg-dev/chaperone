import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("readConfig", () => {
  it("defaults the port to 3000 and the data folder to data/", () => {
    expect(readConfig({})).toEqual({ port: 3000, dataDir: "data", resultsDir: null });
  });

  it("reads PORT", () => {
    expect(readConfig({ PORT: "8080" })).toMatchObject({ port: 8080, dataDir: "data" });
  });

  it("reads DATA_DIR", () => {
    expect(readConfig({ DATA_DIR: "/data" }).dataDir).toBe("/data");
  });

  it("reads RESULTS_DIR, and leaves it unset otherwise", () => {
    expect(readConfig({ RESULTS_DIR: "/srv/results" }).resultsDir).toBe("/srv/results");
    expect(readConfig({ RESULTS_DIR: "" }).resultsDir).toBeNull();
  });

  it.each(["abc", "0", "70000", "3000.5"])("refuses PORT=%s", (value) => {
    expect(() => readConfig({ PORT: value })).toThrow(/PORT must be/);
  });
});
