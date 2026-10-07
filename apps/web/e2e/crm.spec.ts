import { expect, test } from "@playwright/test";

/**
 * CRM list and universal search (BUILD §11.12). Not run in the build container (no browser). Needs apps/api in mock
 * mode with DEV_AUTH_USER_ID set to a seeded owner (Northwind seeds customers, suppliers and supplier contacts).
 */
test.describe("crm", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  });

  test("lists records with grouped views, importers and the data duties panel", async ({ page }) => {
    const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/crm`);
    await expect(page.getByTestId("crm-screen")).toBeVisible();
    await expect(page.getByTestId("crm-importers")).toContainText("Affinity");
    await expect(page.getByTestId("crm-data-duties")).toContainText("Lawful basis");
    await expect(page.getByRole("table", { name: "CRM records" }).or(page.getByLabel("CRM records"))).toBeVisible();
    await page.getByRole("button", { name: /Saved view|All/ }).first().click();
    await page.getByRole("menuitemradio", { name: "By kind" }).or(page.getByRole("option", { name: "By kind" })).first().click();
    await expect(page.getByTestId("crm-groups")).toBeVisible();
  });

  test("natural language and operators become editable chips; typeahead groups by kind", async ({ page }) => {
    const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/crm`);
    const input = page.getByTestId("crm-search-input");
    await input.fill("churned customers");
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("role:customer");
    await expect(page.getByTestId("crm-search")).toContainText("stage:churned");
    await page.getByRole("button", { name: "Clear all" }).click();
    await input.fill("kind:organisation a");
    await expect(page.getByTestId("crm-typeahead")).toBeVisible();
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("kind:organisation");
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "search");
  });

  test("new record dialog and the merge flow from a row", async ({ page }) => {
    const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/crm`);
    await page.getByTestId("crm-new").click();
    await expect(page.getByTestId("new-entity-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    const row = page.locator("[role=row][data-row-id], tbody tr").first();
    test.skip((await row.count()) === 0, "no records seeded");
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Merge…" }).click();
    await expect(page.getByTestId("merge-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
