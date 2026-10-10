import { expect, test } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * CRM list and universal search (BUILD §11.12) on the seeded Northwind Skincare (customers, suppliers and supplier
 * contacts). Stack and commands: e2e/README.md.
 */
test.describe("crm", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page, "crm");
    await expect(page.getByTestId("crm-screen")).toBeVisible({ timeout: LONG });
  });

  test("lists records with grouped views, importers and the data duties panel", async ({ page }) => {
    await expect(page.getByTestId("crm-importers")).toContainText("Affinity");
    await expect(page.getByTestId("crm-data-duties")).toContainText("Lawful basis");
    // Dugout's DataTable is an ARIA grid; the seed gives Northwind records to list.
    const grid = page.getByRole("grid", { name: "CRM records" });
    await expect(grid).toBeVisible({ timeout: LONG });
    await expect(grid.getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
    // Plain words in the cells: a record's kind is singular ("Organisation", never the "Organisations" group name),
    // and the agents' old "squad" source never reaches the founder.
    await expect(grid.locator('[data-col="kind"]').filter({ hasText: /^(Organisation|Person|Agent|Staff|Member|Community|Venue)$/ }).first()).toBeVisible();
    await expect(grid.locator('[data-col="kind"]').filter({ hasText: /Organisations|People/ })).toHaveCount(0);
    await expect(grid).not.toContainText(/\bsquad\b/);
    await page.getByRole("button", { name: /^View: / }).click();
    await page.getByRole("menuitemradio", { name: "By kind" }).click();
    await expect(page.getByRole("button", { name: /^View: By kind/ })).toBeVisible();
    await expect(page.getByTestId("crm-groups")).toBeVisible();
  });

  test("natural language and operators become editable chips; typeahead groups by kind", async ({ page }) => {
    const input = page.getByTestId("crm-search-input");
    await input.fill("churned customers");
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("role:customer");
    await expect(page.getByTestId("crm-search")).toContainText("stage:churned");
    // Chips alone filter the listing client-side (data-mode stays "list"); free text switches to server search.
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "list");
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByTestId("crm-search")).not.toContainText("role:customer");
    await input.fill("kind:organisation a");
    await expect(page.getByTestId("crm-typeahead")).toBeVisible();
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("kind:organisation");
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "search");
  });

  test("new record dialog and the merge flow from a row", async ({ page }) => {
    await page.getByTestId("crm-new").click();
    await expect(page.getByTestId("new-entity-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("new-entity-dialog")).toBeHidden();
    // The first data row (row 0 is the column header).
    const row = page.getByRole("grid", { name: "CRM records" }).getByRole("row").nth(1);
    await expect(row, "the seed gives Northwind CRM records").toBeVisible({ timeout: LONG });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Merge…" }).click();
    await expect(page.getByTestId("merge-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("merge-dialog")).toBeHidden();
  });
});
