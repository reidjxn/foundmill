import { expect, test } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Specification tab with the host's spec editor (BUILD §11.5; the Tiptap editor apps/web hands to @foundmill/modules
 * through ModuleEnv). The local stack runs without a collab server (NEXT_PUBLIC_COLLAB_URL unset, e2e/README.md), so
 * the editor opens in local mode (status "Editing", no developer copy), ⌘/Ctrl+S saves the whole block through
 * product.spec.editBlock.
 */
test.describe("specification editor", () => {
  test("opens a block in the host editor; without a collab server it edits locally and saves the block", async ({ page }) => {
    await openBusiness(page);
    // The product department's slug comes from the seed; the sidebar lists departments in the founder's order.
    const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
    await expect(product, "the seed gives Northwind a Product department").toBeVisible({ timeout: LONG });
    const href = (await product.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/specification"));
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "product/specification", { timeout: LONG });
    const firstBlock = page.locator("[data-outline-block]").first();
    await expect(firstBlock, "the seed gives Northwind specification blocks").toBeVisible({ timeout: LONG });
    await firstBlock.click();
    const editor = page.locator("[data-spec-editor-status]");
    await expect(editor).toHaveAttribute("data-spec-editor-status", "local", { timeout: LONG });
    const surface = page.locator("[data-spec-editor]");
    await expect(surface).toHaveAttribute("data-spec-editor", "local");
    await expect(page.getByTestId("spec-editor-save")).toBeDisabled();
    // Founder copy only: no "collab server" and no internal document names.
    await expect(page.getByTestId("module-screen")).not.toContainText(/collab server|spec:[0-9a-f]{8}/i);
    // Outline items wrap to two lines rather than being cut to a stub.
    await expect(firstBlock.locator("span.line-clamp-2")).toHaveCount(1);
    const marker = `Edited in the e2e run ${Date.now().toString(36)}.`;
    await surface.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${marker}`);
    await expect(page.getByTestId("spec-editor-save")).toBeEnabled();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("spec-editor-save")).toBeDisabled({ timeout: LONG });
    await page.reload();
    await page.locator("[data-outline-block]").first().click();
    await expect(page.locator("[data-spec-editor]")).toContainText(marker, { timeout: LONG });
  });
});
