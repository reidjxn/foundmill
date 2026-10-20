import { expect, test } from "@playwright/test";
import { LONG, chooseTableView, openBusiness } from "./helpers";

/**
 * CRM list and universal search (BUILD §11.12) on the seeded Northwind Skincare (customers, suppliers and supplier
 * contacts). Stack and commands: e2e/README.md.
 */
test.describe("crm", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page, "crm");
    await expect(page.getByTestId("crm-screen")).toBeVisible({ timeout: LONG });
    // The open view is saved per person (audit #204): start every test from All, whatever an earlier one left open.
    await chooseTableView(page, "All");
  });

  test("lists records with grouped views, importers and the data duties panel", async ({ page }) => {
    // "Contacts" is the screen's name in the chrome (founder decision 2026-10-20, item 1); the grid keeps "CRM records".
    await expect(page.getByTestId("kitbar-screen-title")).toHaveText("Contacts", { timeout: LONG });
    await expect(page.getByTestId("crm-importers")).toContainText("Affinity");
    await expect(page.getByTestId("crm-data-duties")).toContainText("Lawful basis");
    // Dugout's DataTable is an ARIA grid; the seed gives Northwind records to list.
    const grid = page.getByRole("grid", { name: "CRM records" });
    await expect(grid).toBeVisible({ timeout: LONG });
    await expect(grid.getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
    // Plain words in the cells: a record's kind is singular ("Organization", never the "Organizations" group name),
    // and the agents' old "squad" source never reaches the founder.
    await expect(grid.locator('[data-col="kind"]').filter({ hasText: /^(Organization|Person|Agent|Staff|Member|Community|Venue)$/ }).first()).toBeVisible();
    await expect(grid.locator('[data-col="kind"]').filter({ hasText: /Organizations|People/ })).toHaveCount(0);
    await expect(grid).not.toContainText(/\bsquad\b/);
    await page.getByRole("button", { name: /^View: / }).click();
    await page.getByRole("menuitemradio", { name: "By kind" }).click();
    await expect(page.getByRole("button", { name: /^View: By kind/ })).toBeVisible();
    await expect(page.getByTestId("crm-groups")).toBeVisible();
  });

  test("a saved view, and the view left open, come back after a reload (audit #204)", async ({ page }) => {
    const name = `E2E view ${Date.now().toString(36)}`;
    await chooseTableView(page, "By kind");
    await page.getByRole("button", { name: /^View: / }).click();
    await page.getByRole("menuitem", { name: "Save as new view…" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: `View: ${name}` })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("crm-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("button", { name: `View: ${name}` })).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("crm-groups")).toBeVisible();
    // Deleting it is kept too: the table goes back to All, after a reload as well.
    await page.getByRole("button", { name: `View: ${name}` }).click();
    await page.getByRole("menuitem", { name: "Delete view" }).click();
    await expect(page.getByRole("button", { name: "View: All" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "View: All" })).toBeVisible({ timeout: LONG });
    await page.getByRole("button", { name: "View: All" }).click();
    await expect(page.getByRole("menuitemradio", { name })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("natural language and operators become editable chips; typeahead groups by kind", async ({ page }) => {
    const input = page.getByTestId("crm-search-input");
    await input.fill("churned customers");
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("role:customer");
    await expect(page.getByTestId("crm-search")).toContainText("stage:churned");
    // Chips alone filter the listing on the server (crm.entity.list, data-mode stays "list"); free text switches to
    // search.
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "list");
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByTestId("crm-search")).not.toContainText("role:customer");
    await input.fill("kind:organization a");
    await expect(page.getByTestId("crm-typeahead")).toBeVisible();
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("kind:organization");
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "search");
  });

  test("rows carry their roles and stages; chip filters and natural language reach every record", async ({ page }) => {
    const grid = page.getByRole("grid", { name: "CRM records" });
    const roles = grid.locator('td[data-col="roles"]');
    const input = page.getByTestId("crm-search-input");
    // The placeholder's own example: Northwind's six suppliers, each with its role and stage.
    await input.fill("kind:organization role:supplier");
    await input.press("Enter");
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "list");
    await expect(grid.getByText("Pennine Contract Cosmetics")).toBeVisible({ timeout: LONG });
    await expect(roles.filter({ hasText: "Supplier" })).toHaveCount(6);
    await expect(roles.filter({ hasNotText: "Supplier" })).toHaveCount(0);
    await expect(grid.locator('td[data-col="stage"]').filter({ hasText: "Contracted" }).first()).toBeVisible();
    await page.getByRole("button", { name: /^View: / }).click();
    await page.getByRole("menuitemradio", { name: "By stage" }).click();
    await expect(page.getByTestId("crm-groups")).toContainText("Contracted");
    await expect(page.getByTestId("crm-groups")).not.toContainText("No stage");

    // Supplier contacts carry their title as a stage stored in words ("Account manager"); its group filters to it.
    await page.getByRole("button", { name: "Clear all" }).click();
    await input.fill("role:supplier_contact");
    await input.press("Enter");
    await page.getByTestId("crm-groups").getByRole("button", { name: /Account manager/ }).click();
    await expect(page.getByTestId("crm-search")).toContainText('stage:"Account manager"');
    await expect(grid.getByText("Hana Brandt")).toBeVisible({ timeout: LONG });
    await expect(grid.locator('td[data-col="stage"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Clear all" }).click();
    await input.fill("customers");
    await input.press("Enter");
    await expect(page.getByTestId("crm-search")).toContainText("role:customer");
    await expect(roles.filter({ hasText: "Customer" }).first()).toBeVisible({ timeout: LONG });
    await expect(roles.filter({ hasNotText: "Customer" })).toHaveCount(0);
    // Northwind has thousands of customers: the footer says how many are loaded of how many match, and keeps loading.
    const loaded = page.getByTestId("crm-loaded");
    await expect(loaded).toHaveText(/^[\d,]+( of [\d,]+)? records$/, { timeout: LONG });
    await expect
      .poll(async () => Number(((await loaded.textContent()) ?? "").match(/^[\d,]+/)?.[0]?.replace(/,/g, "")), { timeout: LONG })
      .toBeGreaterThan(500);
  });

  test("the typeahead is a combobox: arrow keys move through the hits and Enter opens one", async ({ page }) => {
    const input = page.getByTestId("crm-search-input");
    await input.fill("pennine");
    await expect(page.getByRole("option", { name: /Pennine Contract Cosmetics/ })).toBeVisible({ timeout: LONG });
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await input.press("ArrowDown");
    // Focus stays in the box; the active hit is announced through aria-activedescendant.
    await expect(input).toBeFocused();
    const active = page.getByRole("option", { selected: true });
    await expect(active).toHaveCount(1);
    await expect(input).toHaveAttribute("aria-activedescendant", (await active.getAttribute("id")) ?? "");
    await input.press("Enter");
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
  });

  test("the list pages through every record and says how many there are", async ({ page }) => {
    const summary = page.getByTestId("crm-loaded");
    await expect(summary).toHaveText(/^[\d,]+( of [\d,]+)? records?$/, { timeout: LONG });
    // Pages keep loading until everything is here (or the automatic limit): the count settles on the true total.
    await expect(page.getByTestId("crm-load-more")).toHaveCount(0, { timeout: LONG });
    const text = (await summary.textContent()) ?? "";
    expect(text, "no partial 'N of M' left once everything is loaded").not.toContain(" of ");
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

  test("a new record with an email another record holds is offered the existing one (audit #331)", async ({ page }) => {
    const tag = Date.now().toString(36);
    const email = `dup.${tag}@merge.example`;
    const add = async (name: string) => {
      await page.getByTestId("crm-new").click();
      const dialog = page.getByTestId("new-entity-dialog");
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Email").fill(email);
      await page.getByTestId("new-entity-save").click();
    };
    await add(`Dup First ${tag}`);
    await expect(page.getByTestId("entity-profile")).toBeVisible({ timeout: LONG });
    await openBusiness(page, "crm");
    await add(`Dup Second ${tag}`);
    // Refused with the record that holds the email: open it, or add anyway.
    const notice = page.getByTestId("new-entity-duplicate");
    await expect(notice).toContainText(`Dup First ${tag}`, { timeout: LONG });
    await expect(page.getByTestId("new-entity-open-existing")).toBeVisible();
    await page.getByTestId("new-entity-add-anyway").click();
    await expect(page.getByTestId("profile-header")).toContainText(`Dup Second ${tag}`, { timeout: LONG });
  });
});
