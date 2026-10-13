import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, settingsScreen } from "./helpers";

/**
 * Settings in plain words (the 2027 screen pass): no stored identifiers, developer notes or plural slips reach the
 * founder, and the business's money is shown in its own currency. Read-only: nothing here saves a setting.
 * Stack and commands: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;

test.describe("settings, plain words", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("Members: the account id is one short line, roles are words, no developer notes", async ({ page }) => {
    await page.goto(`${B}/settings/members`);
    const list = page.getByTestId("member-list");
    await expect(list).toBeVisible({ timeout: LONG });
    await expect(list).toContainText(/Account [0-9a-f]{8}…[0-9a-f]{4}/);
    await expect(settingsScreen(page)).not.toContainText(/auth build|owner:|admin:/);
    await expect(list.getByRole("combobox").first()).toContainText(/^(Owner|Admin|Member|Viewer|Advisor)$/);
    // The founder's own row reads as a name with a "You" chip, never "You You".
    await expect(list).not.toContainText(/\bYou\s*You\b/);
  });

  test("Mode: the choice is named in words, with no notes about what comes later", async ({ page }) => {
    await page.goto(`${B}/settings/mode`);
    const screen = settingsScreen(page);
    await expect(page.getByTestId("switch-game-mode")).toBeVisible({ timeout: LONG });
    await expect(screen).toContainText("Personal or live");
    await expect(screen).not.toContainText(/Game mode/);
    await page.getByTestId("switch-game-mode").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/come later|for now this records/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("Billing: correct plurals, whole numbers in the usage tables, credits and model costs in US dollars", async ({ page }) => {
    await page.goto(`${B}/settings/billing`);
    const screen = settingsScreen(page);
    await expect(screen.locator("[data-tier]").first()).toBeVisible({ timeout: LONG });
    await expect(screen).not.toContainText(/\b1 (businesses|seats|agents)\b/);
    await expect(screen.locator("[data-tier=free]")).toContainText("1 business");
    await expect(screen.locator("[data-tier=free]")).toContainText("$5.00 of model credits a month");
    // Northwind keeps its books in pounds, but credits and metered model costs are US dollars, never relabeled.
    await expect(page.getByTestId("credits-balance")).toContainText("$");
    await expect(page.getByTestId("spent-this-month")).toContainText("$");
    await expect(page.getByTestId("spent-this-month")).not.toContainText(/^£/);
    await expect(page.getByRole("combobox", { name: "Top-up amount" })).toContainText("$");
    const usage = page.getByRole("table", { name: "Usage by agent" });
    if (await usage.count()) {
      // Numbers never truncate: every numeric cell shows its whole text.
      const cut = await usage.locator("td").evaluateAll((tds) => tds.filter((td) => td.scrollWidth > td.clientWidth + 1).length);
      expect(cut).toBe(0);
      await expect(usage).not.toContainText("€");
      await expect(usage).not.toContainText("£");
    }
  });

  test("Integrations: how each connector signs in, in words; no phases or stored kinds", async ({ page }) => {
    await page.goto(`${B}/settings/integrations`);
    const list = page.getByTestId("connector-list");
    await expect(list).toBeVisible({ timeout: LONG });
    await expect(list).not.toContainText(/api_key|oauth\b|phase \d/);
    await expect(list).toContainText(/API key|Sign in with the vendor|Install the app|No sign-in needed/);
  });

  test("Integrations: back from a vendor's consent page, the founder finishes or is told why nothing connected (#225)", async ({ page }) => {
    // The vendor's redirect lands on /integrations/oauth/callback, which sends the founder to the business the signed
    // state names (the api checks the signature when the founder finishes; nothing is connected on the way).
    const state = `${Buffer.from(JSON.stringify({ b: NORTHWIND_BUSINESS_ID, c: "gmail", u: "x", exp: 1, n: "n" })).toString("base64url")}.sig`;
    await page.goto(`/integrations/oauth/callback?state=${encodeURIComponent(state)}&error=access_denied`);
    await expect(page).toHaveURL(new RegExp(`${B}/settings/integrations\\?oauth_connector=gmail&oauth_error=access_denied`), { timeout: LONG });
    const refused = page.getByTestId("oauth-finish");
    await expect(refused).toContainText("You did not allow access on Gmail's page, so nothing was connected.", { timeout: LONG });
    await refused.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("oauth-finish")).toHaveCount(0);
    await expect(page).not.toHaveURL(/oauth_/);

    // With a code and the state, one button finishes it (not pressed here: this spec saves nothing).
    await page.goto(`${B}/settings/integrations?oauth_connector=gmail&oauth_code=4%2F0Adeu5&oauth_state=${encodeURIComponent(state)}`);
    await expect(page.getByTestId("oauth-finish").getByRole("button", { name: "Connect Gmail" })).toBeVisible({ timeout: LONG });
  });

  test("Glossary and Departments: no retired default words, modules named in words", async ({ page }) => {
    await page.goto(`${B}/settings/glossary`);
    await expect(page.getByTestId("glossary-rows")).toBeVisible({ timeout: LONG });
    const terms = await page.getByRole("textbox", { name: "Default word" }).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(terms.filter((t) => /^(squad|club|crest|shout)$/i.test(t))).toEqual([]);
    await page.goto(`${B}/settings/departments`);
    await expect(page.getByTestId("department-list")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("department-list")).not.toContainText(/ · (product|development|distribution|finance|team|legal)\b/);
  });
});
