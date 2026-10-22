import { randomBytes } from "node:crypto";

// Event IDs sort by creation time (a base-36 millisecond timestamp) with random bits after it, so
// two IDs made in the same millisecond still differ.
export function newEventId(now: Date = new Date()): string {
  const time = now.getTime().toString(36).padStart(9, "0");
  const random = randomBytes(6).toString("hex");
  return `ev_${time}${random}`;
}
