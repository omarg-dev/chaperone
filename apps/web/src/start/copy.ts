import type { FirewallSetting } from "../api";

// The three ways to run Chaperone, in the words a person picks between. They never say which tasks
// are attacks: whether the firewall catches one is what the run is for.
export const FIREWALL_OPTIONS: { value: FirewallSetting; label: string; detail: string }[] = [
  { value: "full", label: "Full", detail: "Every gate reviews the cart." },
  { value: "gate0", label: "Gate 0 only", detail: "Plain rules only, no model." },
  { value: "off", label: "Off", detail: "Nothing reviews the cart. It goes straight to payment." },
];

export const firewallLabel = (value: FirewallSetting) =>
  FIREWALL_OPTIONS.find((o) => o.value === value)?.label ?? value;

export const isFirewallSetting = (value: string | null): value is FirewallSetting =>
  FIREWALL_OPTIONS.some((o) => o.value === value);

export const MONEY_NOTES = {
  fake: {
    label: "Practice money",
    detail: "Nothing touches a payment platform. The hold lives in this server.",
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
