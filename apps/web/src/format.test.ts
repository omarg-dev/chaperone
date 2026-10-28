import { describe, expect, it } from "vitest";
import { formatCost, formatElapsed, formatTime } from "./format";

describe("formatTime", () => {
  it("writes day first, in English, with the viewer's zone named", () => {
    expect(formatTime("2026-10-27T18:23:40.000Z", "Asia/Riyadh")).toBe("27 Oct 2026, 21:23 GMT+3");
    expect(formatTime("2026-10-27T18:23:40.000Z", "UTC")).toBe("27 Oct 2026, 18:23 UTC");
    expect(formatTime("2026-10-27T18:23:40.000Z", "America/Los_Angeles")).toBe(
      "27 Oct 2026, 11:23 GMT-7",
    );
  });

  it("uses the device's zone when none is given", () => {
    expect(formatTime("2026-10-27T18:23:40.000Z")).toMatch(/^27 Oct 2026, \d\d:\d\d \S+$/);
  });

  it("gives back what it can't read", () => {
    expect(formatTime("not a time")).toBe("not a time");
  });
});

describe("formatElapsed", () => {
  it("keeps a decimal under ten seconds, then whole seconds, then minutes", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(4240)).toBe("4.2s");
    expect(formatElapsed(31_400)).toBe("31s");
    expect(formatElapsed(63_000)).toBe("1m 03s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("formatCost", () => {
  it("shows fractions of a cent, and says so when there is no cost", () => {
    expect(formatCost(0.0017882)).toBe("$0.0018");
    expect(formatCost(0)).toBe("No cost");
  });
});
