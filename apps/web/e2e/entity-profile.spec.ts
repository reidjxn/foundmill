import { expect, test, type Page } from "@playwright/test";

/**
 * Entity profile (BUILD §11.12 profile tabs; AC-11.12.3 merge then unmerge). Not run in the build container (no
 * browser). Needs apps/api in mock mode with DEV_AUTH_USER_ID set to a seeded owner.
 */
async function openFirstEntity(page: Page): Promise<string | null> {
  const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
  if (!bid) return null;
  await page.goto(`/b/${bid}/crm`);
  const link = page.locator("a[href*='/crm/']").filter({ hasNot: page.locator("[href$='/crm']") }).first();
  if ((await link.count()) === 0) return null;
  const href = await link.getAttribute("href");
  if (!href) return null;
  await page.goto(href);
  return bid;
}

test.describe("entity profile", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  });

  test("header with relationship strength and lead score, seven tabs", async ({ page }) => {
    const bid = await openFirstEntity(page);
    test.skip(!bid, "no seeded records for the dev user");
    await expect(page.getByTestId("entity-profile")).toBeVisible();
    await expect(page.getByTestId("profile-header")).toContainText("Relationship");
    for (const tab of ["Overview", "Activity", "Relationships", "Commercial", "Documents", "Notes", "Journey"]) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    await expect(page.getByTestId("key-facts")).toBeVisible();
    await expect(page.getByTestId("standing")).toContainText("Lead score");
    await page.getByRole("tab", { name: "Relationships" }).click();
    await expect(page.getByTestId("relationship-graph")).toBeVisible();
    await expect(page.getByTestId("intro-paths")).toBeVisible();
    await page.getByRole("tab", { name: "Journey" }).click();
    await expect(page.getByTestId("journey-list")).toBeVisible();
  });

  test("data duties: export shows the JSON; deletion is queued, never immediate", async ({ page }) => {
    const bid = await openFirstEntity(page);
    test.skip(!bid, "no seeded records for the dev user");
    await page.getByTestId("entity-export").click();
    await expect(page.getByTestId("export-dialog")).toContainText("exportedAt");
    await page.keyboard.press("Escape");
    await page.getByTestId("entity-delete").click();
    await expect(page.getByTestId("delete-request-dialog")).toContainText("never runs immediately");
    await page.keyboard.press("Escape");
  });

  test("notes can be added", async ({ page }) => {
    const bid = await openFirstEntity(page);
    test.skip(!bid, "no seeded records for the dev user");
    await page.getByRole("tab", { name: "Notes" }).click();
    await page.getByTestId("note-input").fill("Met at the trade fair; wants samples in March.");
    await page.getByTestId("note-save").click();
    await expect(page.getByTestId("notes-list")).toContainText("trade fair");
  });

  test("merge then unmerge restores both records (AC-11.12.3)", async ({ page }) => {
    const bid = await openFirstEntity(page);
    test.skip(!bid, "no seeded records for the dev user");
    const url = page.url();
    await page.getByTestId("entity-merge").click();
    const dialog = page.getByTestId("merge-dialog");
    await dialog.getByLabel(/Find the duplicate/).fill("a");
    const match = page.getByTestId("merge-matches").getByRole("option").first();
    test.skip((await match.count()) === 0, "no duplicate candidate");
    const otherName = await match.textContent();
    await match.click();
    await page.getByTestId("merge-confirm").click();
    await expect(page.getByTestId("merge-banner")).toBeVisible();
    await page.getByTestId("unmerge").first().click();
    await expect(page.getByTestId("merge-banner")).toHaveCount(0);
    await page.goto(url);
    await expect(page.getByTestId("entity-profile")).toBeVisible();
    if (otherName) await expect(page.getByTestId("entity-profile")).not.toContainText(`Absorbed`);
  });
});
