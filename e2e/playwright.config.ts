import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

// Desktop only (CLAUDE.md): every project runs at 1440 × 900. Point E2E_BASE_URL at staging to skip the
// local web server; without it Playwright starts apps/web on port 3000 (and reuses one already running).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isCI = !!process.env.CI;
const viewport = { width: 1440, height: 900 };

const reporter: PlaywrightTestConfig["reporter"] = isCI ? [["list"], ["html", { open: "never" }]] : "list";

const webServer: PlaywrightTestConfig["webServer"] = process.env.E2E_BASE_URL
  ? undefined
  : { command: "pnpm --filter @founder-manager/web dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter,
  use: { baseURL, viewport, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport } }],
  webServer,
});
