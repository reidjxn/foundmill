import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The authorizer suite boots PGlite; the latency suite streams 16 sessions. The build machine is shared.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    maxWorkers: 2,
    fileParallelism: true,
  },
});
