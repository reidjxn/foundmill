import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Shared CI runners are several times slower than a laptop; keep the per-test budget generous.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
