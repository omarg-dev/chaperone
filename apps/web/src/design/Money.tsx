const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Whole cents in, "$61.99" out. Amounts are integers everywhere else in the system.
export function formatMoney(cents: number): string {
  return usd.format(cents / 100);
}

export function Money({ cents, size = "md" }: { cents: number; size?: "sm" | "md" | "lg" | "xl" }) {
  return <span className={`money money-${size}`}>{formatMoney(cents)}</span>;
}
