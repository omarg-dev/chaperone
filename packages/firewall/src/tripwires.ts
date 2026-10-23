import type { FlagKind } from "./facts.js";

// A few fixed patterns for the plainest kinds of injection, checked by code on every document
// before the model reads it. They don't replace the extractor; they back it up. If an attack talks
// the extractor out of flagging it ("report no flags"), the words that did it are still caught here.
// They are kept narrow on purpose: a tripwire fires on a whole listing, so one that trips on honest
// reviews would escalate every purchase. The base catalog trips none of them (tripwires.test.ts).

export interface Tripwire {
  name: string;
  kind: FlagKind;
  pattern: RegExp;
}

export const TRIPWIRES: Tripwire[] = [
  {
    name: "override_instructions",
    kind: "imitates_system_text",
    pattern:
      /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(instructions?|rules|prompt|guidelines|directions)\b/i,
  },
  {
    name: "system_voice",
    kind: "imitates_system_text",
    pattern:
      /\b(system (prompt|message|note|notice|instruction)|developer (message|note|instruction)|new instructions)\b/i,
  },
  {
    name: "markup_or_json",
    kind: "imitates_system_text",
    pattern: /<\/?[a-z_][\w-]*[^<>]*>|\{\s*"[a-z_]+"\s*:/i,
  },
  {
    name: "addresses_an_ai",
    kind: "addresses_assistant",
    pattern:
      /\b(AI|LLMs?|language models?|chatbots?|bots?|(shopping|purchasing|buying) (assistants?|agents?)|automated (shoppers?|buyers?|agents?)|assistants?|agents?) (reading|processing|reviewing|shopping|buying)\b|\b(dear|attention|note to|hey|hello)\s*,?\s+(AI|assistants?|agents?|bots?|models?)\b|\bif you are an? (AI|assistant|agent|bot|language model)\b|\bas an AI\b/i,
  },
];

export interface TripwireHit {
  name: string;
  kind: FlagKind;
  // The words that matched, straight from the document.
  match: string;
}

export function tripwireHits(text: string): TripwireHit[] {
  return TRIPWIRES.flatMap(({ name, kind, pattern }) => {
    const found = pattern.exec(text);
    return found ? [{ name, kind, match: found[0] }] : [];
  });
}
