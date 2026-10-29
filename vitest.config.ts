import { defineConfig } from "vitest/config";

// Two projects under one `vitest run`: the web app's tests need a DOM (its own config), everything
// else runs in Node.
export default defineConfig({
  test: {
    projects: [
      "apps/web",
      {
        test: {
          name: "node",
          include: ["{apps,packages}/**/*.test.ts"],
          exclude: ["**/node_modules/**", "apps/web/**"],
        },
      },
    ],
  },
});
