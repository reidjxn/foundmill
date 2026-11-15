import { expect, test } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * "Explain this page" (Phase 3): one quiet button per page replaces the "What this screen is for" banner that sat on
 * every tab. Guidance is on by default for the dev founder. Stack and commands: e2e/README.md.
 */
test.describe("explain this page", () => {
  test("a department tab shows one button in the tab row, no banner, and opening it shows the three lines", async ({ page }) => {
    await openBusiness(page);
    const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
    await expect(product).toBeVisible({ timeout: LONG });
    const href = (await product.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/vision"));
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "product/vision", { timeout: LONG });

    const button = page.getByRole("button", { name: /^Explain this page/ });
    await expect(button).toHaveCount(1);
    await expect(button).toBeVisible({ timeout: LONG });
    // At the right end of the tab row: inside the viewport and the top bar (kit bar plus tab row), not inside the screen, and no banner anywhere.
    const box = (await button.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box.y + box.height).toBeLessThanOrEqual(100);
    await expect(page.getByTestId("module-screen").locator("[data-explainer]")).toHaveCount(0);
    await expect(page.getByText("What this screen is for")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Got it", exact: true })).toHaveCount(0);

    await button.click();
    const panel = page.getByTestId("explain-page-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("What this screen is for");
    await expect(panel).toContainText("What to do here");
    await expect(panel).toContainText("Watch for");

    // Escape closes it and the focus goes back to the button.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Explain this page/ })).toBeFocused();
  });
});
