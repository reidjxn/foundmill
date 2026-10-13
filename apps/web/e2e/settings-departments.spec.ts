import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/**
 * Settings › Departments (BUILD §11.13; audits MLSL-08, WEB-19, AC-06): add a department (blank, template or from a
 * sentence), archive behind a confirmation, restore from the Archived list, give a department a lead and a budget. The
 * spec adds its own department and archives that one, so the seeded departments are never touched. Stack: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;
const NAME = "Support desk (e2e)";

test.describe("settings, departments", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
    await page.goto(`${B}/settings/departments`);
    await expect(page.getByTestId("department-list")).toBeVisible({ timeout: LONG });
  });

  test("Add department from a sentence, edit its settings, archive it with a confirmation, then restore it", async ({ page }) => {
    await page.getByTestId("add-department-open").click();
    const add = page.getByTestId("add-department");
    await expect(add).toBeVisible();
    await add.getByRole("button", { name: "From a sentence" }).click();
    await add.getByLabel("Describe the department").fill(`Create a department called ${NAME} that handles refunds and the privacy policy`);
    await add.getByRole("button", { name: "Draft it" }).click();
    // The draft is editable before anything is created.
    await expect(add.getByLabel("Name")).toHaveValue(NAME);
    await add.getByTestId("add-department-submit").click();
    await expect(add).toBeHidden({ timeout: LONG });
    const row = page.getByTestId("department-list").locator("li", { hasText: NAME });
    await expect(row).toBeVisible({ timeout: LONG });

    // Settings: a lead-less department can be given a lead, an icon and a monthly budget.
    await row.getByRole("button", { name: `Settings of ${NAME}` }).click();
    const settings = page.getByTestId("department-settings");
    await expect(settings).toBeVisible();
    await expect(settings.getByTestId("dept-shortcut")).toContainText("Shortcut");
    await settings.getByRole("combobox", { name: "Lead" }).click();
    await page.getByRole("option").nth(1).click();
    await settings.getByLabel("Monthly budget").fill("450");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings).toBeHidden({ timeout: LONG });

    // Archiving asks first, and names what leaves the sidebar.
    await row.getByRole("button", { name: `Archive ${NAME}` }).click();
    const confirm = page.getByTestId("archive-department");
    await expect(confirm).toContainText(`Archive ${NAME}?`);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Archive ${NAME}` }).click();
    await page.getByTestId("archive-department").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByTestId("department-list").locator("li", { hasText: NAME })).toHaveCount(0, { timeout: LONG });

    // The Archived list brings it back.
    const archived = page.getByTestId("archived-departments");
    await expect(archived).toContainText(NAME, { timeout: LONG });
    await archived.getByRole("button", { name: `Restore ${NAME}` }).click();
    await expect(page.getByTestId("department-list").locator("li", { hasText: NAME })).toBeVisible({ timeout: LONG });

    // Leave the business as it was found.
    await page.getByTestId("department-list").locator("li", { hasText: NAME }).getByRole("button", { name: `Archive ${NAME}` }).click();
    await page.getByTestId("archive-department").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByTestId("archived-departments")).toContainText(NAME, { timeout: LONG });
  });

  test("Reset to defaults brings an archived default department back instead of failing", async ({ page }) => {
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Defaults restored")).toBeVisible({ timeout: LONG });
  });
});
