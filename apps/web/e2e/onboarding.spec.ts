import { expect, test } from "@playwright/test";
import { DEMO_OWNER_DISPLAY_NAME, LONG, NORTHWIND_BUSINESS_ID, completeProfile, devApi, readFounderProfile, restoreFounderProfile, type FounderProfileSnapshot } from "./helpers";

/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1). Stack and commands: e2e/README.md. This file runs
 * before every other spec (the `profile` project in playwright.config.ts): on a database seeded with
 * SEED_OWNER_PROFILE=0 the first test meets the gate and saves the profile; on a later run it finds the profile
 * saved and asserts the other half of the contract (business routes open, the form is pre-filled).
 *
 * The tests save the profile as "Playwright Founder". The dev founder is the one every other spec and screen shows, so
 * the profile as it was before this file is put back when it finishes (`restoreFounderProfile`).
 */
test.describe("onboarding", () => {
  let before: FounderProfileSnapshot | null = null;
  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    before = await readFounderProfile(api);
    await api.dispose();
  });
  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    await restoreFounderProfile(api, before);
    // The name every screen shows is the one it had before (or the seed's, when this file created the profile).
    expect((await readFounderProfile(api))?.displayName).toBe(before?.displayName ?? DEMO_OWNER_DISPLAY_NAME);
    await api.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/|\/onboarding|\/new/, { timeout: LONG });
  });

  test("AC-11.1.1: a founder without a profile is held at /onboarding from / and /b/* and /new until the profile is saved", async ({ page }) => {
    // `/` sends a founder without a profile to /onboarding and everyone else to a business Home or /new.
    const gated = /\/onboarding/.test(page.url());
    test.info().annotations.push({ type: "profile", description: gated ? "missing: gate exercised, then the profile was saved" : "present: the gate stays closed and the pre-filled form saves" });
    if (/^(1|true|yes)$/i.test(process.env.E2E_EXPECT_PROFILE_GATE ?? "")) expect(gated, "E2E_EXPECT_PROFILE_GATE is set: `/` must redirect the dev user to /onboarding").toBe(true);
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("profile-submit")).toHaveText(gated ? /^Continue$/ : /Save and continue/);
    if (gated) {
      // The gate: /b/* and /new/* both bounce to /onboarding before the profile exists.
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/new/ideate");
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/businesses");
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/onboarding");
      await completeProfile(page);
    } else {
      await page.getByTestId("profile-submit-bottom").click();
      await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
      await expect(page.getByTestId("doors")).toBeVisible();
    }
    // With the profile saved, business routes and the studio open.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.goto("/new/ideate");
    await expect(page).toHaveURL(/\/new\/ideate$/);
    await expect(page.getByTestId("prompt-box")).toBeVisible({ timeout: LONG });
    // `/` now resolves to a business Home (the seed owner owns Northwind and Ledgerly).
    await page.goto("/");
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/home/, { timeout: LONG });
  });

  test("renders every section, five skill sliders and the section rail", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    for (const id of ["identity", "skills", "time", "place", "constraints"]) await expect(page.locator(`[data-section="${id}"]`)).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(5);
    await expect(page.locator("[data-section-link]")).toHaveCount(5);
    await expect(page.getByTestId("studio-frame")).toHaveAttribute("data-step", "profile");
    // A co-founder joining someone else's business finds their account ID here, before any business exists (WEB-12).
    await expect(page.getByTestId("profile-account-id").getByTestId("account-id")).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("refuses values the API would reject, inline and in plain words (audit FR-14)", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await page.getByLabel(/Budget you can commit/).fill("99999999999999m");
    await page.getByTestId("profile-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: /Use a budget below/ })).toBeVisible();
    await expect(page.getByText(/budgetMinor|Too big/)).toHaveCount(0);
    // The country fields stop at 80 characters instead of accepting text the API refuses.
    const citizenship = page.locator("#profile-citizenship");
    await citizenship.fill("x".repeat(100));
    await expect(citizenship).toHaveValue("x".repeat(80));
  });

  test("refuses an incomplete profile, then saves and lands on /new", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    const name = page.getByLabel(/What the team calls you/);
    await name.fill("");
    await page.getByTestId("profile-submit").click();
    // The field error and the footer count are both alerts: the name field's error is the one that matters here.
    await expect(page.getByRole("alert").filter({ hasText: "Tell the team what to call you." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /field(s)? to complete/ })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
    await name.fill("Playwright Founder");
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    await page.getByLabel(/Budget you can commit/).fill("25k");
    // The chip input and its suggestions list share the "Target markets" label prefix; the textbox is the field.
    const markets = page.getByRole("textbox", { name: "Target markets" });
    await markets.fill("Nordics");
    await markets.press("Enter");
    await expect(page.getByRole("list", { name: "Target markets chosen" })).toContainText("Nordics");
    // A suggestion chip moves to the chosen list once picked (and is already there on a profile saved by an earlier run).
    const remoteOnly = page.getByRole("button", { name: "Remote only", exact: true });
    if (await remoteOnly.count()) await remoteOnly.click();
    await expect(page.getByRole("list", { name: "Constraints chosen" })).toContainText("Remote only");
    await page.getByLabel("Medium").check();
    // The currency is whatever the stored profile holds (the shared dev database may carry any of them): the summary
    // names it by its ISO code before the grouped amount.
    await expect(page.getByTestId("profile-summary")).toContainText(/First-time founder · full time · [A-Z]{3} 25,000/);
    await page.getByTestId("profile-submit-bottom").click();
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible();
  });
});
