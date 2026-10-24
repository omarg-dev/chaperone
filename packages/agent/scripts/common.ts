// Shared by the command-line scripts: where the event log is, and the sandbox payment adapter.
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSandboxPaymentAdapter,
  type SandboxPaymentAdapter,
  sandboxConfigFromEnv,
} from "@firewall/payments";

export const RETURN_URL = "https://checkout-firewall.invalid/payments/approved";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

// Relative paths are taken from the repo root, so the log is the same file wherever pnpm runs.
export function eventLogPath(override?: string): string {
  const dataDir = process.env.DATA_DIR || "data";
  const path =
    override ?? join(isAbsolute(dataDir) ? dataDir : join(REPO_ROOT, dataDir), "events.db");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export const sandboxAdapter = (): SandboxPaymentAdapter =>
  createSandboxPaymentAdapter({ ...sandboxConfigFromEnv(), returnUrl: RETURN_URL });

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
