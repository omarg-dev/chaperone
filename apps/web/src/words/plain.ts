// The firewall's own vocabulary, in the words a person who isn't a developer reads. Pure, with unit
// tests: the run page and the inbox both say a check's name and its reason through here, so the two
// can't drift.

export type GateName = "gate0" | "gate1" | "gate2" | "gate3";

// Each check by what it does. "Gate 0" and the rest stay beside the name as a small tag, since the
// dashboard and the docs call them that.
export const GATE_WORDS: Record<GateName, { name: string; does: string }> = {
  gate0: { name: "Fixed rules", does: "Checks the cart against your rules, with no AI." },
  gate1: {
    name: "Seller pages",
    does: "Reads what sellers wrote, in isolation, and passes on only plain facts.",
  },
  gate2: { name: "Cart review", does: "An AI reviewer checks the cart is what you asked for." },
  gate3: { name: "Agent's path", does: "An AI reviewer checks how the agent came to choose it." },
};

export const gateWords = (gate: string) => GATE_WORDS[gate as GateName]?.name ?? gate;

// A check's ruling, as what it means for the purchase.
export const VERDICT_WORDS = {
  approve: "Passed",
  escalate: "Sent to you",
  block: "Stopped",
} as const;
export const RESULT_WORDS = {
  approve: "Approved",
  escalate: "Sent to you",
  block: "Blocked",
} as const;

// Gate 0's rules, by what each one checks.
const RULE_WORDS: Record<string, string> = {
  mandate: "Rules locked",
  order_integrity: "Order matches the catalog",
  payee: "Seller",
  unit_price: "Price per item",
  category: "Kind of item",
  attributes: "Must-haves",
  brand: "Brand",
  budget: "Total",
  quantity: "Quantity",
  velocity: "Repeat purchases",
};

export function ruleWords(rule: string): string {
  const known = RULE_WORDS[rule];
  if (known) return known;
  const text = rule.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A check named inside a sentence about another one ("Gate 1 flagged its page").
export const GATE_IN_A_SENTENCE = [
  "the fixed rules",
  "the seller pages check",
  "the cart review",
  "the agent's path check",
];

const titled = (id: string) =>
  id
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

// Verbs the gates use after "the mandate", which "your rules" takes in the plural.
const VERBS = "pays|asks|leads|allows|says|requires|names|sets|wants|permits|covers|lists";

// A sentence a gate or the server wrote, with its bookkeeping taken out: ids become names, the
// "mandate" becomes "your rules", and the parts of the firewall are called by what they do.
export function plainWords(text: string): string {
  return (
    text
      .replace(
        /\bmandate md_\w+ is locked and its hash sha256:[0-9a-f]+ matches its contents\b/gi,
        "Your rules are locked and haven't changed since you confirmed them",
      )
      .replace(/\s*\(flagged by the extractor\)/g, "")
      .replace(/\s*\(payee [a-z0-9_]+\)/g, "")
      // A policy's code in brackets after the sentence that already says it.
      .replace(/\s*\((?!lst_|sku_)(?:[a-z]+_)+[a-z]+\)/g, "")
      .replace(
        /no real-market price for .*?channel3: not_configured\)?/g,
        "no real-market price was available",
      )
      .replace(/\bAuditor: /g, "AI reviewer: ")
      .replace(/\bmisses a required attribute:/g, "is missing something you required:")
      .replace(/\bmeets every required attribute:/g, "has everything you required:")
      .replace(/\bmandate-matching\b/g, "rule-matching")
      // An attribute as the catalog names it: "switch_feel = tactile".
      .replace(
        /\b([a-z]+(?:_[a-z]+)+) (=|<=|>=) /g,
        (_, name: string, op: string) => `${name.replace(/_/g, " ")} ${op} `,
      )
      .replace(/\bline \d+ \(([^)]+)\)/gi, "$1")
      .replace(/\bGate ([0-3])\b/g, (_, n: string) => GATE_IN_A_SENTENCE[Number(n)] as string)
      .replace(/\b[Ss]eller seller_([a-z0-9_]+)\b/g, (_, id: string) => `The seller ${titled(id)}`)
      .replace(/\b(?:seller|brand)_([a-z0-9_]+)\b/g, (_, id: string) => titled(id))
      .replace(/\b([a-z_]+) = true\b/g, "$1 = yes")
      .replace(/\b([a-z_]+) = false\b/g, "$1 = no")
      .replace(
        new RegExp(`\\b([Tt])he mandate (${VERBS})\\b`, "g"),
        (_, t: string, verb: string) => `${t === "T" ? "Your" : "your"} rules ${verb.slice(0, -1)}`,
      )
      .replace(/\b([Tt])he mandate's/g, (_, t: string) => `${t === "T" ? "Your" : "your"} rules'`)
      .replace(/\b([Tt])he mandate\b/g, (_, t: string) => `${t === "T" ? "Your" : "your"} rules`)
      // A second verb after "and" agrees too: "your rules ask for a keyboard and allow no extras".
      .replace(
        new RegExp(`\\b([Yy]our rules [a-z]+ [^.;:]*? and) (${VERBS})\\b`, "g"),
        (_, before: string, verb: string) => `${before} ${verb.slice(0, -1)}`,
      )
      .replace(/\b([Yy]our rules) does\b/g, "$1 do")
      .replace(/\b([Yy]our rules) is\b/g, "$1 are")
      .replace(/\bmandate\b/g, "rules")
      .replace(/\bMandate\b/g, "Rules")
      .replace(/\bthe auditor\b/g, "the AI reviewer")
      .replace(/\bThe auditor\b/g, "The AI reviewer")
      .replace(/\bthe extractor\b/g, "the page reader")
      .replace(/\bthe trace\b/g, "the agent's steps")
      .replace(/\bThe trace\b/g, "The agent's steps")
      // A sentence that now opens mid-word ("the seller ..." after an id went) starts with a capital.
      .replace(/^([a-z])/, (first) => first.toUpperCase())
  );
}
