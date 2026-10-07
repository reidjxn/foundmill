import { defineConfig } from "vitest/config";
// The synthetic two-year generator tests run for several seconds on a shared CI runner; give them room.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 60_000 } });
