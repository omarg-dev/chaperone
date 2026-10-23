import { defineConfig } from "vitest/config";

// The contract run against the real sandbox (sandbox/contract.sandbox.ts). Its file name keeps it
// out of `pnpm test`, which only collects *.test.ts. Calls take seconds and a payout up to a
// minute, so the timeouts are long, and tests run one at a time.
export default defineConfig({
  test: {
    include: ["sandbox/**/*.sandbox.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
