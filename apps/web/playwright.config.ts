import { defineConfig, devices } from "@playwright/test";

/**
 * Screen tests for apps/web (CLAUDE.md "Playwright test for any screen touched"). Desktop only: 1440 × 900.
 * Targets a running dev server on :3000 (E2E_BASE_URL overrides); browsers come from PLAYWRIGHT_BROWSERS_PATH.
 * Run: pnpm --filter @foundmill/web exec playwright test
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "pnpm dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
