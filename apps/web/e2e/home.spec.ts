import { expect, test, type Page } from "@playwright/test";

/**
 * Home dashboards (BUILD §11.2, AC-11.2.4). Not run in the build container (no browser). Needs apps/api in mock
 * mode with DEV_AUTH_USER_ID set to a seeded owner and NEXT_PUBLIC_APP_ENV=development.
 */
async function openHome(page: Page): Promise<string | null> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  return page.url().match(/\/b\/([0-9a-f-]+)/)?.[1] ?? null;
}

test.describe("home", () => {
  test("renders the active dashboard as a tab with the widget grid", async ({ page }) => {
    const bid = await openHome(page);
    test.skip(!bid, "no seeded business for the dev user");
    const screen = page.getByTestId("home-screen");
    await expect(screen).toBeVisible();
    await expect(screen).toHaveAttribute("data-dashboard-id", /[0-9a-f-]{36}/);
    await expect(page.getByTestId("home-grid")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Dashboards" })).toBeVisible();
  });

  test("E toggles Edit mode; the toolbar button mirrors it; Esc leaves it", async ({ page }) => {
    const bid = await openHome(page);
    test.skip(!bid, "no seeded business for the dev user");
    await expect(page.getByTestId("home-screen")).toBeVisible();
    await page.keyboard.press("e");
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-screen")).not.toHaveAttribute("data-editing", "true");
  });

  test("AC-11.2.4: a second dashboard works independently, persists its version and can be deleted", async ({ page }) => {
    const bid = await openHome(page);
    test.skip(!bid, "no seeded business for the dev user");
    const first = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    await page.getByTestId("new-dashboard").click();
    await page.locator("[data-preset=seller]").click();
    await page.waitForURL(/\/home\/[0-9a-f-]{36}/);
    const second = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    expect(second).not.toBe(first);
    const version = Number(await page.getByTestId("home-screen").getAttribute("data-dashboard-version"));
    expect(version).toBeGreaterThanOrEqual(1);
    // Two tabs: the original and the new one.
    expect(await page.getByRole("tablist", { name: "Dashboards" }).getByRole("tab").count()).toBeGreaterThanOrEqual(2);
    await page.getByTestId("dashboard-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByTestId("confirm-delete-dashboard").click();
    await page.waitForURL(new RegExp(`/b/${bid}/home$`));
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-dashboard-id", first!);
  });
});
