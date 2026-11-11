import type { ReactNode } from "react";
import type { ZoneKind } from "../design";

// What the timeline draws. It knows nothing about runs, gates or payments: an item has a time, a
// zone, a kind and something to say. That is the whole interface, so the component can be swapped
// for another vertical timeline (Bryntum Scheduler's vertical mode was the plan) by mapping the
// same items.

export type NodeTone = "none" | "hold" | "approve" | "escalate" | "block" | "attacker";

export interface TimelineItem {
  id: string;
  // ISO time. Items are drawn in the order given; the time labels the row.
  at: string;
  // Which column: the catalog (plain), the route (the spine) or seller-written text (hatched).
  zone: ZoneKind;
  // "event" is a card; "station" sits on the spine with a node beside it.
  kind: "event" | "station";
  // The small label over the title.
  tag?: string;
  title: string;
  // Sits next to the title: a verdict pill, say.
  aside?: ReactNode;
  body?: ReactNode;
  // The node's colour for a station, and the outline of a card.
  tone?: NodeTone;
  // Items with the same group share a row, so what was read lines up with what read it.
  group?: string;
  // From this row down, the spine is the money's route (solid) rather than dashed.
  spine?: "money";
}

// What goes below the last row: the places the money can leave the route. Each is drawn in its
// own column, under the zone it belongs to.
export interface TimelineFooter {
  catalog?: ReactNode;
  route?: ReactNode;
  seller?: ReactNode;
  // Which of the three the money took, so the other two are drawn as the roads not taken.
  taken?: "catalog" | "route" | "seller";
  takenTone?: NodeTone;
}

export const COLUMN_LABELS: Record<ZoneKind, string> = {
  catalog: "You, the agent and the checks",
  route: "The money",
  seller: "Written by sellers",
};
