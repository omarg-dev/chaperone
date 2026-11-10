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
  // The most the dashboard assistant (AG Studio's AI) may spend in a UTC day, in US dollars
  // (FIREWALL_STUDIO_DAILY_USD). Counted from the model spend ledger in the event log's database.
  studioDailyUsd: number;
  // AG Studio's licence key (AG_STUDIO_LICENSE_KEY), served to the dashboard at runtime. Unset,
  // Studio shows its watermark.
  agStudioLicenseKey: string | null;
}

// The default cap on a day's live runs: $0.25, a few dozen runs at the half a cent or so each costs
// (docs/PLAN.md, "Cost"). Omar chose it on Nov 2 so the Anthropic credit, which the gates spend in
// every eval column too, lasts through judging to Dec 15.
export const DEFAULT_LIVE_DAILY_USD = 0.25;

// The default cap on a day's dashboard assistant: $0.10, some forty to a hundred turns at Haiku 5.5's
// rates (a turn reads its instructions, tool schemas and the conversation, and writes a short
// answer or a tool call), so a judge can ask a handful of questions and the credit lasts.
export const DEFAULT_STUDIO_DAILY_USD = 0.1;

const dollars = (name: string, raw: string | undefined, fallback: number): number => {
  const value = raw?.trim();
  const amount = value ? Number(value) : fallback;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${name} must be an amount in dollars, 0 or more, got "${value}"`);
  }
  return amount;
};

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${raw}"`);
  }
  const liveDailyUsd = dollars(
    "FIREWALL_LIVE_DAILY_USD",
    env.FIREWALL_LIVE_DAILY_USD,
    DEFAULT_LIVE_DAILY_USD,
  );
  return {
    port,
    dataDir: env.DATA_DIR || "data",
    resultsDir: env.RESULTS_DIR || null,
    liveDailyUsd,
    studioDailyUsd: dollars(
      "FIREWALL_STUDIO_DAILY_USD",
      env.FIREWALL_STUDIO_DAILY_USD,
      DEFAULT_STUDIO_DAILY_USD,
    ),
    agStudioLicenseKey: env.AG_STUDIO_LICENSE_KEY?.trim() || null,
  };
}
