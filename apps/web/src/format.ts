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

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

// A stretch of time in the largest whole unit that fits: "less than a minute", "5 minutes",
// "3 hours", "2 days". It rounds down, so it never says longer than it has been (or sooner than it
// will be).
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

// "3 hours ago", or "just now" inside the first minute.
export function formatAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const span = formatSpan(now - then);
  return span === "less than a minute" ? "just now" : `${span} ago`;
}

// How long an authorization has left, from the expiry the payments lane recorded: "Hold ends in
// 28 days", "Hold ends in 5 hours", "Hold ends in less than a minute", or that it has ended.
export function formatHoldEnds(expiresAt: string, now: number): string {
  const ends = Date.parse(expiresAt);
  if (Number.isNaN(ends)) return "";
  return ends <= now ? "The hold has ended" : `Hold ends in ${formatSpan(ends - now)}`;
}

// A rate the eval computed, as a percentage with one decimal: "68.8%". A rate with nothing to divide
// is null, and says so rather than reading as zero.
export const formatPercent = (rate: number | null): string =>
  rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;

// A time in milliseconds: "1 ms", "840 ms", "3.3 s". Null (no review was timed) says n/a.
export function formatDuration(ms: number | null): string {
  if (ms === null) return "n/a";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// A date the eval wrote (YYYY-MM-DD), day first: "26 Oct 2026". It is a calendar date, not an
// instant, so it is read as one and never moved by the viewer's time zone.
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}
