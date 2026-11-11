import type { FirewallSetting } from "../api";
import { SETTING_WORDS } from "../words/plain";

// The three ways to run Chaperone, in the words a person picks between. They never say which tasks
// are attacks: whether the firewall catches one is what the run is for. The labels are plain, and
// each detail names the gate where the docs do. The labels are the shared words (words/plain.ts).
export const FIREWALL_OPTIONS: { value: FirewallSetting; label: string; detail: string }[] = [
  {
    value: "full",
    label: SETTING_WORDS.full,
    detail: "The rules, then AI reviewers read the cart and how the agent got there. Recommended.",
  },
  {
    value: "gate0",
    label: SETTING_WORDS.gate0,
    detail: "Just the fixed rules (Gate 0), with no AI review.",
  },
  {
    value: "off",
    label: SETTING_WORDS.off,
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

// The rules about what the item must be, in a person's words. The run page says them the same way.
export { requirementsOf } from "../words/requirements";
