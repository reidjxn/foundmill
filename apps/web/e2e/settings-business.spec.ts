import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, logoPng, openBusiness, settingsScreen } from "./helpers";

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
    const field = page.getByLabel("Time zone");
    await expect(field).toBeVisible({ timeout: LONG });
    const before = ((await field.textContent()) ?? "").trim();
    await field.click();
    await page.getByRole("option", { name: "Pacific/Kiritimati", exact: true }).click();
    await expect(page.getByText("Time zone saved")).toBeVisible({ timeout: LONG });
    await expect(field).toHaveText("Pacific/Kiritimati");
    const day = shortDayIn("Pacific/Kiritimati");
    await expect(page.getByTestId("kitbar-date")).toContainText(day, { timeout: LONG });
    await page.getByRole("link", { name: "Home", exact: true }).first().click();
    await expect(page.locator("[data-today-tag]").first()).toHaveText(new RegExp(`^Today · ${day}\\b`), { timeout: LONG });
    await expect(page.getByTestId("kitbar-date")).toContainText(day);

    // Back to the zone Northwind had (UTC when it had none yet).
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/settings/business`);
    await page.getByLabel("Time zone").click();
    const restore = /^[A-Z][A-Za-z]+(\/[A-Za-z_ -]+)+$|^UTC$/.test(before) ? before : "UTC";
    await page.getByRole("option", { name: restore, exact: true }).click();
    await expect(page.getByLabel("Time zone")).toHaveText(restore, { timeout: LONG });
  });
});

/**
 * Settings › Glossary (BUILD §11.13, AC-11.13.6, audit #206): a renamed noun reaches Home's captions and the Inbox tabs,
 * not only model prompts. The spec removes its rows again so Northwind keeps the product's words.
 */
test.describe("settings › glossary: the business's own words", () => {
  async function saveGlossary(page: Page, rows: [string, string][]): Promise<void> {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/settings/glossary`);
    const list = page.getByTestId("glossary-rows");
    await expect(list).toBeVisible({ timeout: LONG });
    // Clear every row, then add the wanted ones.
    while (await list.getByRole("button", { name: "Remove term" }).count()) await list.getByRole("button", { name: "Remove term" }).first().click();
    for (const [term, word] of rows) {
      await list.getByRole("button", { name: "Add term" }).click();
      await list.getByRole("textbox", { name: "Default word" }).last().fill(term);
      await list.getByRole("textbox", { name: "Your word" }).last().fill(word);
    }
    const save = page.getByRole("button", { name: "Save changes" });
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByText("Glossary saved")).toBeVisible({ timeout: LONG });
    }
  }

  test("customer → client renames Home's captions and the Inbox's Customers tab", async ({ page }) => {
    await openBusiness(page);
    try {
      await saveGlossary(page, [["customer", "client"]]);
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
      const strip = page.getByRole("region", { name: "Status" });
      await expect(strip.getByText("Clients this week")).toBeVisible({ timeout: LONG });
      await expect(strip.getByText("Customers this week")).toHaveCount(0);
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox`);
      await expect(page.getByRole("link", { name: /^Clients\b/ }).or(page.getByRole("tab", { name: /^Clients\b/ })).first()).toBeVisible({ timeout: LONG });
    } finally {
      await saveGlossary(page, []);
    }
  });
});
