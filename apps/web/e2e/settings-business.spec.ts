import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, logoPng, openBusiness, openSettings, settingsScreen, settled, toast } from "./helpers";

/**
 * Settings › Business (BUILD §11.15): the owner uploads a real logo, generates marks and picks one, or goes back to the
 * initials mark; each choice is saved at once and the top bar follows. Northwind is left on the initials mark, as the
 * seed has it. Stack and commands: e2e/README.md.
 *
 * Locators for a tab's content start at `settingsScreen(page)` (while a page streams, React parks a second copy of the
 * screen outside the shell, see helpers.ts); the top bar is in the shell and is looked up on the page; toasts go through
 * `toast(page, title)` (the viewport, whole title: Radix also announces each toast in a hidden live region).
 */
test.describe("settings › business: the logo", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page, "settings/business");
    await expect(settingsScreen(page)).toHaveAttribute("data-tab", "business", { timeout: LONG });
    await expect(settingsScreen(page).getByTestId("settings-logo")).toBeVisible();
    // Start from the initials mark whatever an earlier run left.
    const clear = settingsScreen(page).getByTestId("logo-clear");
    if (await clear.isVisible()) {
      await clear.click();
      await expect(page.getByTestId("kitbar-logo")).toHaveAttribute("data-logo", "initials", { timeout: LONG });
    }
  });

  test("generate four marks, pick one: saved at once, on the top bar, still there after a reload", async ({ page }) => {
    const screen = settingsScreen(page);
    const bar = page.getByTestId("kitbar-logo");
    await expect(bar).toHaveAttribute("data-logo", "initials");
    await expect(bar.locator("path")).toHaveCount(0);
    await screen.getByTestId("logo-generate").click();
    const options = screen.getByTestId("logo-option");
    await expect(options).toHaveCount(4, { timeout: LONG });
    await expect(screen.getByTestId("logo-options")).toContainText("Estimate");
    const picked = await options.nth(2).locator("img").getAttribute("src");
    await options.nth(2).click();
    await expect(bar).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(bar.locator("img")).toHaveAttribute("src", picked!);
    await page.reload();
    await settled(page);
    await expect(page.getByTestId("kitbar-logo")).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(settingsScreen(page).getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "generated", { timeout: LONG });
  });

  test("upload a PNG, take its colours, then go back to the initials mark", async ({ page }) => {
    const screen = settingsScreen(page);
    await screen.getByTestId("logo-file").setInputFiles({ name: "northwind.png", mimeType: "image/png", buffer: logoPng() });
    const bar = page.getByTestId("kitbar-logo");
    await expect(bar).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(bar.locator("img")).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
    await expect(screen.getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "upload");
    // The colours read from the logo fill the form; saving them is the founder's call.
    await expect(screen.getByTestId("logo-colour-suggestion")).toBeVisible({ timeout: LONG });
    const suggested = await screen.getByTestId("logo-colour-suggestion").locator("[data-colour]").first().getAttribute("data-colour");
    await screen.getByTestId("logo-use-colours").click();
    await expect(screen.getByTestId("kit-primary-hex")).toHaveValue(suggested!);
    await screen.getByTestId("logo-clear").click();
    await expect(bar).toHaveAttribute("data-logo", "initials", { timeout: LONG });
    await expect(screen.getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "initials");
  });
});

test.describe("settings › business: the slug", () => {
  test("a slug another business holds is refused inline as 'That slug is taken', and nothing is saved", async ({ page }) => {
    await openBusiness(page, "settings/business");
    const screen = settingsScreen(page);
    await expect(screen).toHaveAttribute("data-tab", "business", { timeout: LONG });
    const slug = screen.getByTestId("business-slug");
    const original = await slug.inputValue();
    await slug.fill("ledgerly");
    await screen.getByRole("button", { name: "Save changes" }).click();
    await expect(screen.getByText("That slug is taken")).toBeVisible({ timeout: LONG });
    // No raw SQL anywhere, and the Save button waits for a different slug.
    await expect(screen.getByText(/Failed query/)).toHaveCount(0);
    await expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await slug.fill(original);
    await expect(screen.getByText("That slug is taken")).toHaveCount(0);
  });
});

