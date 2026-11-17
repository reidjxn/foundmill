import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite boots a full Postgres per file and the build machine is shared; generous budgets keep load from flaking tests.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    maxWorkers: 2,
    fileParallelism: true,
  },
});
