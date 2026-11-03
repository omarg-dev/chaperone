import { readFileSync, writeFileSync } from "node:fs";
import { exportRuns, InvalidRunsFileError, importRuns, openEventLog } from "@firewall/events";
import { eventLogOptions } from "./open-log.js";

export const USAGE = `Usage:
  export-runs [--out FILE] [--sandbox] [--run RUN_ID]...
      Writes runs from the event log as a runs file (JSON), to FILE or to standard output.
      --sandbox keeps only the runs whose money was on the payment sandbox; --run picks runs.
  import-runs FILE
      Appends the runs in a runs file to the event log. FILE - reads standard input. Events already
      in the log are skipped, so importing the same file again does nothing.
Both work on the event log in DATA_DIR (default: data).`;

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
export function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = processIo,
): number {
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
