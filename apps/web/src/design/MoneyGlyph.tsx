// The money-state glyphs: eight states drawn on the bracket's geometry (the mark's rounded corner
// and stroke, on a 24 unit grid), so a state reads in greyscale, at 16px and without its label.
// They replace the tinted pills: the bracket is where the money is held, the dot is the money, and
// a line out of the bracket is money leaving it.
//
//   held       an open bracket around a dot: held under review
//   person     the same, with the dot hollow: waiting on a person
//   captured   a short bracket, a line out of it and a dot past it: the seller was paid
//   voided     the bracket shut, a bar through it: nobody was paid
//   released   the shut bracket dashed and empty: the hold was released, with no decision
//   attacker   like captured, with a larger dot: the money reached an attacker
//   off        the line and the dot with no bracket: nobody held it
//   none       a dashed bracket and a dot: not reviewed yet

export const MONEY_STATES = [
  "held",
  "person",
  "captured",
  "voided",
  "released",
  "attacker",
  "off",
  "none",
] as const;
export type MoneyState = (typeof MONEY_STATES)[number];

export const MONEY_STATE_LABELS: Record<MoneyState, string> = {
  held: "Held, under review",
  person: "Held for a person",
  captured: "Captured, seller paid",
  voided: "Blocked, hold voided",
  released: "Hold released",
  attacker: "Paid attacker",
  off: "Firewall off",
  none: "Not reviewed yet",
};

const OPEN = "M15 4.5H9.5A5 5 0 0 0 4.5 9.5v5A5 5 0 0 0 9.5 19.5H15";
const SHORT = "M11 4.5H8.5A4 4 0 0 0 4.5 8.5v7A4 4 0 0 0 8.5 19.5H11";

function Shapes({ state }: { state: MoneyState }) {
  switch (state) {
    case "held":
      return (
        <>
          <path
            d={OPEN}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx="10.8" cy="12" r="2.8" fill="currentColor" />
        </>
      );
    case "person":
      return (
        <>
          <path
            d={OPEN}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx="10.8" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="2" />
        </>
      );
    case "captured":
      return (
        <>
          <path
            d={SHORT}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M12 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="19.5" cy="12" r="2.6" fill="currentColor" />
        </>
      );
    case "voided":
      return (
        <>
          <rect
            x="4.5"
            y="4.5"
            width="15"
            height="15"
            rx="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          />
          <path d="M9 12h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </>
      );
    case "released":
      return (
        <rect
          x="4.5"
          y="4.5"
          width="15"
          height="15"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="2.5 2.5"
        />
      );
    case "attacker":
      return (
        <>
          <path
            d={SHORT}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M12 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="19" cy="12" r="3.8" fill="currentColor" />
        </>
      );
    case "off":
      return (
        <>
          <path d="M12 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="19.5" cy="12" r="2.6" fill="currentColor" />
        </>
      );
    case "none":
      return (
        <>
          <path
            d={OPEN}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="2.5 2.5"
          />
          <circle cx="10.8" cy="12" r="2.8" fill="currentColor" />
        </>
      );
  }
}

// The glyph alone, in the colour of the text around it unless a state class sets one (see
// components.css). It is decoration: whatever carries it says the state in words.
export function MoneyGlyph({ state, size = 22 }: { state: MoneyState; size?: number }) {
  return (
    <svg
      className={`glyph glyph-${state}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <Shapes state={state} />
    </svg>
  );
}
