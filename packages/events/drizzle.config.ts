import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes a migration into drizzle/ from changes to src/schema.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
