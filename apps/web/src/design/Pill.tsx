export const GATE_STATES = ["approve", "held", "escalate", "block", "attacker"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const GATE_STATE_LABELS: Record<GateState, string> = {
  approve: "Approve",
  held: "Held",
  escalate: "Escalate",
  block: "Block",
  attacker: "Paid attacker",
};

// Each state has its own silhouette (24 unit grid), so it reads in greyscale and at 16px.
const BRACKET = "M15.5 4.5 H9.5 A5 5 0 0 0 4.5 9.5 V14.5 A5 5 0 0 0 9.5 19.5 H15.5";

export function StateGlyph({ state, size = 16 }: { state: GateState; size?: number }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {state === "approve" && (
        <>
          <path d="M11 12 H19.5 M16 8.5 L19.5 12 L16 15.5" {...line} strokeLinejoin="round" />
          <circle cx="6" cy="12" r="3.3" fill="currentColor" />
        </>
      )}
      {state === "held" && (
        <>
          <path d={BRACKET} {...line} />
          <circle cx="11.5" cy="12" r="3.3" fill="currentColor" />
        </>
      )}
      {state === "escalate" && (
        <>
          <path d={BRACKET} {...line} />
          <path d="M20 17 V6.5 M17 9.5 L20 6.5 L23 9.5" {...line} strokeLinejoin="round" />
          <circle cx="11.5" cy="12" r="3.3" fill="currentColor" />
        </>
      )}
      {state === "block" && (
        <>
          <rect x="4.5" y="4.5" width="15" height="15" rx="5" {...line} />
          <path d="M9 15 L15 9" {...line} />
        </>
      )}
      {state === "attacker" && (
        <>
          <path d={BRACKET} {...line} strokeDasharray="2.4 2.6" />
          <circle cx="20" cy="12" r="3.3" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

// A gate's or a review's state. The accessible name says it is a verdict as well as which one,
// since the colour and the silhouette are not available to everyone.
export function Pill({ state, label }: { state: GateState; label?: string }) {
  const text = label ?? GATE_STATE_LABELS[state];
  return (
    <span className={`pill pill-${state}`} role="img" aria-label={`Verdict: ${text}`}>
      <StateGlyph state={state} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
