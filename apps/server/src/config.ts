export interface Config {
  port: number;
  // Where the server keeps its state (the event log). Created on start if it doesn't exist.
  dataDir: string;
  // Where the eval's results files are read from, when `RESULTS_DIR` says. Unset, index.ts uses the
  // repo's results/ folder when it runs from source.
  resultsDir: string | null;
  // The most live runs started from the web app may spend in a UTC day, in US dollars
  // (FIREWALL_LIVE_DAILY_USD). Counted from the event log.
  liveDailyUsd: number;
}

// The default cap on a day's live runs: $0.25, a few dozen runs at the half a cent or so each costs
// (docs/PLAN.md, "Cost"). Omar chose it on Nov 2 so the Anthropic credit, which the gates spend in
// every eval column too, lasts through judging to Dec 15.
export const DEFAULT_LIVE_DAILY_USD = 0.25;

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${raw}"`);
  }
  const cap = env.FIREWALL_LIVE_DAILY_USD?.trim();
  const liveDailyUsd = cap ? Number(cap) : DEFAULT_LIVE_DAILY_USD;
  if (!Number.isFinite(liveDailyUsd) || liveDailyUsd < 0) {
    throw new Error(
      `FIREWALL_LIVE_DAILY_USD must be an amount in dollars, 0 or more, got "${cap}"`,
    );
  }
  return {
    port,
    dataDir: env.DATA_DIR || "data",
    resultsDir: env.RESULTS_DIR || null,
    liveDailyUsd,
  };
}
