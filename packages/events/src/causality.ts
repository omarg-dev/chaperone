import type { Event } from "./types.js";

// The chain of events that led to this one, nearest parent first. Stops at an event whose parent
// isn't in the list (or has none), and guards against a cycle so bad data can't hang a caller.
export function ancestors(events: readonly Event[], eventId: string): Event[] {
  const byId = new Map(events.map((e) => [e.eventId, e]));
  const chain: Event[] = [];
  const seen = new Set<string>([eventId]);
  let parentId = byId.get(eventId)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.push(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

// Events whose parent is this one, in log order.
export function children(events: readonly Event[], eventId: string): Event[] {
  return events.filter((e) => e.parentId === eventId);
}
