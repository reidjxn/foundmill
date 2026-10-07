import { defineConfig } from "vitest/config";

// Temporal's native bridge and the PGlite harness want real processes, not worker threads; the time-skipping test
// server starts once per suite file, so keep timeouts generous and parallelism low (the build machine is small).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 2,
    fileParallelism: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
  },
});
