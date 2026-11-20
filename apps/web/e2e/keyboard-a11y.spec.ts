import { expect, test, type Page } from "@playwright/test";
import { LONG, PLAN_NOTE, commitThrowaway, dismissCoachmarks, inboxRow, openBusiness, setKeyboardShortcuts, settingsScreen, settled, signIn } from "./helpers";

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

  test("Space toggles the focused switch and never starts a round of work", async ({ page }) => {
    await openBusiness(page, "settings/departments");
    const cycle = await intercept(page, "business.continue");
    await intercept(page, "department.update");
    const visible = settingsScreen(page).getByTestId("department-list").getByRole("switch").first();
    await visible.focus();
    await page.keyboard.press("Space");
    expect(cycle.calls()).toBe(0);
    await expect(visible).toBeFocused();
  });

  test("the G chords follow the areas: the sidebar names them and the help overlay lists them, with no department letters", async ({ page }) => {
    await openBusiness(page, "settings/departments");
    const list = settingsScreen(page).getByTestId("department-list");
    await expect(list).toBeVisible({ timeout: LONG });
    await expect(list.getByRole("combobox", { name: /^Shortcut for / })).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Primary" });
    const chords = await nav.locator("[data-sidebar-item^='area-']").evaluateAll((els) => els.map((el) => el.getAttribute("aria-keyshortcuts")));
    expect(chords).toEqual(["G P", "G C", "G M", "G R", "G T"]);
    await nav.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const help = page.getByTestId("keyboard-help");
    for (const label of ["Go to Today", "Go to Needs you", "Go to Plan", "Go to Customers", "Go to Money", "Go to Product", "Go to Team"]) await expect(help).toContainText(label);
    await expect(help).not.toContainText("Go to Formulation Lab");
    await page.keyboard.press("Escape");
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
    // Keyboard only: the sign-in click left the mouse mid-screen, and when the profile opens the board shifts under it,
    // so a token's hover card could open by pointer and rightly take the first Esc (WCAG 1.4.13). Park it off the board.
    await page.mouse.move(0, 0);
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

  test("on vacation the top bar and Settings › What the team can do say the team decides on its own", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/mode`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await settled(page);
    const chip = page.getByRole("button", { name: /^What the team can do: decides alone, .*, on vacation/ });
    await expect(chip).toBeVisible({ timeout: LONG });
    await expect(chip).toHaveAttribute("data-mode", "automated");
    // The whole phrase and its short form are separate spans the top bar steps between (KitBarFit).
    await expect(chip.locator("[data-chip-full]")).toHaveText(/^Decides alone, asks /);
    await expect(settingsScreen(page).getByTestId("mode-in-force")).toContainText("On vacation: the team decides on its own");
  });

  test("the sidebar's \"?\" cap is a named button that opens the keyboard shortcuts and gives focus back on Esc (B15)", async ({ page }) => {
    await openBusiness(page);
    const cap = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Keyboard shortcuts" });
    await expect(cap).toHaveAttribute("aria-keyshortcuts", "?");
    await cap.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("keyboard-help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("keyboard-help")).toHaveCount(0);
    await expect(cap).toBeFocused();
  });
});

/**
 * Single-key shortcuts off by default (WP-04 T13; audit A2-03, WCAG 2.1.4): a new guided account cannot start work or
 * answer a note with one stray key. global-setup.ts turns the keys on for the other specs; this block turns them off,
 * as a new founder has them, and puts back what it found.
 */
test.describe("single-key shortcuts off (a new founder's default)", () => {
  let before = true;
  test.beforeAll(async ({ playwright }) => {
    before = await setKeyboardShortcuts(playwright, false);
  });
  test.afterAll(async ({ playwright }) => {
    await setKeyboardShortcuts(playwright, before);
  });

  test("Space on Today scrolls and never starts work", async ({ page }) => {
    await openBusiness(page, "today");
    await dismissCoachmarks(page);
    const cycle = await intercept(page, "business.continue");
    // Record whether anything took Space from the browser (a page shortcut would prevent its scroll).
    await page.evaluate(() => {
      const w = window as unknown as { spaceTaken: boolean[] };
      w.spaceTaken = [];
      window.addEventListener("keydown", (e) => {
        if (e.key === " ") w.spaceTaken.push(e.defaultPrevented);
      });
    });
    await page.getByTestId("shell-content").focus();
    await page.keyboard.press("Space");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => (window as unknown as { spaceTaken: boolean[] }).spaceTaken)).toEqual([false, false]);
    await page.waitForTimeout(500);
    expect(cycle.calls()).toBe(0);
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible();
  });

  test("only /, Cmd-K, ? and Esc act: R, J, K and the G chords do nothing, and the shortcut list says where to turn them on", async ({ page }) => {
    await openBusiness(page, "inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    await dismissCoachmarks(page);
    const refresh = await intercept(page, "inbox.refresh");
    const url = page.url();
    await page.getByTestId("shell-content").focus();
    for (const key of ["j", "k", "r", "e"]) await page.keyboard.press(key);
    await page.keyboard.press("g");
    await expect(page.getByTestId("app-shell")).not.toHaveAttribute("data-chord-pending", "true");
    await page.keyboard.press("h");
    await page.waitForTimeout(500);
    expect(page.url()).toBe(url);
    expect(refresh.calls()).toBe(0);
    await page.keyboard.press("/");
    await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: LONG });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: LONG });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.keyboard.press("?");
    const help = page.getByTestId("keyboard-help");
    await expect(help).toHaveAttribute("data-single-keys", "off");
    await expect(help).toContainText("Single-key shortcuts are off. Turn them on in Settings › Preferences.");
    await expect(help).toContainText("Refresh Inbox");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });

  test("Settings › Preferences turns them on and off, and the shortcut list follows", async ({ page }) => {
    await openBusiness(page, "settings/preferences");
    const sw = () => settingsScreen(page).getByTestId("keyboard-shortcuts-switch");
    await expect(sw()).toHaveAttribute("aria-checked", "false", { timeout: LONG });
    await expect(settingsScreen(page).getByTestId("keyboard-shortcuts-panel")).toContainText("Search (/ or ⌘K), the list of shortcuts (?) and Esc always work.");
    await sw().click();
    await expect(sw()).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Single-key shortcuts on").first()).toBeVisible({ timeout: LONG });
    await page.reload();
    await expect(sw()).toHaveAttribute("aria-checked", "true", { timeout: LONG });
    await page.getByTestId("shell-content").focus();
    await page.keyboard.press("?");
    await expect(page.getByTestId("keyboard-help")).toHaveAttribute("data-single-keys", "on");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("keyboard-help")).toHaveCount(0);
    await sw().click();
    await expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  test("forced colors: a focused field still draws its outline and a panel keeps a 1 px edge (WP-10 T7)", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openBusiness(page, "settings/business");
    const screen = settingsScreen(page);
    await expect(screen).toHaveAttribute("data-tab", "business", { timeout: LONG });
    const name = screen.locator("#biz-name");
    await name.focus();
    const outline = await name.evaluate((el) => getComputedStyle(el.closest(".field-well")!).outlineStyle);
    expect(outline).not.toBe("none");
    const edge = await page.locator(".surface-panel").first().evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(edge).toBe("1px");
  });

  test("tabbing through a note never leaves the focused control under the decision bar (WP-10 T7, WCAG 2.4.11)", async ({ page }) => {
    test.setTimeout(240_000);
    const bid = await commitThrowaway(page, `Playwright focus ${Date.now().toString(36)}`);
    await page.goto(`/b/${bid}/inbox`);
    // The plan note is the decision the team sends first (the first row may be the welcome note or the day's digest).
    const row = inboxRow(page, PLAN_NOTE);
    await expect(row).toBeVisible({ timeout: LONG });
    await row.click();
    await expect(page.getByTestId("decision-bar")).toBeVisible({ timeout: LONG });
    await dismissCoachmarks(page);
    await page.setViewportSize({ width: 1440, height: 640 });
    const pane = page.getByTestId("inbox-item");
    await pane.locator("a, button, [tabindex='0']").first().focus();
    for (let i = 0; i < 25; i++) {
      const hidden = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const bar = document.querySelector("[data-testid=decision-bar]");
        if (!el || !bar || bar.contains(el) || !el.closest("[data-testid=inbox-item]")) return null;
        const a = el.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        return a.top < b.bottom && a.bottom > b.top ? (el.textContent ?? el.tagName).trim().slice(0, 60) : null;
      });
      expect(hidden, `focus ${i} sits under the decision bar`).toBeNull();
      await page.keyboard.press("Tab");
    }
  });
});
