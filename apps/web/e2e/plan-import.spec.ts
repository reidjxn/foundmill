import { expect, test, type Page } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Import a plan (founder-only, Product › Vision) on the seeded Northwind Skincare as its owner: choose a Markdown
 * file, read the preview, import it, and find the new section in the outline and the new item on the roadmap. The
 * file holds only a Specification and a Roadmap so Northwind's vision stays as seeded for the other specs; a second
 * run rewrites the same section (the preview then lists it under the sections to rewrite). Stack: e2e/README.md.
 */
const SECTION = "Imported launch plan";
const ITEM = "Partner clinic pilot (imported)";
const PLAN = `# Specification
## ${SECTION}
Launch through **partner clinics** before the online store.

### First steps
- Sign two clinics
- Train their staff on refills

# Roadmap
## Later
### ${ITEM}
Run a pilot with two partner clinics.
Acceptance:
- Two clinics sign the pilot terms
`;

async function openProductTab(page: Page, tab: string): Promise<void> {
  await openBusiness(page);
  const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
  await expect(product, "the seed gives Northwind a Product department").toBeVisible({ timeout: LONG });
  const href = (await product.getAttribute("href"))!;
  await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, `/d/$1/${tab}`));
  await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", `product/${tab}`, { timeout: LONG });
}

test.describe("import a plan", () => {
  test("the owner previews a plan file, imports it, and finds the section and the roadmap item", async ({ page }) => {
    await openProductTab(page, "vision");
    await page.getByTestId("plan-import-open").click();
    const dialog = page.getByTestId("plan-import-dialog");
    await expect(dialog).toBeVisible({ timeout: LONG });
    await expect(dialog.getByTestId("plan-import-submit")).toBeDisabled();

    await dialog.getByTestId("plan-file-input").setInputFiles({ name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from(PLAN) });
    const preview = dialog.getByTestId("plan-preview");
    await expect(preview).toBeVisible({ timeout: LONG });
    await expect(preview).toContainText(SECTION);
    await expect(preview.locator("[data-preview-row='Roadmap items to add']")).toHaveText("Now 0 · Next 0 · Later 1");
    await expect(preview.locator("[data-preview-row='Vision']")).toHaveText("Not in this file");

    await dialog.getByTestId("plan-import-submit").click();
    await expect(dialog).toBeHidden({ timeout: LONG });
    await expect(page.getByText("Plan imported")).toBeVisible({ timeout: LONG });
    await expect(page.locator(`[data-outline-section='${SECTION}']`)).toBeVisible({ timeout: LONG });

    await openProductTab(page, "roadmap");
    await expect(page.locator("[data-roadmap-board] [data-roadmap-item]").filter({ hasText: ITEM }).first()).toBeVisible({ timeout: LONG });
  });
});
