import { expect, test } from "@playwright/test";

/**
 * Milestones (BUILD §11.4; the old `/trophies` path forwards here). Not run in the build container (no browser).
 * Needs apps/api in mock mode with DEV_AUTH_USER_ID set to a seeded owner.
 */
test.describe("milestones", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  });

  test("/trophies forwards to /milestones, which shows the eight milestones and the timeline", async ({ page }) => {
    const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/trophies`);
    await expect(page).toHaveURL(new RegExp(`/b/${bid}/milestones$`));
    await expect(page.getByTestId("milestones-screen")).toBeVisible();
    await expect(page.locator("[data-trophy]")).toHaveCount(8);
    await expect(page.getByTestId("milestones-timeline")).toBeVisible();
  });

  test("a reached milestone opens its Customer Update when one is recorded", async ({ page }) => {
    const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/milestones`);
    const won = page.locator("[data-trophy][data-achieved] button").first();
    test.skip((await won.count()) === 0, "no milestone reached yet");
    await won.click();
    await expect(page.getByTestId("journey-screen").or(page.getByText("No replay recorded for this milestone"))).toBeVisible();
  });
});
