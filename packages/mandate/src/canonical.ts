import { createHash } from "node:crypto";

// JSON with every object's keys in sorted order and no whitespace, so the same value always gives
// the same text, whatever order its keys were written in. Array order is kept: it means something.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Can't serialise ${value}: JSON has no such number`);
  }
  return value;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
