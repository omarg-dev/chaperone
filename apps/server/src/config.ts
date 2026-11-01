export interface Config {
  port: number;
  // Where the server keeps its state (the event log). Created on start if it doesn't exist.
  dataDir: string;
  // Where the eval's results files are read from, when `RESULTS_DIR` says. Unset, index.ts uses the
  // repo's results/ folder when it runs from source.
  resultsDir: string | null;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, got "${raw}"`);
  }
  return { port, dataDir: env.DATA_DIR || "data", resultsDir: env.RESULTS_DIR || null };
}
