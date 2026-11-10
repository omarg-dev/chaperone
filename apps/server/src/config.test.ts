import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("readConfig", () => {
  it("defaults the port to 3000 and the data folder to data/", () => {
    expect(readConfig({})).toEqual({
      port: 3000,
      dataDir: "data",
      resultsDir: null,
      liveDailyUsd: 0.25,
      studioDailyUsd: 0.1,
      agStudioLicenseKey: null,
    });
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

  it("caps a day's live runs at $0.25 unless FIREWALL_LIVE_DAILY_USD says otherwise", () => {
    expect(readConfig({}).liveDailyUsd).toBe(0.25);
    expect(readConfig({ FIREWALL_LIVE_DAILY_USD: "" }).liveDailyUsd).toBe(0.25);
    expect(readConfig({ FIREWALL_LIVE_DAILY_USD: "2.5" }).liveDailyUsd).toBe(2.5);
    // Zero turns live runs off for the day.
    expect(readConfig({ FIREWALL_LIVE_DAILY_USD: "0" }).liveDailyUsd).toBe(0);
  });

  it.each(["abc", "-1", "$1", "Infinity"])("refuses FIREWALL_LIVE_DAILY_USD=%s", (value) => {
    expect(() => readConfig({ FIREWALL_LIVE_DAILY_USD: value })).toThrow(
      /FIREWALL_LIVE_DAILY_USD must be/,
    );
  });

  it("caps a day's dashboard assistant at $0.10 unless FIREWALL_STUDIO_DAILY_USD says otherwise", () => {
    expect(readConfig({}).studioDailyUsd).toBe(0.1);
    expect(readConfig({ FIREWALL_STUDIO_DAILY_USD: "0.5" }).studioDailyUsd).toBe(0.5);
    expect(readConfig({ FIREWALL_STUDIO_DAILY_USD: "0" }).studioDailyUsd).toBe(0);
    expect(() => readConfig({ FIREWALL_STUDIO_DAILY_USD: "-1" })).toThrow(
      /FIREWALL_STUDIO_DAILY_USD must be/,
    );
  });

  it("reads AG Studio's licence key, and leaves it unset otherwise", () => {
    expect(readConfig({ AG_STUDIO_LICENSE_KEY: " key " }).agStudioLicenseKey).toBe("key");
    expect(readConfig({ AG_STUDIO_LICENSE_KEY: "" }).agStudioLicenseKey).toBeNull();
  });

  it.each(["abc", "0", "70000", "3000.5"])("refuses PORT=%s", (value) => {
    expect(() => readConfig({ PORT: value })).toThrow(/PORT must be/);
  });
});
