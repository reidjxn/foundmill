import { expect, test } from "@playwright/test";
import { LONG, openBusiness, setBuilderView } from "./helpers";

/**
 * Settings › Basics (WP-10 T11): with Builder view off the sidebar's Settings opens on five basics, each one press from
 * the setting; with Builder view on it opens on Business as before. global-setup.ts starts every run with Builder view
 * off; the second test turns it on and puts it back.
 */
test.describe("Settings › Basics", () => {
  test("a guided account's Settings opens on Basics, and each row reaches its tab in one click", async ({ page }) => {
    await openBusiness(page, "today");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "basics", { timeout: LONG });
    const rows = page.getByTestId("settings-basics").getByRole("link");
    await expect(rows).toHaveCount(5);
    await expect(page.locator("[data-basics-row=members]")).toContainText(/Just you|\d+ people/);
    await page.locator("[data-basics-row=mode]").click();
    await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "mode", { timeout: LONG });
  });

  test("Builder view opens on Business as before", async ({ page, playwright }) => {
    const before = await setBuilderView(playwright, true);
    try {
      await openBusiness(page, "today");
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" }).click();
      await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "business", { timeout: LONG });
    } finally {
      await setBuilderView(playwright, before);
    }
  });
});
