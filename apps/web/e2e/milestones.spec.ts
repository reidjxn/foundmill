import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/** Milestones (BUILD §11.4; the old `/trophies` path forwards here) on the seeded Northwind Skincare. Stack: e2e/README.md. */
test.describe("milestones", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("/trophies forwards to /milestones, which shows the eight milestones and the timeline", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/trophies`);
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/milestones$`), { timeout: LONG });
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy]")).toHaveCount(8);
    await expect(page.getByTestId("milestones-timeline")).toBeVisible();
    // Two years of seeded wins light several milestones up.
    expect(await page.locator("[data-trophy][data-achieved]").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("milestones-screen")).toHaveAttribute("data-won", /^[1-8]$/);
  });

  test("a reached milestone opens its Customer Update when one is recorded", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    const reached = page.locator("[data-trophy][data-achieved] button").first();
    await expect(reached, "the seed gives Northwind at least one reached milestone").toBeVisible();
    await reached.click();
    // Either the replay of the win that reached it, or the note that none was recorded (Radix toasts repeat their title for the live region).
    await expect(page.getByTestId("journey-screen").or(page.getByText("No replay recorded for this milestone").first())).toBeVisible({ timeout: LONG });
  });
});
