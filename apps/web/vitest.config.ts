import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json keeps jsx "preserve" for Next; Vitest transforms JSX itself.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    // Shared CI runners are several times slower than a laptop; keep the per-test budget generous.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: "happy-dom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
    setupFiles: ["./test/setup.ts"],
    css: false,
    env: {
      NEXT_PUBLIC_APP_ENV: "test",
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
      NEXT_PUBLIC_STREAM_URL: "ws://localhost:4003",
    },
  },
});
