import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Context } from "hono";

// Serves the built web app (apps/web/dist) for anything the API routes didn't answer. The API keeps
// its paths: this only ever runs as the app's not-found handler, so /health, /arena and /events
// win wherever they have a route.
//
// A path that names a file gets that file. A path that doesn't gets index.html when a browser is
// navigating to it (it accepts HTML), because the app's pages (/runs, /arena, ...) are routed in
// the browser; /arena is also an API prefix, which is why the browser's Accept header decides. Any
// other request for an unknown path is a plain 404, so a mistyped API call never answers with a page.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

async function fileIn(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidate = resolve(root, `.${normalize(`/${decoded}`)}`);
  // Never read outside the web root, whatever the path says.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  const info = await stat(candidate).catch(() => null);
  return info?.isFile() ? candidate : null;
}

export function webHandler(webDir: string) {
  const root = resolve(webDir);

  const send = async (c: Context, file: string) => {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    // Vite hashes the names under /assets, so they never change; the page itself must be re-read.
    const cache = file.startsWith(join(root, "assets") + sep)
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    const headers = { "content-type": type, "cache-control": cache };
    return c.req.method === "HEAD"
      ? c.body(null, 200, headers)
      : c.body(new Uint8Array(body), 200, headers);
  };

  return async (c: Context) => {
    const missing = () => c.json({ error: "not_found", message: "No such route" }, 404);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return missing();

    const path = c.req.path;
    const file = path === "/" ? null : await fileIn(root, path);
    if (file) return send(c, file);

    const wantsPage = path === "/" || (c.req.header("accept") ?? "").includes("text/html");
    const index = wantsPage ? await fileIn(root, "/index.html") : null;
    return index ? send(c, index) : missing();
  };
}
