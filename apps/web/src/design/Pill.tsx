import { MoneyGlyph, type MoneyState } from "./MoneyGlyph";

// A gate's or a review's state. The five say what a gate ruled, and each is drawn as the money state
// it leads to (an approve is a capture, a block is a void, an escalation waits for a person).
export const GATE_STATES = ["approve", "held", "escalate", "block", "attacker"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const GATE_STATE_LABELS: Record<GateState, string> = {
  approve: "Approve",
  held: "Held",
  escalate: "Escalate",
  block: "Block",
  attacker: "Paid attacker",
};

export const MONEY_OF_GATE: Record<GateState, MoneyState> = {
  approve: "captured",
  held: "held",
  escalate: "person",
  block: "voided",
  attacker: "attacker",
};

export function StateGlyph({ state, size = 16 }: { state: GateState; size?: number }) {
  return <MoneyGlyph state={MONEY_OF_GATE[state]} size={size} />;
}

// A glyph and a word, with no tint: the glyph and the colour of the word carry the state. The one
// filled pill is "Paid attacker", since red only means money reached an attacker. The accessible name
// says it is a verdict as well as which one, since the colour and the silhouette are not available to
// everyone.
export function Pill({ state, label }: { state: GateState; label?: string }) {
  const text = label ?? GATE_STATE_LABELS[state];
  return (
    <span className={`pill pill-${state}`} role="img" aria-label={`Verdict: ${text}`}>
      <MoneyGlyph state={MONEY_OF_GATE[state]} size={state === "attacker" ? 20 : 22} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
