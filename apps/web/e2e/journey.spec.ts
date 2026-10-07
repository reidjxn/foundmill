import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/**
 * Customer Update replay (BUILD §11.4; AC-11.4.3 deterministic, AC-11.4.5 reduced motion) on the seeded Northwind
 * Skincare win. Stack and commands: e2e/README.md.
 */
async function openFirstReplay(page: Page): Promise<void> {
  await openBusiness(page, "inbox?tab=customers");
  const won = page.getByTestId("inbox-list").getByRole("option").first();
  await expect(won, "the seed gives Northwind a won customer").toBeVisible({ timeout: LONG });
  await won.click();
  const open = page.getByTestId("open-replay");
  await expect(open).toBeEnabled({ timeout: LONG });
  await open.click();
  await page.waitForURL(/\/journey\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("journey-screen")).toBeVisible({ timeout: LONG });
}

test.describe("journey", () => {
  test("plays the replay with the stage stepper, a CRM link and the speed remembered per founder", async ({ page }) => {
    await openFirstReplay(page);
    const screen = page.getByTestId("journey-screen");
    await expect(screen).toHaveAttribute("data-speed", "full");
    await expect(page.locator("[data-stepper]")).toBeVisible();
    await expect(page.getByTestId("journey-crm-link")).toBeVisible();
    await page.locator("[data-speed=highlights]").click();
    await expect(screen).toHaveAttribute("data-speed", "highlights");
    await page.reload();
    await expect(page.getByTestId("journey-screen")).toHaveAttribute("data-speed", "highlights", { timeout: LONG });
    await page.locator("[data-speed=full]").click();
    await expect(page.getByTestId("journey-screen")).toHaveAttribute("data-speed", "full");
  });

  test("AC-11.4.3: the same record renders the same frame schedule twice", async ({ page }) => {
    await openFirstReplay(page);
    const stage = page.locator("[data-journey-stage]");
    await expect(stage).toBeVisible({ timeout: LONG });
    await expect(stage).toHaveAttribute("data-schedule-hash", /^[0-9a-f]{8}$/);
    const hash = (await stage.getAttribute("data-schedule-hash"))!;
    const summary = await stage.getAttribute("aria-label");
    await page.reload();
    const again = page.locator("[data-journey-stage]");
    await expect(again).toHaveAttribute("data-schedule-hash", hash, { timeout: LONG });
    if (summary) await expect(again).toHaveAttribute("aria-label", summary);
  });

  test("AC-11.4.5: reduced motion shows the static summary with the same facts", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFirstReplay(page);
    await expect(page.locator("[data-journey-stage='static']")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-stage-panel='goal'][data-static]")).toBeVisible();
    await expect(page.locator("[data-stage-panel='team_sheet']")).toBeVisible();
    await expect(page.locator("[data-stage-panel='full_time']")).toBeVisible();
  });

  test("the CRM link opens the customer's profile and an unknown id says so", async ({ page }) => {
    await openFirstReplay(page);
    await page.getByTestId("journey-crm-link").click();
    await expect(page).toHaveURL(/\/crm\/[0-9a-f-]{36}\//, { timeout: LONG });
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/journey/00000000-0000-4000-8000-00000000dead`);
    await expect(page.getByTestId("journey-not-found")).toBeVisible({ timeout: LONG });
  });
});
