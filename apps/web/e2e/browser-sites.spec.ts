import { expect, test } from "@playwright/test";
import { LONG, openBusiness, openSettings } from "./helpers";

/**
 * Settings › Integrations › "Add a website the team can work in" (hosted browser, founder, Nov 22, 2026) on the mock
 * stack: the plain words before the first site, the simulated sign-in that Done finishes, the row that then reads
 * "Signed in to <site>", and Disconnect. The live view, Take over and Hand back, and the hard-gate note need a running
 * browser session or a queued hard stop, which the mock stack does not seed: they are covered by the component tests
 * (packages/dugout browser.test.tsx, packages/modules browser-sessions.test.tsx) and their stories.
 * Stack and commands: e2e/README.md.
 */
test.describe("websites the team can work in", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
  });

  test("connect in the simulated sign-in, read the plain words first, then disconnect", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const section = screen.getByTestId("browser-sites-section");
    await expect(section).toBeVisible({ timeout: LONG });
    await expect(section.getByRole("heading", { name: "Add a website the team can work in" })).toBeVisible();
    await expect(section.getByTestId("browser-never")).toContainText("Banks, brokerages, government and identity sites, health records and password managers are never offered.");
    // The sites are listed here and nowhere else.
    await expect(screen.getByTestId("connector-list")).not.toContainText("(website)");

    const row = section.locator("[data-browser-site]").first();
    const name = (await row.locator("span.text-body-strong").first().innerText()).trim();
    await row.getByRole("button", { name: "Connect" }).click();

    const dialog = page.getByTestId("browser-connect-dialog");
    await expect(dialog.getByTestId("browser-connect-intro")).toHaveText("The team will work in this account as you. You can watch and stop it. It will ask before it sends, posts, buys or agrees to anything. Some sites do not allow this, and those are not offered. You can disconnect at any time, and the saved sign-in is deleted.");
    await dialog.getByRole("button", { name: "Continue" }).click();

    // The mock opens no page: a plain panel says the sign-in is simulated, and Done finishes it.
    await expect(dialog.getByTestId("browser-live-view-simulated")).toContainText("simulated sign-in");
    await expect(dialog.getByTestId("browser-live-view")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText(`Signed in to ${name}`, { timeout: LONG });
    await expect(row).toContainText("Disconnect deletes the saved sign-in.");

    // Put the seed back as it was.
    await row.getByRole("button", { name: `Disconnect ${name}` }).click();
    await expect(row.getByRole("button", { name: "Connect" })).toBeVisible({ timeout: LONG });
  });

  test("Cancel leaves nothing connected", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const section = screen.getByTestId("browser-sites-section");
    await expect(section).toBeVisible({ timeout: LONG });
    const row = section.locator("[data-browser-site]").first();
    await row.getByRole("button", { name: "Connect" }).click();
    const dialog = page.getByTestId("browser-connect-dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByTestId("browser-live-view-simulated")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("button", { name: "Connect" })).toBeVisible();
  });
});
