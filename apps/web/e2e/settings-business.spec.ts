import { expect, test } from "@playwright/test";
import { LONG, logoPng, openBusiness } from "./helpers";

/**
 * Settings › Business (BUILD §11.15): the owner uploads a real logo, generates marks and picks one, or goes back to the
 * initials mark; each choice is saved at once and the top bar follows. Northwind is left on the initials mark, as the
 * seed has it. Stack and commands: e2e/README.md.
 */
test.describe("settings › business: the logo", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page, "settings/business");
    await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "business", { timeout: LONG });
    await expect(page.getByTestId("settings-logo")).toBeVisible();
    // Start from the initials mark whatever an earlier run left.
    const clear = page.getByTestId("logo-clear");
    if (await clear.isVisible()) {
      await clear.click();
      await expect(page.getByTestId("kitbar-logo")).toHaveAttribute("data-logo", "initials", { timeout: LONG });
    }
  });

  test("generate four marks, pick one: saved at once, on the top bar, still there after a reload", async ({ page }) => {
    const bar = page.getByTestId("kitbar-logo");
    await expect(bar).toHaveAttribute("data-logo", "initials");
    await expect(bar.locator("path")).toHaveCount(0);
    await page.getByTestId("logo-generate").click();
    const options = page.getByTestId("logo-option");
    await expect(options).toHaveCount(4, { timeout: LONG });
    await expect(page.getByTestId("logo-options")).toContainText("Estimate");
    const picked = await options.nth(2).locator("img").getAttribute("src");
    await options.nth(2).click();
    await expect(bar).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(bar.locator("img")).toHaveAttribute("src", picked!);
    await page.reload();
    await expect(page.getByTestId("kitbar-logo")).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(page.getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "generated", { timeout: LONG });
  });

  test("upload a PNG, take its colours, then go back to the initials mark", async ({ page }) => {
    await page.getByTestId("logo-file").setInputFiles({ name: "northwind.png", mimeType: "image/png", buffer: logoPng() });
    const bar = page.getByTestId("kitbar-logo");
    await expect(bar).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(bar.locator("img")).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
    await expect(page.getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "upload");
    // The colours read from the logo fill the form; saving them is the founder's call.
    await expect(page.getByTestId("logo-colour-suggestion")).toBeVisible({ timeout: LONG });
    const suggested = await page.getByTestId("logo-colour-suggestion").locator("[data-colour]").first().getAttribute("data-colour");
    await page.getByTestId("logo-use-colours").click();
    await expect(page.getByTestId("kit-primary-hex")).toHaveValue(suggested!);
    await page.getByTestId("logo-clear").click();
    await expect(bar).toHaveAttribute("data-logo", "initials", { timeout: LONG });
    await expect(page.getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "initials");
  });
});

/**
 * The business's currency (0025): stored on the business, shown in Settings › Business, and used by every screen's
 * business money (it used to be EUR for any business without a bank account). Northwind keeps its books in pounds; the
 * test switches it to dollars, checks a money screen follows, and puts pounds back.
 */
test.describe("settings › business: the currency", () => {
  test("shows the business's currency, and a change reaches the money on other screens", async ({ page }) => {
    const businessId = await openBusiness(page, "settings/business");
    await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "business", { timeout: LONG });
    const field = page.locator("#biz-currency");
    await expect(field).toContainText("GBP");
    await expect(field).toContainText("British Pound");

    await field.click();
    await page.getByRole("option", { name: /US Dollar/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Business saved")).toBeVisible({ timeout: LONG });
    await page.goto(`/b/${businessId}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy]").filter({ hasText: "MRR" }).first()).toContainText("$", { timeout: LONG });
    await expect(page.locator("[data-trophy]").filter({ hasText: "£" })).toHaveCount(0);

    await page.goto(`/b/${businessId}/settings/business`);
    await expect(page.locator("#biz-currency")).toContainText("USD", { timeout: LONG });
    await page.locator("#biz-currency").click();
    await page.getByRole("option", { name: /British Pound/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Business saved")).toBeVisible({ timeout: LONG });
    await expect(page.locator("#biz-currency")).toContainText("GBP");
  });
});
