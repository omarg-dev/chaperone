import { describe, expect, it } from "vitest";
import { newEventId } from "./ids.js";

describe("newEventId", () => {
  it("sorts by creation time", () => {
    const earlier = newEventId(new Date(Date.UTC(2026, 10, 1)));
    const later = newEventId(new Date(Date.UTC(2026, 10, 2)));
    expect(earlier < later).toBe(true);
  });

  it("differs within the same millisecond", () => {
    const now = new Date();
    expect(newEventId(now)).not.toBe(newEventId(now));
  });

  it("has the ev_ prefix and a fixed length", () => {
    expect(newEventId()).toMatch(/^ev_[0-9a-z]{9}[0-9a-f]{12}$/);
  });
});
