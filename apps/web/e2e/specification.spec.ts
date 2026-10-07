import { expect, test, type Page } from "@playwright/test";

/**
 * Specification tab with the host's spec editor (BUILD §11.5; the Tiptap editor apps/web hands to @foundmill/modules
 * through ModuleEnv). The local stack runs without a collab server (NEXT_PUBLIC_COLLAB_URL unset, e2e/README.md), so
 * the editor opens in local mode: status "Local edits", ⌘/Ctrl+S saves the whole block through product.spec.editBlock.
 */
async function openSpecification(page: Page): Promise<string | null> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1] ?? null;
  if (!bid) return null;
  // The product department's slug comes from the seed; the sidebar lists departments in the founder's order.
  const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
  if ((await product.count()) === 0) return null;
  const href = await product.getAttribute("href");
  if (!href) return null;
  await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/specification"));
  return bid;
}

test.describe("specification editor", () => {
  test("opens a block in the host editor; without a collab server it edits locally and saves the block", async ({ page }) => {
    const bid = await openSpecification(page);
    test.skip(!bid, "no product department for the dev user");
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "product/specification");
    const firstBlock = page.locator("[data-outline-block]").first();
    test.skip((await firstBlock.count()) === 0, "no spec blocks seeded");
    await firstBlock.click();
    const editor = page.locator("[data-spec-editor-status]");
    await expect(editor).toHaveAttribute("data-spec-editor-status", "local");
    const surface = page.locator("[data-spec-editor]");
    await expect(surface).toHaveAttribute("data-spec-editor", "local");
    await expect(page.getByTestId("spec-editor-save")).toBeDisabled();
    await surface.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Edited in the e2e run.");
    await expect(page.getByTestId("spec-editor-save")).toBeEnabled();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("spec-editor-save")).toBeDisabled({ timeout: 10_000 });
    await page.reload();
    await page.locator("[data-outline-block]").first().click();
    await expect(page.locator("[data-spec-editor]")).toContainText("Edited in the e2e run.");
  });
});
