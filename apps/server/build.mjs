import { cpSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

// One file, so the runtime image needs almost no node_modules. Workspace packages export
// TypeScript source, so they have to be bundled rather than resolved at runtime.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // A native module loads its compiled .node file from its own folder, so it can't be bundled.
  // The Dockerfile copies it into the image's node_modules instead.
  external: ["better-sqlite3"],
  // Some CommonJS dependencies call require(), which an ES module bundle doesn't define.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

// The event log's migrations, which src/index.ts looks for next to the bundle.
cpSync("../../packages/events/drizzle", "dist/drizzle", { recursive: true });
