// Times are shown in the viewer's own time zone, day first, with the zone named, so a reader abroad
// knows which clock it is: "27 Oct 2026, 21:23 GMT+3". The zone argument is for tests.
export function formatTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    ...(timeZone && { timeZone }),
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

// How long into a run something happened: "0s", "4.2s", "1m 03s". Under ten seconds it keeps a
// decimal, because the first steps of a run are close together.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 10) return `${Number(total.toFixed(1))}s`;
  if (total < 60) return `${Math.round(total)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total - minutes * 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// A model's cost in dollars. These are fractions of a cent, so they keep four decimals, and a
// price of nothing says so: "$0.0018", "No cost".
export function formatCost(usd: number): string {
  return usd <= 0 ? "No cost" : `$${usd.toFixed(4)}`;
}
