import { expect, test } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Development › Code (0013 workspaces): the code agents wrote on code tasks, saved by the orchestrator when each
 * session ends. The local stack runs no orchestrator, so the seeded business has no saved code; the spec checks the
 * tab's place and its empty state. Saving and restoring are covered in apps/orchestrator (session-live, workspace-store)
 * and reading in apps/api (dev-code) and packages/modules (code.test.tsx).
 */
test.describe("development code tab", () => {
  test("sits after Pull requests and explains where saved code comes from", async ({ page }) => {
    await openBusiness(page);
    const development = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /development/i }).first();
    await expect(development, "the seed gives Northwind a Development department").toBeVisible({ timeout: LONG });
    const href = (await development.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/code"));
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/code", { timeout: LONG });

    const tabs = await page.getByRole("tab").allTextContents();
    const pr = tabs.findIndex((t) => /pull requests/i.test(t));
    expect(pr, "the Development tabs include Pull requests").toBeGreaterThanOrEqual(0);
    expect(tabs[pr + 1]).toMatch(/^code$/i);

    await expect(page.getByText("No saved code yet")).toBeVisible({ timeout: LONG });
    await expect(page.getByText(/the files it wrote are saved here/)).toBeVisible();
    await page.getByRole("button", { name: "Go to Plan" }).click();
    await page.waitForURL(/\/d\/[^/]+\/plan/, { timeout: LONG });
  });
});
