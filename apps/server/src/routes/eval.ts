import { Hono } from "hono";
import { listResults, readResult } from "../results.js";

// The eval's results files over HTTP, read-only: the list the dashboard's picker shows, and one
// file, validated and reduced to what the dashboard draws (`@firewall/eval/view`). The folder is
// the server's `RESULTS_DIR`; nothing a request says reaches the disk except a name that passes
// `isResultsName`, so a path never leaves the folder.
//
// With no folder (`null`) the list says it is unavailable and every name is not found; nothing is
// read from the server's working folder instead.
export function evalRoutes(resultsDir: string | null) {
  return new Hono()
    .get("/results", async (c) =>
      c.json(
        resultsDir
          ? await listResults(resultsDir)
          : { available: false, results: [], unreadable: [] },
      ),
    )
    .get("/results/:name", async (c) => {
      const name = c.req.param("name");
      const found = resultsDir
        ? await readResult(resultsDir, name)
        : { status: "not_found" as const };
      if (found.status === "found") return c.json({ name, results: found.results });
      if (found.status === "invalid") {
        return c.json({ error: "invalid_results", message: found.reason }, 422);
      }
      return c.json({ error: "not_found", message: `No results named "${name}"` }, 404);
    });
}
