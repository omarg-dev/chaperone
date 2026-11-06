import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Where the event log lives and where its migrations are: the bundled build ships them next to
// itself (see build.mjs); run from source there's no such folder and the events package finds its
// own. Shared by the server and the command line, which open the same file.
export function eventLogOptions(dataDir: string) {
  const bundled = fileURLToPath(new URL("./drizzle", import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  return {
    path: join(dataDir, "events.db"),
    ...(existsSync(bundled) && { migrationsFolder: bundled }),
  };
}
