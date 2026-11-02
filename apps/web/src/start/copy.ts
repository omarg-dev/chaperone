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
