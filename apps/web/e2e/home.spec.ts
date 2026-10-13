import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

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

  test("the Team pulse hour labels fit their boxes at 1280 px, one every three hours", async ({ page }) => {
    // Each label's box spans three hour columns; at one column (about 24 px) "12 AM" spilled out (no-clip.spec, Oct 2026).
    await page.setViewportSize({ width: 1280, height: 900 });
    const pulse = page.locator("[data-squad-pulse]").first();
    test.skip((await pulse.count()) === 0, "the active dashboard has no Team pulse widget");
    await expect(pulse).toBeVisible({ timeout: LONG });
    const labels = await pulse.locator("[role=columnheader]:not(.sr-only)").evaluateAll((els) => els.map((el) => ({ text: el.textContent ?? "", box: el.clientWidth, needs: el.scrollWidth })));
    expect(labels.map((l) => l.text)).toEqual(["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]);
    for (const l of labels) expect(l.needs, `"${l.text}" ${l.box}<${l.needs}`).toBeLessThanOrEqual(l.box + 1);
    await expect(pulse.locator("[role=columnheader]")).toHaveCount(24);
  });

  test("E toggles Edit mode; the toolbar button mirrors it; Esc leaves it", async ({ page }) => {
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
