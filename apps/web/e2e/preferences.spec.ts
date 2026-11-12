import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { devApi, LONG, NORTHWIND_BUSINESS_ID, openBusiness, settingsScreen, settled, toast } from "./helpers";

/**
 * Settings › Preferences (founder, 2026-10-11): the signed-in person chooses how dates and times read, for themselves,
 * in every business. Day first and a 24-hour clock change the top bar, Home's Journey ribbon and the Inbox at once,
 * without a reload; the choice survives a reload (rendered by the server, no hydration warning) and holds in another
 * business. The dev founder is shared by every spec, so the choice found before is put back after. Stack: e2e/README.md.
 * The tab's own content is looked up through `settingsScreen` (React parks a second copy of a streamed screen outside the
 * shell for a moment, helpers.ts) and its toasts through `toast`.
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
  const radio = settingsScreen(page).getByRole("radio", { name, exact: true });
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
    const screen = settingsScreen(page);
    const panel = screen.getByTestId("preferences-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("in every business");
    await expect(panel).toContainText("3 min ago");
    await expect(screen.getByTestId("preferences-scope")).toHaveText("Just for you");
    await expect(screen.getByRole("radio", { name: "US", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(screen.getByRole("radio", { name: "12-hour", exact: true })).toHaveAttribute("aria-checked", "true");
    const topDate = page.getByTestId("kitbar-date");
    await expect(topDate).toHaveText(US_DATE, { timeout: LONG });

    // The cards show today in each format.
    await expect(screen.getByTestId("date-format-day_first")).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}/);
    await expect(screen.getByTestId("date-format-iso")).toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(screen.getByTestId("time-format-24h")).toContainText(/\d{2}:\d{2}/);

    // Choose: each choice saves at once with a toast, and the top bar follows without a reload.
    await choose(page, "Day first");
    await expect(toast(page, "Day first dates, 12-hour times")).toBeVisible({ timeout: LONG });
    await expect(topDate).toHaveText(DAY_FIRST_DATE);
    await choose(page, "24-hour");
    await expect(toast(page, "Day first dates, 24-hour times")).toBeVisible({ timeout: LONG });

    // Details (the dashboards, through Today's tab bar): the top bar and the Journey ribbon's Today tag read day first (a client-side move, no reload).
    await page.getByRole("link", { name: "Today", exact: true }).first().click();
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home`), { timeout: LONG });
    await expect(topDate).toHaveText(DAY_FIRST_DATE);
    const todayTag = page.locator("[data-today-tag]").first();
    await expect(todayTag).toHaveText(/^Today · \d{1,2} [A-Z][a-z]{2}\b/, { timeout: LONG });

    // The Inbox: a note's date in the reading pane and a row's time on hover use the 24-hour, day-first format.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox`);
    await settled(page);
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
    await settled(page);
    await expect(page.getByTestId("kitbar-date")).toHaveText(DAY_FIRST_DATE, { timeout: LONG });
    await expect(page.getByTestId("inbox-list").locator("[data-inbox-row]").first().getByTestId("row-time")).toHaveAttribute("title", /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/, { timeout: LONG });

    // Another business: the choice is the person's, so it holds there.
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kitbar-date")).toHaveText(DAY_FIRST_DATE, { timeout: LONG });
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/preferences`);
    await settled(page);
    await expect(screen.getByRole("radio", { name: "Day first", exact: true })).toHaveAttribute("aria-checked", "true", { timeout: LONG });
    await expect(screen.getByRole("radio", { name: "24-hour", exact: true })).toHaveAttribute("aria-checked", "true");

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
    const search = page.getByRole("combobox");
    await search.fill("24-hour");
    const option = palette.getByRole("option", { name: /^Preferences/ }).first();
    await expect(option).toBeVisible({ timeout: LONG });
    await expect(option).toContainText("Your date format, guidance, text size and Builder view, in every business");
    // The guided layer's switch and Builder view live here too, so "guidance", "builder view" and "text size" find the same row.
    await search.fill("guidance");
    await expect(palette.getByRole("option", { name: /^Preferences/ }).first()).toBeVisible({ timeout: LONG });
    await search.fill("builder view");
    await expect(palette.getByRole("option", { name: /^Preferences/ }).first()).toBeVisible({ timeout: LONG });
    await search.fill("text size");
    await expect(palette.getByRole("option", { name: /^Preferences/ }).first()).toBeVisible({ timeout: LONG });
    await search.fill("24-hour");
    await expect(option).toBeVisible({ timeout: LONG });
    await option.click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/settings/preferences`), { timeout: LONG });
    await expect(settingsScreen(page).getByTestId("preferences-panel")).toBeVisible({ timeout: LONG });
  });
});

/**
 * Settings › Preferences › Guidance (docs/UX_AUDIT_AND_PLAN.md §6.3, founder, 2026-10-20): the guided layer's one
 * switch, the text size and the two resets. Each saves at once with a toast; the choice survives a reload (the account's
 * row, `founder.preferences.guidance`) and holds in another business. Comfortable text is stamped on the document
 * (`<html data-text="comfortable">`, the tokens' hook). The dev founder is shared by every spec, so what was found before
 * is put back after.
 */
