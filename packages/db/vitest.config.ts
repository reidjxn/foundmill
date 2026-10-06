import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Dir-relative so `vitest run --dir src/__tests__/rls` (test:rls) and plain `vitest run` both match.
    include: ["**/*.test.ts"],
    // PGlite boots once per file; cross-tenant suites run ~400 cases against one instance.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: true,
  },
});
