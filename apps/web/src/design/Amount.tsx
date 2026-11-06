// Amounts: Besley 800 with tabular figures, the fraction raised at half size, so a price reads as
// "$109" with a small ".99" at its shoulder. An amount is written once, in the column that says where
// the money is, so this component draws one amount and the page decides where it goes.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Whole cents in, "$61.99" out. Amounts are integers everywhere else in the system. This is the text
// for places that can't raise a fraction (a sentence, a label); everywhere else use `Amount`.
export function formatMoney(cents: number): string {
  return usd.format(cents / 100);
}

export interface AmountParts {
  // "$109", or "-$109" for a negative amount.
  whole: string;
  // ".99", always two places.
  fraction: string;
}

export function amountParts(cents: number): AmountParts {
  const text = formatMoney(cents);
  const point = text.lastIndexOf(".");
  return { whole: text.slice(0, point), fraction: text.slice(point) };
}

// A rate, in the same treatment: 68.8 sets as "68" with a raised ".8%".
export function rateParts(percent: number, digits = 1): AmountParts {
  const text = percent.toFixed(digits);
  const point = text.indexOf(".");
  return point < 0
    ? { whole: text, fraction: "%" }
    : { whole: text.slice(0, point), fraction: `${text.slice(point)}%` };
}

// What an amount is doing: voided money is struck through (nobody got it), and money paid to an
// attacker is red, the one place an amount is red.
export type AmountTone = "plain" | "voided" | "attacker";
export type AmountSize = "inherit" | "sm" | "md" | "lg" | "xl" | "hero";

function Raised({
  parts,
  full,
  size,
  tone,
  className,
}: {
  parts: AmountParts;
  full: string;
  size: AmountSize;
  tone: AmountTone;
  className?: string;
}) {
  return (
    <span className={["amt", `amt-${size}`, `amt-${tone}`, className].filter(Boolean).join(" ")}>
      <span className="visually-hidden">{full}</span>
      <span aria-hidden="true">
        {parts.whole}
        <span className="amt-c">{parts.fraction}</span>
      </span>
    </span>
  );
}

export function Amount({
  cents,
  size = "sm",
  tone = "plain",
  className,
}: {
  cents: number;
  size?: AmountSize;
  tone?: AmountTone;
  className?: string;
}) {
  return (
    <Raised
      parts={amountParts(cents)}
      full={formatMoney(cents)}
      size={size}
      tone={tone}
      className={className}
    />
  );
}

export function Rate({
  percent,
  size = "sm",
  tone = "plain",
  className,
}: {
  percent: number;
  size?: AmountSize;
  tone?: AmountTone;
  className?: string;
}) {
  return (
    <Raised
      parts={rateParts(percent)}
      full={`${percent.toFixed(1)}%`}
      size={size}
      tone={tone}
      className={className}
    />
  );
}
