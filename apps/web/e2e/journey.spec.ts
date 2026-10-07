import { expect, test, type Page } from "@playwright/test";

/**
 * Customer Update replay (BUILD §11.4; AC-11.4.3 deterministic, AC-11.4.5 reduced motion). Not run in the build
 * container (no browser). Needs apps/api in mock mode with DEV_AUTH_USER_ID set to a seeded owner.
 */
async function openFirstReplay(page: Page): Promise<string | null> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1] ?? null;
  if (!bid) return null;
  await page.goto(`/b/${bid}/inbox?tab=customers`);
  const won = page.getByTestId("inbox-list").getByRole("option").first();
  if ((await won.count()) === 0) return null;
  await won.click();
  const open = page.getByTestId("open-replay");
  await expect(open).toBeEnabled({ timeout: 10_000 });
  await open.click();
  await page.waitForURL(/\/journey\/[0-9a-f-]{36}/);
  return bid;
}

test.describe("journey", () => {
  test("plays the replay with the stage stepper, a CRM link and the speed remembered per founder", async ({ page }) => {
    const bid = await openFirstReplay(page);
    test.skip(!bid, "no won customer seeded for the dev user");
    const screen = page.getByTestId("journey-screen");
    await expect(screen).toBeVisible();
    await expect(screen).toHaveAttribute("data-speed", "full");
    await expect(page.locator("[data-stepper]")).toBeVisible();
    await expect(page.getByTestId("journey-crm-link")).toBeVisible();
    await page.locator("[data-speed=highlights]").click();
    await expect(screen).toHaveAttribute("data-speed", "highlights");
    await page.reload();
    await expect(page.getByTestId("journey-screen")).toHaveAttribute("data-speed", "highlights");
    await page.locator("[data-speed=full]").click();
  });

  test("AC-11.4.3: the same record renders the same frame schedule twice", async ({ page }) => {
    const bid = await openFirstReplay(page);
    test.skip(!bid, "no won customer seeded for the dev user");
    const stage = page.locator("[data-journey-stage]");
    const hash = await stage.getAttribute("data-schedule-hash");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    await page.reload();
    await expect(page.locator("[data-journey-stage]")).toHaveAttribute("data-schedule-hash", hash!);
  });

  test("AC-11.4.5: reduced motion shows the static summary with the same facts", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const bid = await openFirstReplay(page);
    test.skip(!bid, "no won customer seeded for the dev user");
    await expect(page.locator("[data-journey-stage='static']")).toBeVisible();
    await expect(page.locator("[data-stage-panel='goal'][data-static]")).toBeVisible();
    await expect(page.locator("[data-stage-panel='team_sheet']")).toBeVisible();
  });

  test("the CRM link opens the customer's profile and an unknown id says so", async ({ page }) => {
    const bid = await openFirstReplay(page);
    test.skip(!bid, "no won customer seeded for the dev user");
    await page.getByTestId("journey-crm-link").click();
    await expect(page).toHaveURL(/\/crm\/[0-9a-f-]{36}\//);
    await page.goto(`/b/${bid}/journey/00000000-0000-4000-8000-00000000dead`);
    await expect(page.getByTestId("journey-not-found")).toBeVisible();
  });
});
