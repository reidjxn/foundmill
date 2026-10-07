import { expect, test } from "@playwright/test";

/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7). Needs apps/api in mock mode with
 * DEV_AUTH_USER_ID set and a founder profile for that user; the test drafts a card in the studio first. Not run in
 * the build container: no browser.
 */
test.describe("commit", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
    if (/\/onboarding/.test(page.url())) test.skip(true, "founder profile missing; run onboarding.spec.ts first");
    await page.goto("/new/ideate");
    const grid = page.getByTestId("concept-grid");
    if ((await grid.locator("[data-concept]").count()) === 0) {
      await page.getByTestId("generate-button").click();
      await expect(grid.locator("[data-concept]").first()).toBeVisible({ timeout: 30_000 });
    }
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    await expect(page.getByTestId("commit-form")).toBeVisible();
  });

  test("AC-11.1.7: Assisted is the default business mode; Personal the default game mode", async ({ page }) => {
    await expect(page.getByTestId("commit-form")).toHaveAttribute("data-business-mode", "assisted");
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-option="personal"]')).toHaveAttribute("data-selected", "true");
    await expect(page.getByLabel(/Spend cap per action/)).toHaveValue("250");
  });

  test("name suggestions, live domain availability and the trademark screen with its caveat", async ({ page }) => {
    await expect(page.getByTestId("domain-checks").locator("[data-domain]")).toHaveCount(5);
    await expect(page.getByTestId("trademark-screen").locator("[data-registry]")).toHaveCount(2);
    await expect(page.getByTestId("trademark-caveat")).toContainText("Screen, not legal clearance");
    await page.getByLabel(/Business name/).fill("Stripe Ledger");
    await expect(page.locator('[data-registry="USPTO"]')).toHaveAttribute("data-status", "conflict");
    await expect(page.locator('[data-domain="stripeledger.com"]')).toBeVisible();
    await page.locator("[data-suggestion]").first().click();
    await expect(page.getByLabel(/Business name/)).not.toHaveValue("Stripe Ledger");
  });

  test("crest preview follows the name and the brand colours; the contrast check reads the primary", async ({ page }) => {
    const crest = page.getByTestId("crest-preview").locator("[data-crest-seed]");
    const seedBefore = await crest.getAttribute("data-crest-seed");
    await page.getByTestId("shuffle-crest").click();
    expect(await crest.getAttribute("data-crest-seed")).not.toBe(seedBefore);
    await page.getByTestId("kit-primary-hex").fill("#ffff00");
    await expect(page.getByTestId("kit-contrast")).toContainText(/near-black/);
    await page.getByTestId("kit-primary-hex").fill("#1b4fd8");
    await expect(page.getByTestId("kit-contrast")).toHaveAttribute("data-passes", "true");
  });

  test("AC-11.1.6: Take charge creates the business and opens the Board item in the Inbox", async ({ page }) => {
    const name = `Playwright Club ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    await page.getByLabel(/Business mode/).getByLabel(/Assisted/).check();
    await page.getByTestId("take-charge").click();
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]+\/inbox\/[0-9a-f-]+/, { timeout: 60_000 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("kit-bar")).toContainText(name);
  });
});
