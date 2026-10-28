import { describe, expect, it } from "vitest";
import { formatTime } from "./format";

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