/**
 * Settings › What the team can do: the amount above which a purchase always asks (`spend_cap_minor`, first set on
 * Commit) is stored on the business and editable here: an amount, always ask, or each agent's own limit. The spec leaves
 * Northwind on each agent's own limit, as the seed has it.
 */
test.describe("settings › what the team can do: the amount per purchase", () => {
  const ownLimit = /^Each agent's own limit \(£250 unless you set one\)/;

  test("set, kept after a reload, and back to each agent's own limit", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const screen = settingsScreen(page);
    const form = screen.getByTestId("spend-cap-form");
    await expect(form).toBeVisible({ timeout: LONG });
    // The null answer names the real default, so it never reads as "no limit".
    await expect(form.getByRole("radio", { name: ownLimit })).toHaveAttribute("aria-checked", "true");
    await form.getByLabel("Amount per purchase").fill("300");
    const save = form.getByRole("button", { name: "Save" });
    await save.click();
    await expect(toast(page, "Amount saved")).toBeVisible({ timeout: LONG });
    // Saved, so there is nothing left to save: the button says so without dropping keyboard focus (A11Y-07).
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await expect(save).toBeFocused();
    // Above the agents' default limit an agent still asks at its own: the page says so.
    await expect(form).toContainText("An agent still asks above its own limit when that is lower: £250");
    await page.reload();
    await settled(page);
    const field = screen.getByTestId("spend-cap-form").getByLabel("Amount per purchase");
    await expect(field).toHaveValue("300", { timeout: LONG });
    // A value that is not a number is refused before anything is sent.
    await field.fill("lots");
    await expect(screen.getByTestId("spend-cap-form")).toContainText("Use a number, like 250.");
    await screen.getByTestId("spend-cap-form").getByRole("radio", { name: ownLimit }).click();
    await screen.getByTestId("spend-cap-form").getByRole("button", { name: "Save" }).click();
    await expect(toast(page, "Each agent's own limit applies")).toBeVisible({ timeout: LONG });
  });

  test("an amount below an agent's own ask line is the line the agent's profile shows", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const form = settingsScreen(page).getByTestId("spend-cap-form");
    await expect(form).toBeVisible({ timeout: LONG });
    await form.getByLabel("Amount per purchase").fill("50");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(toast(page, "Amount saved")).toBeVisible({ timeout: LONG });
    try {
      // The Chief of Staff's template asks above 250, so the founder's 50 is the line the gateway applies.
      await openBusiness(page, "d/team/squad");
      const chief = page.locator("[data-testid=module-screen] a[href*='/agents/']").filter({ hasText: "Chief of Staff" }).first();
      await expect(chief).toBeVisible({ timeout: LONG });
      await page.goto((await chief.getAttribute("href"))!);
      await settled(page);
      const line = page.getByTestId("contract-panel").getByTestId("asks-above-business-cap");
      await expect(line).toContainText("50.00", { timeout: LONG });
      await expect(line).toContainText("business cap");
    } finally {
      await openBusiness(page, "settings/mode");
      const again = settingsScreen(page).getByTestId("spend-cap-form");
      await expect(again).toBeVisible({ timeout: LONG });
      await again.getByRole("radio", { name: ownLimit }).click();
      await again.getByRole("button", { name: "Save" }).click();
      await expect(toast(page, "Each agent's own limit applies")).toBeVisible({ timeout: LONG });
    }
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
    const screen = settingsScreen(page);
    await expect(screen).toHaveAttribute("data-tab", "business", { timeout: LONG });
    const field = screen.locator("#biz-currency");
    await expect(field).toContainText("GBP");
    await expect(field).toContainText("British Pound");

    await field.click();
    // The options list is a popover outside the shell.
    await page.getByRole("option", { name: /US Dollar/ }).click();
    await screen.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Business saved")).toBeVisible({ timeout: LONG });
    await page.goto(`/b/${businessId}/milestones`);
    await settled(page);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy]").filter({ hasText: "MRR" }).first()).toContainText("$", { timeout: LONG });
    await expect(page.locator("[data-trophy]").filter({ hasText: "£" })).toHaveCount(0);

    const again = await openSettings(page, "business", businessId);
    await expect(again.locator("#biz-currency")).toContainText("USD", { timeout: LONG });
    await again.locator("#biz-currency").click();
    await page.getByRole("option", { name: /British Pound/ }).click();
    await again.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Business saved")).toBeVisible({ timeout: LONG });
    await expect(again.locator("#biz-currency")).toContainText("GBP");
  });
});

