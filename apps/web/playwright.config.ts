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

/**
 * The second account (e2e/example-business.spec.ts, the example viewer): a fixed auth user id that belongs to no
 * business. `signInAs(page, E2E_EXAMPLE_VIEWER_ID)` (e2e/helpers.ts) signs it in through `/auth/dev?as=<uuid>`; the web
 * then sends `Bearer dev:<uuid>`, which the api and the stream map to this account in development and test only, and
 * the api's dev bootstrap (apps/api src/services/dev-users.ts, PGlite only) creates the stub auth user on first sight.
 * E2E_EXAMPLE_VIEWER_ID in the environment overrides it (a stack whose database already holds another account).
 */
export const E2E_EXAMPLE_VIEWER_ID = process.env.E2E_EXAMPLE_VIEWER_ID ?? "e2e0e2e0-0000-4000-8000-00000000e5a1";

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
  // The LIVE pages and Go live are closed unless a deployment opens them (FLAGS.liveMode, audit VLS2-X1); the stack opens them.
  LIVE_MODE: "1",
  // A project's Foundmill sending address runs on its mock (SendGrid is mock here), so Settings shows it (package 1.5).
  PLATFORM_MAIL_DOMAIN: "mail.foundmill.test",
  DATABASE_URL: E2E_DATABASE_URL,
  DEV_AUTH_USER_ID: process.env.DEV_AUTH_USER_ID ?? DEMO_OWNER_USER_ID,
  API_PORT: String(API_PORT),
  PORT: String(API_PORT),
  // The api falls back to its in-process composer when the service does not answer; nothing listens here.
  COMPOSER_URL: process.env.COMPOSER_URL ?? "http://127.0.0.1:1",
  // The specs press Take charge and the other model-backed buttons far more often than one person does in an hour, all as
  // one signed-in founder: the allowances scale on the test stack as they do on CI (model-limits.ts modelLimitScale).
  MODEL_LIMIT_SCALE: process.env.MODEL_LIMIT_SCALE ?? "50",
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

const browser = {
  ...devices["Desktop Chrome"],
  viewport,
  launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
};

export default defineConfig({
  testDir: "./e2e",
  // One worker, files in order: the specs share one seeded database and several of them write to it (the Inbox
  // refresh adds a note, Commit creates businesses, the spec editor saves a block), so a second worker would make
  // the counts they assert non-deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // The JSON report feeds scripts/test-inventory.mjs --flaky in CI (tests that passed only on a retry; WP-01 T7).
  reporter: isCI ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/report.json" }]] : "list",
  use: { baseURL, viewport, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // The founder profile first (AC-11.1.1): on a database seeded with SEED_OWNER_PROFILE=0 the dev user has none and
    // every /b/* and /new/* route bounces to /onboarding; onboarding.spec.ts meets the gate and saves the profile.
    { name: "profile", testMatch: /onboarding\.spec\.ts/, use: browser },
    { name: "desktop-chromium", testIgnore: /onboarding\.spec\.ts/, dependencies: ["profile"], use: browser },
  ],
  webServer,
  globalSetup: "./e2e/global-setup.ts",
});
