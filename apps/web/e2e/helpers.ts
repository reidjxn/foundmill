import { expect, test, type Page } from "@playwright/test";
// A relative import on purpose (as playwright.config.ts does for the seed constants): the fixture is Node-only.
import { makePng } from "../../../packages/shared/src/testing/logo-fixtures";

/**
 * Shared steps for the apps/web screen specs (e2e/README.md). The stack is the PGlite-backed local one: the dev bypass
 * signs in as the seed owner, who owns Northwind Skincare and Ledgerly (packages/db/src/seed/constants.ts).
 *
 * The seed may run with SEED_OWNER_PROFILE=0 (no founder profile), in which case every /b/* and /new/* route bounces
 * to /onboarding (AC-11.1.1). `signIn` completes the profile once so the other specs run against the business
 * screens; onboarding.spec.ts asserts the gate itself before that happens (it runs first, see playwright.config.ts).
 *
 * The specs address the seeded business by its fixed id rather than through `/`: that redirect follows the
 * last-opened business, which the Commit specs change to a fresh business with no seeded data.
 */
export const NORTHWIND_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000001";
export const UUID = "[0-9a-f-]{36}";
/** Long waits: the api answers tRPC against PGlite and next dev compiles each route on first visit. */
export const LONG = 60_000;

/** Signs in through the dev bypass; makes sure the founder profile exists; lands on /new or a business Home. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/|\/onboarding|\/new/, { timeout: LONG });
  if (/\/onboarding/.test(page.url())) await completeProfile(page);
}

/** Signs in and opens the seeded Northwind Skincare Home (the AppShell is visible on return). */
export async function openBusiness(page: Page, path = "home"): Promise<string> {
  await signIn(page);
  await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/${path}`);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  // The shell is server-rendered; its handlers and the inbox/cycle queries arrive with hydration. Network idle means
  // those first queries have answered, so a click or a key press right after this reaches a live handler.
  await page.waitForLoadState("networkidle", { timeout: LONG });
  return NORTHWIND_BUSINESS_ID;
}

/** Fills the founder profile on /onboarding (the page the dev user is held at without one) and saves it. */
export async function completeProfile(page: Page): Promise<void> {
  await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/What the team calls you/).fill("Playwright Founder");
  await page.getByLabel("First-time founder").check();
  await page.getByLabel("Full time").check();
  await page.getByLabel(/Budget you can commit/).fill("25k");
  // The chip input and its suggestions list share the "Target markets" label prefix; the textbox is the field.
  const markets = page.getByRole("textbox", { name: "Target markets" });
  await markets.fill("Nordics");
  await markets.press("Enter");
  await page.getByRole("button", { name: "Remote only" }).click();
  await page.getByLabel("Medium").check();
  await page.getByTestId("profile-submit-bottom").click();
  await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
  await expect(page.getByTestId("doors")).toBeVisible();
}

/** Opens the Ideation Studio and waits until idea.list has answered (the grid only renders then). */
export async function openStudio(page: Page): Promise<void> {
  await page.goto("/new/ideate");
  await expect(page.getByTestId("prompt-box")).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId("concept-grid")).toBeAttached({ timeout: LONG });
}

/** The Studio keeps the drafted deck on the server (idea.list); drafts one only when fewer than `minimum` cards exist. */
export async function ensureDeck(page: Page, minimum = 1): Promise<void> {
  await openStudio(page);
  const cards = page.getByTestId("concept-grid").locator("[data-concept]");
  if ((await cards.count()) < minimum) {
    await page.getByTestId("generate-button").click();
    await expect(cards.nth(minimum - 1)).toBeVisible({ timeout: LONG });
  }
}

/** Fails the test early with a clear message when the seed lacks something a spec relies on (never a skip). */
export function seedExpectation(condition: boolean, what: string): void {
  expect(condition, `${what}: re-seed with \`SEED_TARGET=pglite SEED_PGLITE_DIR=./.pglite/e2e pnpm --filter @foundmill/db seed\` (apps/web/e2e/README.md)`).toBe(true);
}

/** A real 256 px PNG logo in a saturated orange, for the upload specs. */
export function logoPng(): Buffer {
  return Buffer.from(makePng(256, 256, [214, 92, 38, 255]));
}

export { test, expect };
