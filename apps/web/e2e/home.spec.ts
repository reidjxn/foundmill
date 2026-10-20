import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, settingsScreen } from "./helpers";

/** Home dashboards (BUILD §11.2, AC-11.2.4) on the seeded Northwind Skincare. Stack and commands: e2e/README.md. */
test.describe("home", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
  });

  test("renders the active dashboard as a tab with the widget grid", async ({ page }) => {
    const screen = page.getByTestId("home-screen");
    await expect(screen).toHaveAttribute("data-dashboard-id", /[0-9a-f-]{36}/);
    await expect(page.getByTestId("home-grid")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Dashboards" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Dashboards" }).getByRole("tab", { selected: true })).toBeVisible();
  });

  test("the status strip's runway agrees with the top bar, and inbox rows wrap instead of clipping", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Status" });
    await expect(strip).toBeVisible({ timeout: LONG });
    await expect(strip.getByText("Runway", { exact: true })).toBeVisible({ timeout: LONG });
    const bar = page.getByTestId("kit-bar");
    // No runway figure: the bar and the tile say the same words, never a bare dash: "No limit" when cash-flow
    // positive, "Not known yet" otherwise (the shared runway wording), the reason under the tile and in the bar's tooltip.
    await expect(bar).not.toContainText("No runway yet");
    const barWords = bar.locator("[data-runway-words]");
    if (await barWords.count()) {
      const words = (await barWords.innerText()).trim();
      expect(words).toMatch(/^(No limit|Not known yet)$/);
      await expect(strip.getByText(words, { exact: true })).toBeVisible({ timeout: LONG });
    }
    // Inbox preview rows: the subject wraps to two lines; nothing in a row is cut sideways.
    const rows = page.locator("[data-inbox-row]");
    if (await rows.count()) {
      const clipped = await rows.evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll<HTMLElement>("*")]).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === "ellipsis").length);
      expect(clipped).toBe(0);
    }
  });

  test("the status strip and the department cards speak in words, with the formula kept for the provenance tooltip", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Status" });
    await expect(strip).toBeVisible({ timeout: LONG });
    // "Team health" with its count (UX plan B10), never "Business health"; runway captioned in words (B9).
    await expect(strip.getByText("Team health", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(strip).not.toContainText("Business health");
    await expect(strip).toContainText(/\d+ of \d+ \w+ healthy|No \w+ hired yet/, { timeout: LONG });
    await expect(strip).toContainText(/Months of cash left|Under \d+ months of cash left|No limit|Not known yet/, { timeout: LONG });
    await expect(strip).toContainText("Money in this month");
    await expect(strip).toContainText(/Paying \w+, last 7 days/);
    // The formula is the provenance tooltip's, not a caption: nothing on the strip reads "Cash ÷ net burn" or "Cash basis".
    await expect(strip).not.toContainText("÷");
    await expect(strip).not.toContainText("Cash basis");
    await expect(strip.getByRole("button", { name: /Where this number comes from: Cash ÷ net burn/ })).toHaveCount(1);
    // Department cards: "Working on now" and "Next" (E6), the team strip counting agents on a task (B19).
    const card = page.locator("[data-department]").first();
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(card).toContainText("Working on now");
    await expect(card).toContainText("Next");
    await expect(card).not.toContainText("Next up");
    await expect(card).not.toContainText("Nothing queued");
    await expect(card.locator("[data-team-strip-words]")).toHaveText(/^\d+ of \d+ working$|^\d+ agents?, |^No agents yet$/);
  });

  test("the Team pulse hour labels fit their boxes at 1280 px, one every three hours", async ({ page }) => {
    // Each label's box spans three hour columns; at one column (about 24 px) "12 AM" spilled out (no-clip.spec, Oct 2026).
    await page.setViewportSize({ width: 1280, height: 900 });
    // Seeded on Northwind's Home (`squad_pulse` in the seed's dashboard); it renders once its data has loaded, so wait
    // for it rather than counting at once. An earlier edit of the dashboard may have removed it.
    const pulse = page.locator("[data-squad-pulse]").first();
    const shown = await pulse.waitFor({ state: "visible", timeout: LONG }).then(
      () => true,
      () => false,
    );
    test.skip(!shown, "the active dashboard has no Team pulse widget");
    const labels = () => pulse.locator("[role=columnheader]:not(.sr-only)").evaluateAll((els) => els.map((el) => ({ text: el.textContent ?? "", box: el.clientWidth, needs: el.scrollWidth })));
    await expect.poll(async () => (await labels()).map((l) => l.text), { timeout: LONG }).toEqual(["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]);
    // Polled while the grid settles at the new width; a label too wide for its box never passes.
    await expect.poll(async () => (await labels()).filter((l) => l.needs > l.box + 1).map((l) => `"${l.text}" ${l.box}<${l.needs}`), { timeout: LONG }).toEqual([]);
    await expect(pulse.locator("[role=columnheader]")).toHaveCount(24);
  });

  test("E toggles Edit mode; the toolbar button mirrors it; Esc leaves it", async ({ page }) => {
    // The shortcut works whether or not the key cap shows (it shows only when guidance is off, UX plan §7.7).
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-keyshortcuts", "E");
    await page.keyboard.press("e");
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-screen")).not.toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "false");
  });

  test("a new dashboard from New never becomes the default Home", async ({ page }) => {
    const first = (await page.getByTestId("home-screen").getAttribute("data-dashboard-id"))!;
    await page.getByTestId("new-dashboard").click();
    await page.locator("[data-preset=investor]").click();
    await page.waitForURL(/\/home\/[0-9a-f-]{36}/, { timeout: LONG });
    const second = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    expect(second).not.toBe(first);
    // /home still opens the original dashboard.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-dashboard-id", first, { timeout: LONG });
    // Clean up: delete the new tab.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home/${second}`);
    await page.getByTestId("dashboard-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByTestId("confirm-delete-dashboard").click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
  });

  test("AC-11.2.4: a second dashboard works independently, persists its version and can be deleted", async ({ page }) => {
    const first = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    await page.getByTestId("new-dashboard").click();
    await page.locator("[data-preset=seller]").click();
    await page.waitForURL(/\/home\/[0-9a-f-]{36}/, { timeout: LONG });
    const second = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    expect(second).not.toBe(first);
    const version = Number(await page.getByTestId("home-screen").getAttribute("data-dashboard-version"));
    expect(version).toBeGreaterThanOrEqual(1);
    // Two tabs at least: the original and the new one.
    expect(await page.getByRole("tablist", { name: "Dashboards" }).getByRole("tab").count()).toBeGreaterThanOrEqual(2);
    await page.getByTestId("dashboard-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByTestId("confirm-delete-dashboard").click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-dashboard-id", first!);
  });
});

/** Home's Autopilot chip: always there, in words (Off, On, Waiting for you, Paused: reason); it opens Settings > Mode. */
test.describe("home > Autopilot chip", () => {
  test("shows the state and opens Settings > Mode", async ({ page }) => {
    await openBusiness(page);
    const chip = page.getByTestId("home-autopilot").getByTestId("autopilot-chip");
    await expect(chip).toBeVisible({ timeout: LONG });
    await expect(chip).toContainText("Autopilot");
    await expect(chip).toHaveAttribute("data-autopilot-state", /^(off|on|waiting|paused)$/);
    await chip.click();
    await expect(page).toHaveURL(/\/settings\/mode$/);
    await expect(settingsScreen(page).getByTestId("autopilot-section")).toBeVisible({ timeout: LONG });
  });
});
