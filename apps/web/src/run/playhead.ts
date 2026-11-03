// The replay's playhead, as pure functions: where it is, how long to wait before it moves and what
// the key under the person's hand should do. The run view draws the model of the events up to the
// playhead (`buildRun(events.slice(0, position))`), so a replay can't drift from the live view and
// a half-written log is already something it knows how to draw.
//
// A position is how many events are shown, from 1 (just the first) to the number of events in the
// run. It is what the address carries as `?at=`: a shared link opens at that moment.

import type { RunEvent } from "./events";
import { list, obj, str } from "./events";

export const SPEEDS = ["1x", "4x", "instant"] as const;
export type Speed = (typeof SPEEDS)[number];

export const SPEED_LABELS: Record<Speed, string> = {
  "1x": "1×",
  "4x": "4×",
  instant: "Instant",
};

// A model turn can take half a minute. Replayed at its real length nobody would stay, so at 1x a
// quiet gap is waited out for at most this long.
export const GAP_CAP_MS = 1500;

export const clampPosition = (position: number, total: number): number =>
  total <= 0 ? 0 : Math.min(Math.max(1, Math.round(position)), total);

// Where `?at=` says to start: a position, or the ID of an event (which is the position of that
// event). Null when it says nothing usable, so a stale link opens the run as it always did. A
// position past the end is the end.
export function parseAt(raw: string | null, events: readonly RunEvent[]): number | null {
  if (!raw || events.length === 0) return null;
  if (/^\d+$/.test(raw)) {
    const position = Number(raw);
    return position < 1 ? null : clampPosition(position, events.length);
  }
  const index = events.findIndex((e) => e.eventId === raw);
  return index < 0 ? null : index + 1;
}

// The real time between the event at this position and the one after it.
export function gapMs(events: readonly RunEvent[], position: number): number {
  const here = events[position - 1];
  const next = events[position];
  if (!here || !next) return 0;
  return Math.max(0, Date.parse(next.ts) - Date.parse(here.ts)) || 0;
}

// How long to wait at this position before showing the next event: the real gap with quiet ones
// capped at 1x, a quarter of that at 4x, and none at all when instant.
export function stepDelayMs(events: readonly RunEvent[], position: number, speed: Speed): number {
  if (speed === "instant") return 0;
  const wait = Math.min(gapMs(events, position), GAP_CAP_MS);
  return speed === "4x" ? wait / 4 : wait;
}

// Where playing goes next. Instant doesn't animate: it goes straight to the end.
export function nextPosition(position: number, total: number, speed: Speed): number {
  return speed === "instant" ? total : clampPosition(position + 1, total);
}

export const stepBy = (position: number, delta: number, total: number): number =>
  clampPosition(position + delta, total);

// How far into the run the event at this position happened.
export function elapsedAt(events: readonly RunEvent[], position: number): number {
  const first = events[0];
  const at = events[position - 1];
  if (!first || !at) return 0;
  return Math.max(0, Date.parse(at.ts) - Date.parse(first.ts)) || 0;
}

// Keyboard: space plays and pauses, the arrows step by one event, Home and End go to the ends.
// Keys that mean something to the thing being used (a button's own space, the text in a search
// box, a slider's arrows) are left to it.
export type PlayheadKey = "toggle" | "back" | "forward" | "first" | "last";

