import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatCost,
  formatDate,
  formatDuration,
  formatElapsed,
  formatHoldEnds,
  formatPercent,
  formatSpan,
  formatTime,
} from "./format";

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

describe("formatSpan", () => {
  const minute = 60_000;
  it("uses the largest whole unit, rounding down", () => {
    expect(formatSpan(0)).toBe("less than a minute");
    expect(formatSpan(59_999)).toBe("less than a minute");
    expect(formatSpan(minute)).toBe("1 minute");
    expect(formatSpan(45 * minute)).toBe("45 minutes");
    expect(formatSpan(60 * minute)).toBe("1 hour");
    expect(formatSpan(23.9 * 60 * minute)).toBe("23 hours");
    expect(formatSpan(24 * 60 * minute)).toBe("1 day");
    expect(formatSpan(28.9 * 24 * 60 * minute)).toBe("28 days");
  });

  it("reads a time that hasn't happened yet as nothing", () => {
    expect(formatSpan(-5 * minute)).toBe("less than a minute");
  });
});

describe("formatAgo and formatHoldEnds", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  it("says how long ago, and 'just now' inside the first minute", () => {
    expect(formatAgo("2026-10-30T11:59:40Z", now)).toBe("just now");
    expect(formatAgo("2026-10-30T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatAgo("nope", now)).toBe("nope");
  });

  it("says how long a hold has left, and when it has ended", () => {
    expect(formatHoldEnds("2026-11-27T12:00:00Z", now)).toBe("Hold ends in 28 days");
    expect(formatHoldEnds("2026-10-30T17:30:00Z", now)).toBe("Hold ends in 5 hours");
    expect(formatHoldEnds("2026-10-30T11:00:00Z", now)).toBe("The hold has ended");
    expect(formatHoldEnds("", now)).toBe("");
  });
});

describe("formatPercent", () => {
  it("writes a rate with one decimal, and n/a for a rate with nothing to divide", () => {
    expect(formatPercent(0.6875)).toBe("68.8%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(null)).toBe("n/a");
  });
});

describe("formatDuration", () => {
  it("writes milliseconds under a second and seconds above", () => {
    expect(formatDuration(1)).toBe("1 ms");
    expect(formatDuration(840.4)).toBe("840 ms");
    expect(formatDuration(3344.7)).toBe("3.3 s");
    expect(formatDuration(null)).toBe("n/a");
  });
});

describe("formatDate", () => {
  it("writes a calendar date day first, whatever the viewer's zone", () => {
    expect(formatDate("2026-10-26")).toBe("26 Oct 2026");
    expect(formatDate("2026-01-03")).toBe("3 Jan 2026");
    expect(formatDate("soon")).toBe("soon");
  });
});