/** The day key of `zone` now, as the app formats a short US date ("Oct 13"). */
function shortDayIn(zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date());
}

/**
 * Settings › Business: the time zone (audit #196). Home's today, the Journey's days and the top bar's date follow the
 * business's zone, not UTC and not each viewer's clock. Kiritimati (UTC+14) makes the difference visible at any hour
 * for a UTC runner. The spec puts Northwind back on the zone it had.
 */
test.describe("settings › business: the time zone", () => {
  test("picked once, the top bar and the Journey's Today both name the business's day", async ({ page }) => {
    await openBusiness(page, "settings/business");
    const field = settingsScreen(page).getByLabel("Time zone");
    await expect(field).toBeVisible({ timeout: LONG });
    const before = ((await field.textContent()) ?? "").trim();
    await field.click();
    await page.getByRole("option", { name: "Pacific/Kiritimati", exact: true }).click();
    await expect(toast(page, "Time zone saved")).toBeVisible({ timeout: LONG });
    await expect(field).toHaveText("Pacific/Kiritimati");
    const day = shortDayIn("Pacific/Kiritimati");
    await expect(page.getByTestId("kitbar-date")).toContainText(day, { timeout: LONG });
    // The dashboards (Details) through Today's tab bar: a client-side move.
    await page.getByRole("link", { name: "Today", exact: true }).first().click();
    await page.getByRole("tab", { name: "Details" }).click();
    await settled(page);
    await expect(page.locator("[data-today-tag]").first()).toHaveText(new RegExp(`^Today · ${day}\\b`), { timeout: LONG });
    await expect(page.getByTestId("kitbar-date")).toContainText(day);

    // Back to the zone Northwind had (UTC when it had none yet).
    const screen = await openSettings(page, "business");
    await screen.getByLabel("Time zone").click();
    const restore = /^[A-Z][A-Za-z]+(\/[A-Za-z_ -]+)+$|^UTC$/.test(before) ? before : "UTC";
    await page.getByRole("option", { name: restore, exact: true }).click();
    await expect(screen.getByLabel("Time zone")).toHaveText(restore, { timeout: LONG });
  });
});

/**
 * Settings › Your words (BUILD §11.13, AC-11.13.6, audit #206; "Glossary" until UX plan §7.17, the slug stays
 * `glossary`): a renamed noun reaches Home's captions and the Inbox tabs, not only model prompts. The spec removes its
 * rows again so Northwind keeps the product's words.
 */
