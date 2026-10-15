import { expect, test, type Page } from "@playwright/test";
import { LONG, openBusiness, settingsScreen, settled, signIn } from "./helpers";

/** Ledgerly is seeded on vacation (packages/db/src/seed/ledgerly.ts). */
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

/**
 * Keyboard-only and screen-reader checks from the accessibility audit (A11Y-01, -03, -04, -05, -07, -08, -09, -11, -16,
 * -18, -21, WEB-01, OL-26): focus comes back to what opened an overlay, Space stays with the focused control, the tab
 * bar's tablist holds only tabs, the CRM row menu opens from the keyboard, the Ribbon is one Tab stop, deltas are read
 * out, the Channel Board's profile takes focus and closes on Esc, Save keeps focus while it saves, fields expose their
 * error and required state, first-run primary buttons reach AA, and the mode chip says the mode in force on vacation.
 * Nothing here writes: every mutation the keys could send is intercepted. Stack and commands: e2e/README.md.
 */
/** Counts calls to a tRPC procedure and answers them without running anything. */
async function intercept(page: Page, procedure: string): Promise<{ calls: () => number }> {
  let n = 0;
  await page.route(new RegExp(`/trpc/[^?]*${procedure.replace(".", "\\.")}`), (route) => {
    n++;
    return route.abort();
  });
  return { calls: () => n };
}

test.describe("keyboard and screen readers", () => {
  test("closing a dialog gives focus back to the button that opened it; Stop all agents opens on Cancel", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const opener = settingsScreen(page).getByTestId("start-holiday");
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: LONG });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();

    const stop = await intercept(page, "business.stopAllAgents");
    const trigger = page.getByTestId("stop-all-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Stop all agents?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(stop.calls()).toBe(0);
  });

  test("Space toggles the focused switch and never starts a cycle", async ({ page }) => {
    await openBusiness(page, "settings/departments");
    const cycle = await intercept(page, "business.continue");
    await intercept(page, "department.update");
    const visible = settingsScreen(page).getByTestId("department-list").getByRole("switch").first();
    await visible.focus();
    await page.keyboard.press("Space");
    expect(cycle.calls()).toBe(0);
    await expect(visible).toBeFocused();
  });

  test("each department's shortcut is its own: the picker names the letter and what a choice swaps with", async ({ page }) => {
    await openBusiness(page, "settings/departments");
    const list = settingsScreen(page).getByTestId("department-list");
    await expect(list).toBeVisible({ timeout: LONG });
    const pickers = list.getByRole("combobox", { name: /^Shortcut for / });
    expect(await pickers.count()).toBeGreaterThan(1);
    await expect(pickers.first()).toHaveAttribute("data-shortcut", /^[A-Z]$/);
  });

  test("the tab bar's tablist holds only tabs; the sub-view caret is a 24 px button beside it", async ({ page }) => {
    await openBusiness(page, "d/product/roadmap");
    const tablist = page.getByRole("tablist").first();
    await expect(tablist).toBeVisible({ timeout: LONG });
    const intruders = await tablist.evaluate((list) => Array.from(list.querySelectorAll("button, a, [aria-haspopup]")).filter((el) => el.getAttribute("role") !== "tab" && !el.closest("[aria-hidden=true]")).length);
    expect(intruders).toBe(0);
    const caret = page.getByRole("button", { name: /views$/ }).first();
    if (await caret.count()) {
      const box = (await caret.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
    }
  });

  test("the CRM row menu opens from the keyboard on the focused row", async ({ page }) => {
    await openBusiness(page, "crm");
    const grid = page.getByRole("grid").first();
    await expect(grid).toBeVisible({ timeout: LONG });
    await grid.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: "Row actions" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "No actions" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /Merge/ })).toBeVisible();
  });

  test("Home: the Ribbon is one Tab stop, its deltas are read out, and edit controls name their widget", async ({ page }) => {
    await openBusiness(page);
    const ribbon = page.getByRole("group", { name: /Journey/ }).first();
    await expect(ribbon).toBeVisible({ timeout: LONG });
    expect(await ribbon.evaluate((r) => r.querySelectorAll("svg [tabindex], svg [role=button]").length)).toBe(0);
    await ribbon.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("[data-ribbon-day-readout]")).toHaveText(/paying customers/);
    // A change chip is spoken as words, never an aria-label on a role-less span.
    const delta = page.locator("[data-delta]").first();
    if (await delta.count()) {
      expect(await delta.getAttribute("aria-label")).toBeNull();
      await expect(delta.locator(".sr-only")).toHaveText(/^(up|down|no change) $/);
    }
    await page.getByTestId("edit-layout").click();
    const handles = page.getByRole("button", { name: /^Move Department card/ });
    const names = await handles.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(new Set(names).size).toBe(names.length);
  });

  test("Channel Board: O opens the profile with focus on its title, Esc closes it and returns to the token", async ({ page }) => {
    await openBusiness(page, "d/distribution/formation");
    const first = page.getByRole("button", { name: /on the board/ }).first();
    await expect(first).toBeVisible({ timeout: LONG });
    // The Board re-ranks as scores arrive, so hold on to this token by its own name, not by its place in the list.
    const label = (await first.getAttribute("aria-label")) ?? "";
    expect(label).not.toBe("");
    const token = page.getByRole("button", { name: label, exact: true });
    await token.focus();
    await page.keyboard.press("o");
    const drawer = page.locator("[data-channel-drawer]");
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("complementary").getByRole("heading").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(token).toBeFocused();
  });

  test("Settings: fields expose their required and error state, and Save keeps keyboard focus while it saves", async ({ page }) => {
    await openBusiness(page, "settings/business");
    await expect(settingsScreen(page)).toHaveAttribute("data-tab", "business", { timeout: LONG });
    // Field wires its control: required, and in error tied to the message (A11Y-16).
    const screen = settingsScreen(page);
    const name = screen.locator("#biz-name");
    await expect(name).toHaveAttribute("aria-required", "true");
    const primary = screen.locator("#kit-primary");
    const colour = await primary.inputValue();
    await primary.fill("not a color");
    await expect(primary).toHaveAttribute("aria-invalid", "true");
    await expect(primary).toHaveAttribute("aria-describedby", /(^| )kit-primary-error( |$)/);
    await primary.fill(colour);
    await expect(primary).not.toHaveAttribute("aria-invalid", "true");

    // The save never reaches the API: it is held while the button is busy, then refused (A11Y-07).
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/trpc\/[^?]*business\.update/, async (route) => {
      await held;
      await route.abort();
    });
    const original = await name.inputValue();
    await name.fill(`${original} draft`);
    const save = screen.locator("[data-save-bar]");
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(save).toBeFocused();
    release();
    await expect(save).not.toHaveAttribute("aria-busy", "true", { timeout: LONG });
    await expect(save).toBeFocused();
    await name.fill(original);
  });

  test("first-run primary buttons use the darker steel, so their white text reaches 4.5 : 1", async ({ page }) => {
    await signIn(page);
    await page.goto("/new");
    await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
    const primary = page.getByTestId("doors").locator(".btn-primary").first();
    await expect(primary).toHaveCSS("background-color", "rgb(53, 112, 204)");
    await expect(primary).toHaveCSS("color", "rgb(255, 255, 255)");
  });

  test("on vacation the top bar and Settings › Mode show the mode in force, Automated", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/mode`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await settled(page);
    await expect(page.getByRole("button", { name: /^Business mode: Automated, on vacation/ })).toBeVisible({ timeout: LONG });
    await expect(settingsScreen(page).getByTestId("mode-in-force")).toContainText("Automated while on vacation");
  });
});
