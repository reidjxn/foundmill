import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
// The seed owner's fixed id (packages/db/src/seed/constants.ts). A relative import on purpose: @foundmill/db is not a
// web dependency (it pulls the database drivers) and the constants module has no imports of its own.
import { DEMO_OWNER_USER_ID } from "../../packages/db/src/seed/constants";

/**
 * Screen tests for apps/web (CLAUDE.md "Playwright test for any screen touched"; docs/ARCHITECTURE.md §15).
 * Desktop only: 1440 × 900, Chromium. Commands and the stack are documented in e2e/README.md.
 *
 * Stack (when E2E_BASE_URL is unset): one file-backed PGlite database at `pglite:./.pglite/e2e` (workspace-root
 * relative, see packages/db/src/pglite.ts), seeded once by `pnpm --filter @foundmill/db seed` with SEED_TARGET=pglite,
 * then apps/api on :4000 (APP_ENV=test, mock integrations and models, DEV_AUTH_USER_ID = the seed owner, no
 * COMPOSER_URL so the api narrates in-process, no Redis/Temporal) and apps/web `next dev` on :3000. Both servers are
 * reused when already running. With E2E_BASE_URL set (CI starts the servers itself) no server is started here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "../..");

export const E2E_PGLITE_DIR = "./.pglite/e2e";
export const E2E_DATABASE_URL = `pglite:${E2E_PGLITE_DIR}`;
export const API_PORT = 4000;
export const WEB_PORT = 3000;

const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${API_PORT}`;
const isCI = !!process.env.CI;
const viewport = { width: 1440, height: 900 };

/** The build container's preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); FM_CHROMIUM overrides, CI runners use `playwright install`. */
export const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium";
const chromiumPath = process.env.FM_CHROMIUM ?? (existsSync(CONTAINER_CHROMIUM) ? CONTAINER_CHROMIUM : undefined);

/** Environment every local server gets (docs/ARCHITECTURE.md §3 modes; DECISIONS "Development auth bypass"). */
export const STACK_ENV: Record<string, string> = {
  APP_ENV: "test",
  INTEGRATIONS_MODE: "mock",
  MODEL_MODE: "mock",
  DATABASE_URL: E2E_DATABASE_URL,
  DEV_AUTH_USER_ID: process.env.DEV_AUTH_USER_ID ?? DEMO_OWNER_USER_ID,
  API_PORT: String(API_PORT),
  PORT: String(API_PORT),
  // The api falls back to its in-process composer when the service does not answer; nothing listens here.
  COMPOSER_URL: process.env.COMPOSER_URL ?? "http://127.0.0.1:1",
  // Seed flags (only read when the database directory is missing, see the api command below).
  SEED_TARGET: "pglite",
  SEED_PGLITE_DIR: E2E_PGLITE_DIR,
  SEED_VOLUME_SCALE: process.env.SEED_VOLUME_SCALE ?? "0.1",
};

/** What the browser bundle needs: the api URL, the test env (dev bypass visible), no collab server. */
export const WEB_ENV: Record<string, string> = {
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
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // The seeded database is shared; two workers keep the api responsive on a small machine.
  workers: isCI ? 2 : 2,
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
