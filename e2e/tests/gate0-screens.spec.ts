import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * Gate 0 evidence (BUILD §16.1, docs/GATES.md): "shell renders seeded data at 1440 px" and "NeedsLargerWindow below
 * 1280 px". Signs in through the dev bypass as the seed owner, opens the seeded Northwind Skincare Home, waits until the
 * seeded data is on screen (the Journey Ribbon's accessible summary names its milestones only once the two years of
 * `journey_daily` are drawn; the department cards come from the seeded departments) and writes full-page screenshots
 * under e2e/screens/. The files are the evidence linked from docs/GATES.md; the assertions make the spec fail rather
 * than photograph an empty shell.
 */

const NORTHWIND_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000001";
const LONG = 60_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = path.resolve(here, "..", "screens");

const screen = (name: string) => path.join(SCREENS_DIR, name);

test.describe("Gate 0 screenshots (seeded Northwind Skincare)", () => {
  test.beforeAll(() => {
    mkdirSync(SCREENS_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/|\/onboarding|\/new/);
  });

  test("shell renders seeded data at 1440 × 900 → e2e/screens/gate0-home-1440.png", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    const shell = page.getByTestId("app-shell");
    await expect(shell).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    // Seeded data, not an empty shell: the business name in the brand-colour bar, the area links in the sidebar,
    // the Ribbon summary over the seeded history and at least three department cards.
    await expect(page.getByTestId("kit-bar")).toContainText(/Northwind/);
    expect(await page.locator("[data-testid=app-shell] nav a[href*='/d/']").count()).toBeGreaterThanOrEqual(3);
    const home = page.getByTestId("home-screen");
    const ribbon = home.getByRole("group", { name: /^Journey Ribbon:/ });
    await expect(ribbon).toBeVisible({ timeout: LONG });
    await expect(ribbon).toHaveAccessibleName(/\d+ milestones/, { timeout: LONG });
    // Every row of the ribbon is named, with its value for the last 7 days ("Hours of team work", never
    // "agent hours", wherever a person reads it: UX plan B16).
    for (const row of ["Revenue", "New signups", "Paying customers", "Hours of team work"]) await expect(ribbon.locator("[data-ribbon-labels]")).toContainText(row);
    await expect(ribbon.locator("[data-readout-when]")).toHaveText("Last 7 days");
    await expect(ribbon.locator("[data-readout='payments']")).toHaveText(/^\d[\d,]*$/);
    const cards = home.locator("[data-widget=department_card][data-widget-id]");
    await expect(cards.first()).toBeVisible({ timeout: LONG });
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    await expect(cards.first().locator("section[data-department]")).toBeVisible();
    await page.screenshot({ path: screen("gate0-home-1440.png"), fullPage: false });
  });

  test("NeedsLargerWindow replaces the shell at 1279 × 900 → e2e/screens/gate0-needs-larger-window-1279.png", async ({ page }) => {
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    const notice = page.getByTestId("needs-larger-window");
    await expect(notice).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    await page.screenshot({ path: screen("gate0-needs-larger-window-1279.png"), fullPage: false });
    // And the shell comes back once the window is wide enough again.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  });
});
