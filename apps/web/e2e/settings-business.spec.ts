import { expect, test } from "@playwright/test";
import { LONG, logoPng, openBusiness, settingsScreen } from "./helpers";

/**
 * Settings › Business (BUILD §11.15): the owner uploads a real logo, generates marks and picks one, or goes back to the
 * initials mark; each choice is saved at once and the top bar follows. Northwind is left on the initials mark, as the
 * seed has it. Stack and commands: e2e/README.md.
 */
test.describe("settings › business: the logo", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page, "settings/business");
    await expect(settingsScreen(page)).toHaveAttribute("data-tab", "business", { timeout: LONG });
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
 * Settings › Mode: the "Spend cap per action" set on Commit is stored on the business and editable here (above it every
 * spend asks first, whatever the mode). The spec leaves Northwind without a cap, as the seed has it.
 */
test.describe("settings › mode: the spend cap per action", () => {
  test("set, kept after a reload, and removed again", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const form = page.getByTestId("spend-cap-form");
    await expect(form).toBeVisible({ timeout: LONG });
    await form.getByLabel("Spend cap per action").fill("300");
    await form.getByRole("button", { name: "Save cap" }).click();
    await expect(page.getByText("Spend cap saved")).toBeVisible({ timeout: LONG });
    await page.reload();
    const field = page.getByTestId("spend-cap-form").getByLabel("Spend cap per action");
    await expect(field).toHaveValue("300", { timeout: LONG });
    // A value that is not a number is refused before anything is sent.
    await field.fill("lots");
    await expect(page.getByTestId("spend-cap-form")).toContainText("Use a number, like 250.");
    await field.fill("");
    await page.getByTestId("spend-cap-form").getByRole("button", { name: "Save cap" }).click();
    await expect(page.getByText("Spend cap removed")).toBeVisible({ timeout: LONG });
  });
});

/**
 * Settings > Mode > Autopilot: off by default, turned on with the switch (the chip says so and Home shows the same
 * state), the limits are validated and kept after a reload, and it is turned off again so the seed stays as it was.
 * Autopilot starts cycles the way Continue does; the spec never waits for one.
 */
test.describe("settings > mode: Autopilot", () => {
  test("off by default; on and off with the switch; limits validated and kept; Home shows the chip", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const section = page.getByTestId("autopilot-section");
    await expect(section).toBeVisible({ timeout: LONG });
    await expect(section.getByTestId("autopilot-chip")).toHaveAttribute("data-autopilot-state", "off");
    await expect(section.getByTestId("autopilot-switch")).toHaveAttribute("aria-checked", "false");

    await section.getByTestId("autopilot-switch").click();
    await expect(page.getByText("Autopilot is on")).toBeVisible({ timeout: LONG });
    await expect(section.getByTestId("autopilot-switch")).toHaveAttribute("aria-checked", "true");
    // On, or waiting for the founder when an Inbox item blocks Continue; never "Off". The next cycle, when shown, is an Estimate.
    await expect(section.getByTestId("autopilot-chip")).not.toHaveAttribute("data-autopilot-state", "off");
    if (await section.locator("[data-autopilot-next]").count()) await expect(section.locator("[data-autopilot-next] [data-provenance='estimate']")).toBeVisible();

    const cycles = section.getByLabel(/Most cycles per day/);
    await cycles.fill("25");
    await expect(section).toContainText("Use a whole number from 1 to 24");
    await expect(section.getByTestId("autopilot-save")).toBeDisabled();
    await cycles.fill("8");
    await section.getByLabel(/Pause after failed or empty cycles/).fill("2");
    await section.getByTestId("autopilot-save").click();
    await expect(page.getByText("Autopilot settings saved")).toBeVisible({ timeout: LONG });
    await page.reload();
    await expect(page.getByTestId("autopilot-section").getByLabel(/Most cycles per day/)).toHaveValue("8", { timeout: LONG });
    await expect(page.getByTestId("autopilot-section").getByLabel(/Pause after failed or empty cycles/)).toHaveValue("2");

    // Home shows the same state in words.
    await openBusiness(page, "home");
    await expect(page.getByTestId("home-autopilot").getByTestId("autopilot-chip")).not.toHaveAttribute("data-autopilot-state", "off", { timeout: LONG });

    // Back to the seed: restore the limits and turn it off.
    await openBusiness(page, "settings/mode");
    const again = page.getByTestId("autopilot-section");
    await again.getByLabel(/Most cycles per day/).fill("6");
    await again.getByLabel(/Pause after failed or empty cycles/).fill("3");
    await again.getByTestId("autopilot-save").click();
    await expect(page.getByText("Autopilot settings saved")).toBeVisible({ timeout: LONG });
    await again.getByTestId("autopilot-switch").click();
    await expect(page.getByText("Autopilot is off")).toBeVisible({ timeout: LONG });
    await expect(again.getByTestId("autopilot-chip")).toHaveAttribute("data-autopilot-state", "off");
  });
});
