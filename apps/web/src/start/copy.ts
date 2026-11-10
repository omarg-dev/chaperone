import type { FirewallSetting } from "../api";

// The three ways to run Chaperone, in the words a person picks between. They never say which tasks
// are attacks: whether the firewall catches one is what the run is for. The labels are plain, and
// each detail names the gate where the rest of the app does ("Gate 0 only" in the run history).
export const FIREWALL_OPTIONS: { value: FirewallSetting; label: string; detail: string }[] = [
  {
    value: "full",
    label: "Full check",
    detail: "The rules, then AI reviewers read the cart and how the agent got there. Recommended.",
  },
  {
    value: "gate0",
    label: "Rules only",
    detail: "Just the fixed rules (Gate 0), with no AI review.",
  },
  {
    value: "off",
    label: "Off",
    detail: "No check: the payment goes straight through. See what happens without Chaperone.",
  },
];

export const firewallLabel = (value: FirewallSetting) =>
  FIREWALL_OPTIONS.find((o) => o.value === value)?.label ?? value;

export const isFirewallSetting = (value: string | null): value is FirewallSetting =>
  FIREWALL_OPTIONS.some((o) => o.value === value);

export const MONEY_NOTES = {
  fake: {
    label: "Practice money",
    detail: "No real payment is made. The hold is simulated on this server.",
  },
  sandbox: {
    label: "Sandbox",
    detail: "Test money on the payment platform's sandbox. Nothing real is charged.",
  },
} as const;

export const dollars = (usd: number) => `$${usd.toFixed(2)}`;

// "$120.00 each" as the amount in cents and what follows it, or null when the value isn't a price.
// The mandate's price ceiling is drawn as an amount, with its fraction raised.
export function ceilingOf(value: string): { cents: number; rest: string } | null {
  const found = /^\$([\d,]+)\.(\d{2})\b(.*)$/.exec(value);
  if (!found) return null;
  const whole = Number((found[1] as string).replace(/,/g, ""));
  return { cents: whole * 100 + Number(found[2]), rest: (found[3] as string).trim() };
}

// The catalog's attribute names and values that don't read as words on their own.
const ATTRIBUTE_NAMES: Record<string, string> = {
  anc: "Noise cancelling",
  dpi: "Sensor (DPI)",
  form: "Fit",
};
const ATTRIBUTE_VALUES: Record<string, string> = {
  tkl: "tenkeyless",
};

// The builder writes requirements the way the command line reads them ("switch_feel = tactile;
// weight_g <= 70 g; form = over_ear"). A person reads them as "Switch feel: tactile", "Weight: at
// most 70 g" and "Fit: over ear". Anything that isn't in that shape is passed through as it was
// written.
export function requirementsOf(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const found = /^([a-z0-9_]+) (=|<=|>=) (.+)$/i.exec(part);
      if (!found) return part;
      const [, attribute, op, written] = found as unknown as [string, string, string, string];
      const rest = ATTRIBUTE_VALUES[written] ?? written.replace(/_/g, " ");
      const unit = /\s(\S+)$/.exec(rest)?.[1];
      const plain = (unit ? attribute.replace(new RegExp(`_${unit}$`), "") : attribute).replace(
        /_/g,
        " ",
      );
      const name =
        ATTRIBUTE_NAMES[attribute] ?? `${plain.charAt(0).toUpperCase()}${plain.slice(1)}`;
      const said = op === "<=" ? `at most ${rest}` : op === ">=" ? `at least ${rest}` : rest;
      return `${name}: ${said}`;
    });
}