type Guidance = { guidance: "on" | "off"; textSize: "standard" | "comfortable"; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissedAt: string | null };

const GUIDANCE_DEFAULTS: Guidance = { guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null };

test.describe("settings › preferences: guidance", () => {
  let before: Guidance | null = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const res = await api.get("/trpc/founder.preferences.guidance");
    expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
    before = ((await res.json()) as { result: { data: { json: Guidance } } }).result.data.json;
    // Every run starts from the defaults: guided, standard text, nothing seen.
    const reset = await api.post("/trpc/founder.preferences.update", { data: { json: { guidance: "on", textSize: "standard", reset: true } } });
    expect(reset.ok(), await reset.text()).toBe(true);
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const b = before ?? GUIDANCE_DEFAULTS;
    // Marks only ever merge, so the maps are cleared first and what was seen is marked again.
    const put = await api.post("/trpc/founder.preferences.update", { data: { json: { guidance: b.guidance, textSize: b.textSize, reset: true } } });
    expect(put.ok(), await put.text()).toBe(true);
    const marks = {
      ...(Object.keys(b.explainersSeen).length ? { explainersSeen: b.explainersSeen } : {}),
      ...(Object.keys(b.toursDone).length ? { toursDone: b.toursDone } : {}),
      ...(b.checklistDismissedAt ? { checklistDismissed: true } : {}),
    };
    if (Object.keys(marks).length) {
      const again = await api.post("/trpc/founder.preferences.update", { data: { json: marks } });
      expect(again.ok(), await again.text()).toBe(true);
    }
    await api.dispose();
  });

  test("the switch and the text size save at once with a toast, survive a reload and hold in another business", async ({ page }) => {
    const hydration = watchHydration(page);
    await openBusiness(page, "settings/preferences");
    const screen = settingsScreen(page);
    const panel = screen.getByTestId("guidance-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("always show");
    const sw = screen.getByRole("switch", { name: "Explain things as I go" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(screen.getByRole("button", { name: "Standard", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).not.toHaveAttribute("data-text", "comfortable");
    // Nothing to reset yet: both buttons are off.
    await expect(screen.getByTestId("show-checklist-again")).toHaveAttribute("aria-disabled", "true");
    await expect(screen.getByTestId("replay-tour")).toHaveAttribute("aria-disabled", "true");
    // The tip beside the switch says what guidance changes; the reassurance under it shows while guidance is on.
    const tip = screen.getByRole("button", { name: "About what guidance changes" });
    await expect(tip).toBeVisible();
    await tip.hover();
    await expect(page.getByRole("tooltip")).toContainText("Keyboard caps on buttons show only when it is off", { timeout: LONG });
    await expect(screen.getByTestId("guidance-reassurance")).toHaveText("You can switch this any time.");

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(toast(page, "Guidance off")).toBeVisible({ timeout: LONG });
    // Off: the reassurance line goes (tutoring); the tip stays (it says what the switch does).
    await expect(screen.getByTestId("guidance-reassurance")).toHaveCount(0);
    await expect(tip).toBeVisible();

    await screen.getByRole("button", { name: "Comfortable", exact: true }).click();
    await expect(toast(page, "Comfortable text")).toBeVisible({ timeout: LONG });
    await expect(screen.getByRole("button", { name: "Comfortable", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-text", "comfortable");

    // A reload reads the account's row again, with no hydration warning.
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await settled(page);
    await expect(screen.getByRole("switch", { name: "Explain things as I go" })).toHaveAttribute("aria-checked", "false", { timeout: LONG });
    await expect(screen.getByRole("button", { name: "Comfortable", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-text", "comfortable", { timeout: LONG });

    // Another business: the choice is the person's, so it holds there.
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/preferences`);
    await settled(page);
    await expect(screen.getByRole("switch", { name: "Explain things as I go" })).toHaveAttribute("aria-checked", "false", { timeout: LONG });
    await expect(page.locator("html")).toHaveAttribute("data-text", "comfortable", { timeout: LONG });

    // Back to standard and on: the document and the switch follow each time.
    await screen.getByRole("button", { name: "Standard", exact: true }).click();
    await expect(toast(page, "Standard text")).toBeVisible({ timeout: LONG });
    await expect(page.locator("html")).not.toHaveAttribute("data-text", "comfortable");
    await screen.getByRole("switch", { name: "Explain things as I go" }).click();
    await expect(toast(page, "Guidance on")).toBeVisible({ timeout: LONG });
    await expect(screen.getByRole("switch", { name: "Explain things as I go" })).toHaveAttribute("aria-checked", "true");
    await expect(screen.getByTestId("guidance-reassurance")).toBeVisible();

    expect(hydration, hydration.join("\n")).toEqual([]);
  });

  test("the resets wake once something was seen, put it back to the first day, and go quiet again", async ({ page, playwright }) => {
    const api = await devApi(playwright);
    const mark = await api.post("/trpc/founder.preferences.update", { data: { json: { explainersSeen: { home: true }, toursDone: { home: true }, checklistDismissed: true } } });
    expect(mark.ok(), await mark.text()).toBe(true);
    await openBusiness(page, "settings/preferences");
    const screen = settingsScreen(page);
    const checklist = screen.getByTestId("show-checklist-again");
    const tour = screen.getByTestId("replay-tour");
    await expect(checklist).toBeVisible({ timeout: LONG });
    await expect(checklist).not.toHaveAttribute("aria-disabled", "true");
    await expect(tour).not.toHaveAttribute("aria-disabled", "true");

    await checklist.click();
    await expect(toast(page, "Starting over")).toBeVisible({ timeout: LONG });
    await expect(checklist).toHaveAttribute("aria-disabled", "true");
    await expect(tour).toHaveAttribute("aria-disabled", "true");

    // The account agrees: nothing seen, the checklist showing.
    const res = await api.get("/trpc/founder.preferences.guidance");
    expect(res.ok(), await res.text()).toBe(true);
    const after = ((await res.json()) as { result: { data: { json: Guidance } } }).result.data.json;
    expect(after).toMatchObject({ explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });
    await api.dispose();
  });
});

type NotificationPrefs = { email: { decision_waiting: boolean } };

/**
 * Settings › Preferences › Email (packages 1.5 and 5.1): "Something waits for my answer", on by
 * default; it saves at once with a toast, survives a reload, holds in another business, and the account agrees. The
 * dev founder's choice is put back afterwards.
 */
test.describe("settings › preferences: email", () => {
  let before: NotificationPrefs | null = null;
  const read = async (api: Awaited<ReturnType<typeof devApi>>) => {
    const res = await api.get("/trpc/founder.preferences.notifications");
    expect(res.ok(), `founder.preferences.notifications answered ${res.status()}`).toBe(true);
    return ((await res.json()) as { result: { data: { json: NotificationPrefs } } }).result.data.json;
  };

  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    before = await read(api);
    const reset = await api.post("/trpc/founder.preferences.update", { data: { json: { email: { decision_waiting: true } } } });
    expect(reset.ok(), await reset.text()).toBe(true);
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const put = await api.post("/trpc/founder.preferences.update", { data: { json: { email: { decision_waiting: before?.email.decision_waiting ?? true } } } });
    expect(put.ok(), await put.text()).toBe(true);
    await api.dispose();
  });

  test("the switch is on, saves at once with a toast, survives a reload and holds in another business", async ({ page, playwright }) => {
    const hydration = watchHydration(page);
    await openBusiness(page, "settings/preferences");
    const screen = settingsScreen(page);
    const panel = screen.getByTestId("email-notifications-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("To the address you sign in with, never while you are in the app: at most three a day in all and one a day for each project.");
    const sw = screen.getByRole("switch", { name: "Something waits for my answer" });
    await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: LONG });

    await sw.click();
    await expect(toast(page, "Email off")).toBeVisible({ timeout: LONG });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    const api = await devApi(playwright);
    expect((await read(api)).email).toMatchObject({ decision_waiting: false, daily_brief: true });

    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await settled(page);
    await expect(screen.getByRole("switch", { name: "Something waits for my answer" })).toHaveAttribute("aria-checked", "false", { timeout: LONG });

    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/preferences`);
    await settled(page);
    const there = screen.getByRole("switch", { name: "Something waits for my answer" });
    await expect(there).toHaveAttribute("aria-checked", "false", { timeout: LONG });
    await there.click();
    await expect(toast(page, "Email on")).toBeVisible({ timeout: LONG });
    await expect(there).toHaveAttribute("aria-checked", "true");
    expect((await read(api)).email).toMatchObject({ decision_waiting: true });
    await api.dispose();
    expect(hydration, hydration.join("\n")).toEqual([]);
  });
});
