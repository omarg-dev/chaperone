import type { ArenaService, Catalog, OrderDraft } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";

// What the firewall needs from the merchant side, which an agent can't supply for itself. The
// gates compare the cart against a *trusted* catalog and read the page content the agent was
// served, so both have to come from the marketplace and never from the agent's own tool calls
// (an agent that has been steered will report whatever the attacker wants it to).
//
// In v1 the only source is the arena, which writes both into the event log as it serves them.
// Protecting an agent in a marketplace outside the arena needs a source from that merchant that
// does the same: that is future work, and `CatalogSource` is the seam it would plug into.
export interface CatalogSource {
  readonly runId: string;
  readonly scenarioId: string;
  // What the person asked for, when the source recorded it. A mandate request that names no text
  // of its own uses this one.
  readonly request?: string;
  // The trusted catalog the cart is compared against, as the merchant has it.
  catalog(): Catalog;
  // The merchant turns the cart into the order to hold, and writes the checkout event the review
  // reads (lane arena, type checkout) under `parentId`, the agent's tool call.
  checkout(parentId: string): { draft: OrderDraft; eventId: string };
}

export interface ArenaSourceOptions {
  arena: ArenaService;
  log: EventLog;
  runId: string;
}

export function arenaSource(options: ArenaSourceOptions): CatalogSource {
  const { arena, log, runId } = options;
  const run = arena.get(runId);
  return {
    runId,
    scenarioId: run.scenario.scenarioId,
    request: run.scenario.request,
    catalog: () => arena.get(runId).arena.catalog,
    checkout(parentId) {
      // The arena service writes the event itself; this catches it so the payment calls that
      // follow can point at it.
      let event: Event | undefined;
      const stop = log.subscribe((e) => {
        if (e.lane === "arena" && e.parentId === parentId) event = e;
      });
      try {
        const draft = arena.checkout(runId, { parentId });
        if (!event) throw new Error("The arena call wrote no event");
        return { draft, eventId: event.eventId };
      } finally {
        stop();
      }
    },
  };
}
