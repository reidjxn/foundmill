import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { devApi, LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/**
 * Settings › Preferences (founder, 2026-10-11): the signed-in person chooses how dates and times read, for themselves,
 * in every business. Day first and a 24-hour clock change the top bar, Home's Journey ribbon and the Inbox at once,
 * without a reload; the choice survives a reload (rendered by the server, no hydration warning) and holds in another
 * business. The dev founder is shared by every spec, so the choice found before is put back after. Stack: e2e/README.md.
 */
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

const US_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
const DAY_FIRST_DATE = /^\d{1,2} [A-Z][a-z]{2} \d{4}$/;

type Prefs = { date: string; time: string };

/** Hydration complaints React prints in development (text or attributes that differ between server and browser). */
function watchHydration(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" && /hydrat|did not match|server rendered/i.test(m.text())) seen.push(m.text().slice(0, 300));
  });
  return seen;
}

async function choose(page: Page, name: string) {
  const radio = page.getByRole("radio", { name, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
}

test.describe("settings › preferences: date and time format", () => {
  let before: Prefs | null = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.get("/trpc/founder.preferences.get");
    expect(res.ok(), `founder.preferences.get answered ${res.status()}`).toBe(true);
    before = ((await res.json()) as { result: { data: { json: Prefs } } }).result.data.json;
    // Every run starts from the defaults.
    const reset = await api.post("/trpc/founder.preferences.update", { data: { json: { date: "us", time: "12h" } } });
    expect(reset.ok(), await reset.text()).toBe(true);
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.post("/trpc/founder.preferences.update", { data: { json: before ?? { date: "us", time: "12h" } } });
    expect(res.ok(), await res.text()).toBe(true);
    await api.dispose();
  });

  test("day first and 24-hour: the top bar, Home and the Inbox change at once; a reload and another business keep it", async ({ page }) => {
    const hydration = watchHydration(page);
    await openBusiness(page, "settings/preferences");
    const panel = page.getByTestId("preferences-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("in every business");
    await expect(panel).toContainText("3 min ago");
    await expect(page.getByTestId("preferences-scope")).toHaveText("Just for you");
    await expect(page.getByRole("radio", { name: "US", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: "12-hour", exact: true })).toHaveAttribute("aria-checked", "true");
    const topDate = page.getByTestId("kitbar-date");
    await expect(topDate).toHaveText(US_DATE, { timeout: LONG });

    // The cards show today in each format.
    await expect(page.getByTestId("date-format-day_first")).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}/);
    await expect(page.getByTestId("date-format-iso")).toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("time-format-24h")).toContainText(/\d{2}:\d{2}/);

    // Choose: each choice saves at once with a toast, and the top bar follows without a reload.
    await choose(page, "Day first");
    await expect(page.getByText("Day first dates, 12-hour times", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(topDate).toHaveText(DAY_FIRST_DATE);
    await choose(page, "24-hour");
    await expect(page.getByText("Day first dates, 24-hour times", { exact: true })).toBeVisible({ timeout: LONG });

    // Home: the top bar and the Journey ribbon's Today tag read day first (a client-side move, no reload).
    await page.getByRole("link", { name: "Home", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home`), { timeout: LONG });
    await expect(topDate).toHaveText(DAY_FIRST_DATE);
    const todayTag = page.locator("[data-today-tag]").first();
    await expect(todayTag).toHaveText(/^Today · \d{1,2} [A-Z][a-z]{2}\b/, { timeout: LONG });

    // The Inbox: a note's date in the reading pane and a row's time on hover use the 24-hour, day-first format.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox`);
    const firstRow = page.getByTestId("inbox-list").locator("[data-inbox-row]").first();
    await expect(firstRow).toBeVisible({ timeout: LONG });
    await expect(firstRow.getByTestId("row-time")).toHaveAttribute("title", /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/, { timeout: LONG });
    await firstRow.click();
    await expect(page.getByTestId("item-date-absolute")).toHaveText(/^\d{1,2} [A-Z][a-z]{2}( \d{4})?, \d{2}:\d{2} · $/, { timeout: LONG });
    // Relative times keep their words.
    await expect(page.getByTestId("item-date")).toContainText(/ago|just now|yesterday/);

    // A reload renders it from the server's side too (the cookie), with no hydration warning.
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kitbar-date")).toHaveText(DAY_FIRST_DATE, { timeout: LONG });
    await expect(page.getByTestId("inbox-list").locator("[data-inbox-row]").first().getByTestId("row-time")).toHaveAttribute("title", /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/, { timeout: LONG });

    // Another business: the choice is the person's, so it holds there.
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kitbar-date")).toHaveText(DAY_FIRST_DATE, { timeout: LONG });
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/preferences`);
    await expect(page.getByRole("radio", { name: "Day first", exact: true })).toHaveAttribute("aria-checked", "true", { timeout: LONG });
    await expect(page.getByRole("radio", { name: "24-hour", exact: true })).toHaveAttribute("aria-checked", "true");

    // ISO from here, then back to US: the top bar follows each time.
    await choose(page, "ISO 8601");
    await expect(page.getByTestId("kitbar-date")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    await choose(page, "US");
    await choose(page, "12-hour");
    await expect(page.getByTestId("kitbar-date")).toHaveText(US_DATE);

    expect(hydration, hydration.join("\n")).toEqual([]);
  });

  test("the command palette finds Preferences by what it changes", async ({ page }) => {
    await openBusiness(page);
    await page.getByTestId("kitbar-search").click();
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible({ timeout: LONG });
    await page.getByRole("combobox").fill("24-hour");
    const option = palette.getByRole("option", { name: /^Preferences/ }).first();
    await expect(option).toBeVisible({ timeout: LONG });
    await expect(option).toContainText("Your date and time format, in every business");
    await option.click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/settings/preferences`), { timeout: LONG });
    await expect(page.getByTestId("preferences-panel")).toBeVisible({ timeout: LONG });
  });
});
