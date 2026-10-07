import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

/**
 * The golden path (BUILD §17.1, Gate 1) and the smoke test. Desktop only (CLAUDE.md): 1440 × 900, Chromium.
 *
 * Stack (docs/DECISIONS.md "Local e2e stack"): one file-backed PGlite database at `pglite:./.pglite/e2e` seeded by
 * `pnpm --filter @foundmill/db seed` (SEED_TARGET=pglite), apps/api on :4000 (APP_ENV=test, mock integrations and
 * models, DEV_AUTH_USER_ID = the seed owner, no Redis/Temporal, no reachable COMPOSER_URL) and apps/web `next dev` on
 * :3000. With E2E_BASE_URL set (CI, or a stack started by hand with the commands in apps/web/e2e/README.md) nothing is
 * started here; without it the servers are started and reused when already running. One worker: the golden path
 * creates a business and answers its decisions, so the specs run in order against the shared database.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "..");

/** The seed owner's fixed id (packages/db/src/seed/constants.ts DEMO_OWNER_USER_ID); the dev bypass signs in as them. */
export const DEMO_OWNER_USER_ID = "0f0a0d00-0000-4000-8000-00000000f0a1";
export const E2E_PGLITE_DIR = "./.pglite/e2e";
export const API_PORT = 4000;
export const WEB_PORT = 3000;

const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${API_PORT}`;
const isCI = !!process.env.CI;
const viewport = { width: 1440, height: 900 };

/** The build container's preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); FM_CHROMIUM overrides, CI runners use `playwright install`. */
const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium";
const chromiumPath = process.env.FM_CHROMIUM ?? (existsSync(CONTAINER_CHROMIUM) ? CONTAINER_CHROMIUM : undefined);

const STACK_ENV: Record<string, string> = {
  APP_ENV: "test",
  INTEGRATIONS_MODE: "mock",
  MODEL_MODE: "mock",
  DATABASE_URL: `pglite:${E2E_PGLITE_DIR}`,
  DEV_AUTH_USER_ID: process.env.DEV_AUTH_USER_ID ?? DEMO_OWNER_USER_ID,
  API_PORT: String(API_PORT),
  PORT: String(API_PORT),
  COMPOSER_URL: process.env.COMPOSER_URL ?? "http://127.0.0.1:1",
  NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=2048",
  SEED_TARGET: "pglite",
  SEED_PGLITE_DIR: E2E_PGLITE_DIR,
  SEED_VOLUME_SCALE: process.env.SEED_VOLUME_SCALE ?? "0.1",
  // SEED_OWNER_PROFILE=0 seeds the dev user without a founder profile; pair it with E2E_EXPECT_PROFILE_GATE=1 so
  // AC-11.1.1 requires the /onboarding redirect instead of annotating it.
  ...(process.env.SEED_OWNER_PROFILE ? { SEED_OWNER_PROFILE: process.env.SEED_OWNER_PROFILE } : {}),
};

const WEB_ENV: Record<string, string> = {
  NEXT_PUBLIC_APP_ENV: "test",
  NEXT_PUBLIC_API_URL: apiUrl,
  NEXT_PUBLIC_STREAM_URL: process.env.NEXT_PUBLIC_STREAM_URL ?? "ws://localhost:4003",
  NEXT_PUBLIC_COLLAB_URL: process.env.NEXT_PUBLIC_COLLAB_URL ?? "",
  NEXT_PUBLIC_INTEGRATIONS_MODE: "mock",
  PORT: String(WEB_PORT),
};

const seedIfMissing = `test -d ${E2E_PGLITE_DIR} || pnpm --filter @foundmill/db seed`;

const webServer: PlaywrightTestConfig["webServer"] = process.env.E2E_BASE_URL
  ? undefined
  : [
      {
        command: `sh -c '${seedIfMissing} && pnpm --filter @foundmill/api start'`,
        cwd: workspaceRoot,
        url: `${apiUrl}/health`,
        reuseExistingServer: true,
        timeout: 300_000,
        env: STACK_ENV,
        stdout: "pipe",
        stderr: "pipe",
      },
      {
        command: "pnpm --filter @foundmill/web dev",
        cwd: workspaceRoot,
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
        env: { ...STACK_ENV, ...WEB_ENV, PORT: String(WEB_PORT) },
        stdout: "pipe",
        stderr: "pipe",
      },
    ];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, viewport, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
      },
    },
  ],
  webServer,
});
