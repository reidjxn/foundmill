import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `@founder-manager/events` is a type-only import in src (see docs/NEEDED_DEPS.md); tests load the real
// Zod schemas from the sibling package to validate recordings, so alias it here until the workspace
// dependency is declared.
const events = (p: string) => fileURLToPath(new URL(`../events/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@founder-manager\/events$/, replacement: events("index.ts") },
      { find: /^@founder-manager\/events\/(.*)$/, replacement: events("$1.ts") },
    ],
  },
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 20_000 },
});