export function keyCommand(
  key: string,
  target: { tag: string; type?: string | null },
  modifiers: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {},
): PlayheadKey | null {
  if (modifiers.alt || modifiers.ctrl || modifiers.meta) return null;
  const tag = target.tag.toLowerCase();
  if (tag === "textarea" || tag === "select") return null;
  const typing = tag === "input" && target.type !== "range" && target.type !== "button";
  if (typing) return null;
  const slider = tag === "input" && target.type === "range";
  const pressable = slider || tag === "button" || tag === "a" || tag === "summary";
  switch (key) {
    case " ":
      return pressable ? null : "toggle";
    case "ArrowLeft":
      return slider ? null : "back";
    case "ArrowRight":
      return slider ? null : "forward";
    case "Home":
      return slider ? null : "first";
    case "End":
      return slider ? null : "last";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// What an event was, in a few words, for the readout beside the scrubber. Fixed words only: a
// seller's text never reaches it.

const TOOL_WORDS: Record<string, string> = {
  search: "searched the marketplace",
  view_listing: "opened a listing",
  read_reviews: "read the reviews",
  add_to_cart: "added an item to the cart",
  remove_from_cart: "took an item out of the cart",
  view_cart: "looked at the cart",
  apply_coupon: "tried a discount code",
  checkout: "checked out",
};

const PAYMENT_WORDS: Record<string, string> = {
  create_order: "An order was created",
  authorize_order: "The platform held the money",
  reauthorize: "The hold was renewed",
  get_authorization: "The hold was checked",
  capture: "The hold was captured",
  payout: "A seller was paid",
  void: "The hold was voided",
};

const GATE_NAMES: Record<string, string> = {
  gate0: "Gate 0",
  gate1: "Gate 1",
  gate2: "Gate 2",
  gate3: "Gate 3",
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Whether a Gate 1 reading found something steering: the passages the run view outlines.
export function flaggedSteering(event: RunEvent): boolean {
  const facts = obj(obj(event.payload).facts);
  return (
    list(facts.flags).length > 0 ||
    list(facts.requiredItems).length > 0 ||
    list(facts.urgency).length > 0
  );
}

export function describeEvent(event: RunEvent): string {
  const body = obj(event.payload);
  const key = `${event.lane}/${event.type}`;
  switch (key) {
    case "arena/run_started":
      return "The run started";
    case "human/mandate_requested":
      return "The person made the request";
    case "mandate/mandate_drafted":
      return "A mandate was drafted";
    case "human/mandate_edited":
      return "The person edited the mandate";
    case "human/mandate_confirmed":
      return "The person confirmed the mandate";
    case "mandate/mandate_locked":
      return "The mandate was locked";
    case "agent/agent_started":
      return "The agent started shopping";
    case "agent/model_turn":
      return "The agent thought";
    case "agent/tool_call": {
      const tool = String(body.toolName ?? "");
      return `The agent ${TOOL_WORDS[tool] ?? `used ${tool.replace(/_/g, " ") || "a tool"}`}`;
    }
    case "agent/tool_result":
      return "The agent got an answer";
    case "arena/listing_viewed":
      return "A listing page was served";
    case "arena/reviews_viewed":
      return "The reviews were served";
    case "arena/cart_updated":
      return "The cart changed";
    case "arena/checkout":
      return "The checkout was made";
    case "agent/run_finished":
      return "The agent finished";
    case "payments/payment_call": {
      if ("error" in body) return "A payment call failed";
      return PAYMENT_WORDS[String(body.operation)] ?? "A payment call was made";
    }
    case "review/review_started": {
      const config = str(body.config);
      return config ? `The review started (firewall ${config})` : "The review started";
    }
    case "review/review_finished": {
      const verdict = str(body.verdict);
      return verdict ? `The review ruled: ${verdict}` : "The review ended with nobody reviewing";
    }
    case "review/review_failed":
      return "A gate broke, so nothing was enforced";
    case "review/escalated":
      return "The purchase was held for a person";
    case "human/human_decision":
      return str(body.decision) === "approve"
        ? "The person approved the purchase"
        : "The person rejected the purchase";
    case "review/enforced":
      return body.money === "voided"
        ? "The hold was voided"
        : "The money was captured and paid out";
    case "gate1/gate1_started":
      return "Gate 1 started reading the pages";
    case "gate1/gate1_facts":
      return flaggedSteering(event)
        ? "Gate 1 flagged a passage as steering"
        : "Gate 1 read a page and found nothing steering";
    case "gate2/gate2_started":
      return "Gate 2 gathered what it reads";
    case "gate2/gate2_market":
      return "Gate 2 looked at the market price";
    case "gate2/gate2_judgement":
      return "Gate 2 judged the cart";
    case "gate2/gate2_judgement_failed":
      return "Gate 2's auditor couldn't judge the cart";
    case "gate3/gate3_started":
      return "Gate 3 gathered the agent's trace";
    case "gate3/gate3_judgement":
      return "Gate 3 judged how the agent chose";
    case "gate3/gate3_judgement_failed":
      return "Gate 3's auditor couldn't judge the trace";
  }
  const gate = GATE_NAMES[event.lane];
  if (gate && event.type === "verdict") {
    const verdict = str(obj(body.result).verdict);
    return verdict ? `${gate} ruled: ${verdict}` : `${gate} ruled`;
  }
  return sentence(`${event.lane} ${event.type.replace(/_/g, " ")}`);
}
