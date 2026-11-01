import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isResultsName,
  newestFirst,
  parseResults,
  type ResultsSummary,
  type ResultsView,
  summarize,
} from "@firewall/eval/view";

// The eval's results files, read from a folder and never written. A file is `<name>.json`, written
// by `pnpm --filter @firewall/eval run-matrix`; its sibling `.md` and `.events.db` aren't served.
// What a request can name is checked before it touches the disk (`isResultsName`), and the file has
// to be a plain file in the folder itself: a symbolic link, a folder or a name with a separator in
// it is "no such result".

export interface ResultsList {
  // False when the folder isn't there, so the page can say that and not "no results".
  available: boolean;
  results: ResultsSummary[];
  // Files in the folder that look like results but couldn't be read, with why: a file that
  // vanishes from the list without a word would look like a run that never happened.
  unreadable: { name: string; reason: string }[];
}

const JSON_FILE = /^(.+)\.json$/;

async function plainFile(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  return info?.isFile() ?? false;
}

export async function listResults(dir: string): Promise<ResultsList> {
  const entries = await readdir(dir).catch(() => null);
  if (!entries) return { available: false, results: [], unreadable: [] };
  const results: ResultsSummary[] = [];
  const unreadable: ResultsList["unreadable"] = [];
  for (const entry of entries.sort()) {
    const name = JSON_FILE.exec(entry)?.[1];
    if (!name || !isResultsName(name) || !(await plainFile(join(dir, entry)))) continue;
    const parsed = parseResults(await readFile(join(dir, entry), "utf8"));
    if (parsed.ok) results.push(summarize(name, parsed.results.meta));
    else unreadable.push({ name, reason: parsed.error });
  }
  return { available: true, results: results.sort(newestFirst), unreadable };
}

export type ReadResult =
  | { status: "found"; results: ResultsView }
  | { status: "not_found" }
  | { status: "invalid"; reason: string };

export async function readResult(dir: string, name: string): Promise<ReadResult> {
  if (!isResultsName(name)) return { status: "not_found" };
  const path = join(dir, `${name}.json`);
  if (!(await plainFile(path))) return { status: "not_found" };
  const parsed = parseResults(await readFile(path, "utf8"));
  return parsed.ok
    ? { status: "found", results: parsed.results }
    : { status: "invalid", reason: parsed.error };
}