test.describe("settings › your words: the business's own words", () => {
  async function saveGlossary(page: Page, rows: [string, string][]): Promise<void> {
    // Scoped to the shell: while the page streams, React parks a second copy of the screen outside it (helpers.ts).
    const screen = await openSettings(page, "glossary");
    const list = screen.getByTestId("glossary-rows");
    await expect(list).toBeVisible({ timeout: LONG });
    // Clear every row, then add the wanted ones.
    while (await list.getByRole("button", { name: "Remove term" }).count()) await list.getByRole("button", { name: "Remove term" }).first().click();
    for (const [term, word] of rows) {
      await list.getByRole("button", { name: "Add term" }).click();
      // The default word is an input with a list of the product's nouns (a combobox to the accessibility tree).
      await list.getByLabel("Default word").last().fill(term);
      await list.getByRole("textbox", { name: "Your word" }).last().fill(word);
    }
    const save = screen.getByRole("button", { name: "Save changes" });
    if (await save.isEnabled()) {
      await save.click();
      await expect(toast(page, "Your words saved")).toBeVisible({ timeout: LONG });
    }
  }

  test("customer → client renames Home's captions and the Inbox's Customers tab", async ({ page }) => {
    await openBusiness(page);
    try {
      await saveGlossary(page, [["customer", "client"]]);
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
      await settled(page);
      const strip = page.getByRole("region", { name: "Status" });
      await expect(strip.getByText("Clients this week")).toBeVisible({ timeout: LONG });
      await expect(strip.getByText("Customers this week")).toHaveCount(0);
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox`);
      await settled(page);
      await expect(page.getByRole("link", { name: /^Clients\b/ }).or(page.getByRole("tab", { name: /^Clients\b/ })).first()).toBeVisible({ timeout: LONG });
    } finally {
      await saveGlossary(page, []);
    }
  });
});

/**
 * Settings > What the team can do > Autopilot: off by default, turned on with the switch (the chip says so and Home shows the same
 * state), the limits are validated and kept after a reload, and it is turned off again so the seed stays as it was.
 * Autopilot starts cycles the way Continue does; the spec never waits for one.
 *
 * Its toasts are looked up with `toast` (the viewport, whole title): the text "Autopilot is off" is also in Radix's
 * hidden announcer for a second ("Notification Autopilot is off"), which made a substring match resolve to two elements.
 */
test.describe("settings > what the team can do: Autopilot", () => {
  // A failed run can stop with Autopilot on or the limits changed; a retry would then meet "waiting" instead of "off".
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    await openBusiness(page, "settings/mode");
    const section = settingsScreen(page).getByTestId("autopilot-section");
    await expect(section).toBeVisible({ timeout: LONG });
    await section.getByLabel(/Most cycles per day/).fill("6");
    await section.getByLabel(/Pause after failed or empty cycles/).fill("3");
    const save = section.getByTestId("autopilot-save");
    if (await save.isEnabled()) {
      await save.click();
      await expect(toast(page, "Autopilot settings saved")).toBeVisible({ timeout: LONG });
    }
    const toggle = section.getByTestId("autopilot-switch");
    if ((await toggle.getAttribute("aria-checked")) === "true") {
      await toggle.click();
      await expect(toast(page, "Autopilot is off")).toBeVisible({ timeout: LONG });
    }
    await expect(section.getByTestId("autopilot-chip")).toHaveAttribute("data-autopilot-state", "off", { timeout: LONG });
  });

  test("off by default; on and off with the switch; limits validated and kept; Home shows the chip", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const section = settingsScreen(page).getByTestId("autopilot-section");
    await expect(section).toBeVisible({ timeout: LONG });
    await expect(section.getByTestId("autopilot-chip")).toHaveAttribute("data-autopilot-state", "off");
    await expect(section.getByTestId("autopilot-switch")).toHaveAttribute("aria-checked", "false");

    await section.getByTestId("autopilot-switch").click();
    await expect(toast(page, "Autopilot is on")).toBeVisible({ timeout: LONG });
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
    await expect(toast(page, "Autopilot settings saved")).toBeVisible({ timeout: LONG });
    await page.reload();
    await settled(page);
    const reloaded = settingsScreen(page).getByTestId("autopilot-section");
    await expect(reloaded.getByLabel(/Most cycles per day/)).toHaveValue("8", { timeout: LONG });
    await expect(reloaded.getByLabel(/Pause after failed or empty cycles/)).toHaveValue("2");

    // Home shows the same state in words.
    await openBusiness(page, "home");
    await expect(page.getByTestId("home-autopilot").getByTestId("autopilot-chip")).not.toHaveAttribute("data-autopilot-state", "off", { timeout: LONG });

    // Back to the seed: restore the limits and turn it off.
    await openBusiness(page, "settings/mode");
    const again = settingsScreen(page).getByTestId("autopilot-section");
    await again.getByLabel(/Most cycles per day/).fill("6");
    await again.getByLabel(/Pause after failed or empty cycles/).fill("3");
    await again.getByTestId("autopilot-save").click();
    await expect(toast(page, "Autopilot settings saved")).toBeVisible({ timeout: LONG });
    await again.getByTestId("autopilot-switch").click();
    await expect(toast(page, "Autopilot is off")).toBeVisible({ timeout: LONG });
    await expect(again.getByTestId("autopilot-chip")).toHaveAttribute("data-autopilot-state", "off");
  });
});
