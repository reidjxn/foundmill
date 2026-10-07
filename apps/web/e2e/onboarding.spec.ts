import { expect, test } from "@playwright/test";

/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1). Needs apps/api in mock mode with DEV_AUTH_USER_ID set
 * and NEXT_PUBLIC_APP_ENV=development (the dev bypass). Not run in the build container: no browser.
 */
test.describe("onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  });

  test("AC-11.1.1: a founder without a profile is sent to /onboarding from /b/* and from /new", async ({ page }) => {
    await page.goto("/onboarding");
    const editing = /Save and continue/.test(await page.getByTestId("profile-submit").innerText());
    test.skip(editing, "the dev user already has a profile; the gate only applies before it exists");
    await page.goto("/b/00000000-0000-4000-8000-000000000001/home");
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.goto("/new/ideate");
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("renders every section, five skill sliders and the section rail", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible();
    for (const id of ["identity", "skills", "time", "place", "constraints"]) await expect(page.locator(`[data-section="${id}"]`)).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(5);
    await expect(page.locator("[data-section-link]")).toHaveCount(5);
    await expect(page.getByTestId("studio-frame")).toHaveAttribute("data-step", "profile");
  });

  test("refuses an incomplete profile, then saves and lands on /new", async ({ page }) => {
    await page.goto("/onboarding");
    const name = page.getByLabel(/What the squad calls you/);
    await name.fill("");
    await page.getByTestId("profile-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await name.fill("Playwright Founder");
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    await page.getByLabel(/Budget you can commit/).fill("25k");
    const markets = page.getByLabel(/Target markets/);
    await markets.fill("Nordics");
    await markets.press("Enter");
    await page.getByRole("button", { name: "Remote only" }).click();
    await page.getByLabel("Medium").check();
    await page.getByTestId("profile-summary").getByText(/First-time founder · full time · EUR 25,000/).waitFor();
    await page.getByTestId("profile-submit-bottom").click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByTestId("doors")).toBeVisible();
  });
});
