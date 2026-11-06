import type { Event } from "@firewall/events";
import { type LockedMandate, lockedMandateOf, MandateError } from "@firewall/mandate";
import { z } from "zod";
import type { MandateStatus } from "./gate2-verdict.js";

// What the model gates (Gate 2 and Gate 3) read the same way from a run's event log: the
// checkout's numbers, the person's locked mandate, and the short refs they give the auditor for
// events.

// The checkout's numbers. The line title is not read: zod drops keys it isn't told about.
const checkedOut = z.object({
  result: z.object({
    currency: z.literal("USD"),
    lines: z.array(
      z.object({
        listingId: z.string(),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int(),
        discountCents: z.number().int(),
        totalCents: z.number().int(),
      }),
    ),
    totalCents: z.number().int(),
  }),
});

// The run's last checkout. `fail` makes the error the calling gate throws when there is none.
export function checkoutOf(events: readonly Event[], fail: (message: string) => Error) {
  const checkout = events.filter((e) => e.lane === "arena" && e.type === "checkout").at(-1);
  if (!checkout) throw fail("The run has no checkout to review");
  const parsed = checkedOut.safeParse(checkout.payload);
  if (!parsed.success || parsed.data.result.lines.length === 0) {
    throw fail(`Event ${checkout.eventId} isn't a checkout the arena writes`);
  }
  return { event: checkout, order: parsed.data.result };
}

export function mandateOf(events: readonly Event[]): {
  status: MandateStatus;
  mandate: LockedMandate | null;
} {
  const locked = events.filter((e) => e.type === "mandate_locked").at(-1);
  if (!locked) {
    return { status: { status: "missing", problems: [] }, mandate: null };
  }
  try {
    const mandate = lockedMandateOf(events);
    return { status: { status: "intact", eventId: locked.eventId }, mandate };
  } catch (error) {
    if (!(error instanceof MandateError)) throw error;
    return {
      status: { status: "altered", eventId: locked.eventId, problems: error.problems },
      mandate: null,
    };
  }
}

// Event IDs, given to the auditor as E1, E2, ... in the order they come up, and mapped back.
export class Refs {
  private readonly byId = new Map<string, string>();
  private readonly byRef = new Map<string, string>();
  readonly described: { ref: string; is: string }[] = [];
  ref(eventId: string, is: string): string {
    let ref = this.byId.get(eventId);
    if (!ref) {
      ref = `E${this.byId.size + 1}`;
      this.byId.set(eventId, ref);
      this.byRef.set(ref, eventId);
      this.described.push({ ref, is });
    }
    return ref;
  }
  refOrNull(eventId: string | null, is: string): string | null {
    return eventId === null ? null : this.ref(eventId, is);
  }
  eventIdOf = (ref: string) => this.byRef.get(ref);
  all = () => [...this.byRef.keys()];
}
