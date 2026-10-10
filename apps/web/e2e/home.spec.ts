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
    // No burn model yet: both say so in words (the bar "No runway yet", the tile "None yet"), never a bare dash.
    if (await bar.getByText("No runway yet").count()) await expect(strip.getByText("None yet")).toBeVisible({ timeout: LONG });
    // Inbox preview rows: the subject wraps to two lines; nothing in a row is cut sideways.
    const rows = page.locator("[data-inbox-row]");
    if (await rows.count()) {
      const clipped = await rows.evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll<HTMLElement>("*")]).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === "ellipsis").length);
      expect(clipped).toBe(0);
    }
  });

  test("E toggles Edit mode; the toolbar button mirrors it; Esc leaves it", async ({ page }) => {
    await page.keyboard.press("e");
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-screen")).not.toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "false");
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
