import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportRuns, InvalidRunsFileError, importRuns, openEventLog } from "@firewall/events";
import Database from "better-sqlite3";
import { eventLogOptions } from "./open-log.js";

export const USAGE = `Usage:
  export-runs [--out FILE] [--sandbox] [--run RUN_ID]...
      Writes runs from the event log as a runs file (JSON), to FILE or to standard output.
      --sandbox keeps only the runs whose money was on the payment sandbox; --run picks runs.
  import-runs FILE
      Appends the runs in a runs file to the event log. FILE - reads standard input. Events already
      in the log are skipped, so importing the same file again does nothing.
  backup [--keep N]
      Copies the event log to DATA_DIR/backups/events-<UTC time>.db while the server keeps running
      (SQLite's online backup, never a file copy), checks the copy, and keeps the newest N (14).
All of them work on the event log in DATA_DIR (default: data).`;

export interface CliIo {
  readStdin: () => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: CliIo = {
  readStdin: () => readFileSync(0, "utf8"),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

// Returns the exit code. Messages go to stderr so that `export-runs > file` stays a clean file.
export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = processIo,
): Promise<number> {
  const [command, ...args] = argv;
  const dataDir = env.DATA_DIR || "data";
  try {
    if (command === "export-runs") {
      let out: string | null = null;
      let sandbox = false;
      const runIds: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--out") out = args[++i] ?? fail("--out needs a file");
        else if (arg === "--run") runIds.push(args[++i] ?? fail("--run needs a run ID"));
        else if (arg === "--sandbox") sandbox = true;
        else fail(`Unknown option ${arg}`);
      }
      const log = openEventLog(eventLogOptions(dataDir));
      try {
        const file = exportRuns(log, {
          ...(runIds.length > 0 && { runIds }),
          ...(sandbox && { payments: "sandbox" }),
        });
        const text = `${JSON.stringify(file, null, 2)}\n`;
        const runs = new Set(file.events.map((event) => event.runId)).size;
        if (out && out !== "-") writeFileSync(out, text);
        else io.stdout(text);
        io.stderr(`Exported ${file.events.length} events from ${runs} runs.\n`);
        return 0;
      } finally {
        log.close();
      }
    }

    if (command === "import-runs") {
      if (args.length !== 1) fail("import-runs takes one file");
      const source = args[0] as string;
      const text = source === "-" ? io.readStdin() : readFileSync(source, "utf8");
      let file: unknown;
      try {
        file = JSON.parse(text);
      } catch {
        fail(`${source === "-" ? "Standard input" : source} is not JSON`);
      }
      const result = importRuns(eventLogOptions(dataDir), file);
      io.stderr(
        `Imported ${result.imported} events from ${result.runs.length} runs; ` +
          `${result.skipped} were already in the log.\n`,
      );
      return 0;
    }

    if (command === "backup") {
      let keep = DEFAULT_BACKUPS_KEPT;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--keep") keep = Number(args[++i]);
        else fail(`Unknown option ${args[i]}`);
      }
      if (!Number.isInteger(keep) || keep < 1) fail("--keep needs a whole number, 1 or more");
      const made = await backUp(dataDir, keep);
      io.stderr(`Backed up to ${made.file}; kept ${made.kept}, removed ${made.removed}.\n`);
      return 0;
    }

    io.stderr(`${USAGE}\n`);
    return command ? 2 : 0;
  } catch (error) {
    if (error instanceof InvalidRunsFileError) {
      io.stderr(`${error.message}\nNothing was imported.\n`);
    } else {
      io.stderr(`${error instanceof Error ? error.message : error}\n`);
    }
    return 1;
  }
}

function fail(message: string): never {
  throw new Error(message);
}

export const DEFAULT_BACKUPS_KEPT = 14;
const BACKUP_NAME = /^events-\d{8}-\d{6}\.db$/;

// SQLite's online backup: a consistent copy of the log while the server is writing to it, which
// copying the file (and its write-ahead log) would not give. The copy is checked before older ones
// are removed, so a bad backup never costs a good one.
export async function backUp(
  dataDir: string,
  keep: number,
  now: Date = new Date(),
): Promise<{ file: string; kept: number; removed: number }> {
  const source = join(dataDir, "events.db");
  const folder = join(dataDir, "backups");
  mkdirSync(folder, { recursive: true, mode: 0o750 });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = join(folder, `events-${stamp}.db`);

  const db = new Database(source, { fileMustExist: true });
  try {
    await db.backup(file);
  } finally {
    db.close();
  }
  // The copy inherits the log's write-ahead mode; make it a single self-contained file, so it opens
  // anywhere without -wal and -shm files beside it.
  const copy = new Database(file);
  try {
    copy.pragma("journal_mode = DELETE");
    const result = copy.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      rmSync(file, { force: true });
      throw new Error(`The backup failed its integrity check (${result}) and was removed.`);
    }
  } finally {
    copy.close();
  }

  // The names sort by time, so the oldest are first.
  const all = readdirSync(folder)
    .filter((name) => BACKUP_NAME.test(name))
    .sort();
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const name of old) rmSync(join(folder, name));
  return { file, kept: all.length - old.length, removed: old.length };
}
