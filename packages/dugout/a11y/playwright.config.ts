import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Every story in the built Storybook, checked by axe in a real browser (`pnpm --filter @foundmill/dugout test:a11y`,
 * after `storybook:build`; CI's Storybook job runs both). The stories set `a11y.test: "error"` in preview.ts, but the
 * Storybook build alone never ran those checks; this does. Rules: `.storybook/a11y-rules.ts`. Known violations:
 * `baseline.json`, which may only shrink (see stories.spec.ts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.A11Y_STORYBOOK_PORT ?? 6107);
/** The build container's preinstalled Chromium; CI runners install their own (`playwright install chromium`). */
const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium";
const chromiumPath = process.env.FM_CHROMIUM ?? (existsSync(CONTAINER_CHROMIUM) ? CONTAINER_CHROMIUM : undefined);

export default defineConfig({
  testDir: here,
  testMatch: /stories\.spec\.ts$/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
  },
  webServer: {
    command: `node scripts/serve-static.mjs storybook-static ${PORT}`,
    cwd: path.resolve(here, ".."),
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
