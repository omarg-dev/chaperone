import { build } from "esbuild";

// One self-contained file, so the runtime image needs no node_modules. Workspace packages
// export TypeScript source, so they have to be bundled rather than resolved at runtime.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // Some CommonJS dependencies call require(), which an ES module bundle doesn't define.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
