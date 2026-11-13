import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, dismissCoachmarks, openBusiness } from "./helpers";

/**
 * Today and Needs you from 390 px (docs/THESIS_REVIEW.md package 2.1, part A; CLAUDE.md "Small screens"): the business
 * shell's phone layout (menu button, no sidebar, no larger-window ask, one column), while every other project route keeps
 * the 1280 px floor and a desktop window is unchanged.
 */
const bid = NORTHWIND_BUSINESS_ID;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Visible links and buttons in the page (not inside a closed menu) shorter than a finger's 44 px, with where they are. */
async function shortTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("a[href], button, [role=button], [role=tab]")) {
      if (el.closest("[data-testid=sr-only], .sr-only") || el.matches(".sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden=true]")) continue;
      // A small inline control may keep its look and reach 44 px with an invisible box around it (tap-reach).
      const reach = Number.parseFloat(getComputedStyle(el, "::after").height) || 0;
      if (Math.max(r.height, reach) < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(r.height)}px`);
    }
    return out;
  });
}

test.describe("Today and Needs you on a phone", () => {
  test("Today at 390 px: no larger-window ask, no sideways scroll, Needs you in one column, the menu reaches the Inbox", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBusiness(page, "today");
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await dismissCoachmarks(page);
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-phone", "");
    await expect(page.getByTestId("phone-bar")).toBeVisible();
    // No sidebar on a phone: the menu holds the same items.
    await expect(page.locator("nav[aria-label=Primary]:visible")).toHaveCount(0);
    await expect(page.getByTestId("needs-you")).toBeVisible({ timeout: LONG });
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // One column: the goal panel and Needs you sit one under the other, both the full width of the screen.
    const needs = (await page.getByTestId("needs-you").boundingBox())!;
    expect(needs.x).toBeGreaterThanOrEqual(0);
    expect(needs.x + needs.width).toBeLessThanOrEqual(390);
    expect(needs.width).toBeGreaterThan(390 - 40);
    const week = (await page.getByTestId("week-plan").boundingBox())!;
    expect(week.width).toBeGreaterThan(390 - 40);
    // The health strip wraps two to a row.
    const tiles = page.locator("[data-testid=today-health] [role=listitem]");
    expect(await tiles.count()).toBeGreaterThanOrEqual(3);
    const first = (await tiles.nth(0).boundingBox())!;
    const second = (await tiles.nth(1).boundingBox())!;
    const third = (await tiles.nth(2).boundingBox())!;
    expect(Math.abs(first.y - second.y)).toBeLessThan(2);
    expect(third.y).toBeGreaterThan(first.y + 10);

    expect(await shortTargets(page), "every link and button on Today is at least 44 px high").toEqual([]);

    // The menu opens and reaches Needs you.
    await page.getByTestId("phone-menu-button").click();
    const menu = page.getByTestId("phone-menu");
    await expect(menu).toBeVisible();
    // (The panel eases in; the rows settle at their full height.)
    await expect.poll(() => shortTargets(page), { message: "the menu's rows are at least 44 px high" }).toEqual([]);
    await menu.getByRole("link", { name: /^Needs you/ }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${bid}/inbox`), { timeout: LONG });
    await expect(menu).toHaveCount(0);
  });

  test("Needs you at 390 px shows the list, opens a note full width and Back returns", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBusiness(page, "inbox");
    await expect(page.getByTestId("inbox-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await dismissCoachmarks(page);
    // The list at full width; the reading pane is not on screen yet.
    const list = (await page.getByTestId("inbox-pane").boundingBox())!;
    expect(list.width).toBeGreaterThan(390 - 2);
    await expect(page.getByTestId("reading-pane")).toBeHidden();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const rows = page.getByTestId("inbox-list").getByRole("option");
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${bid}/inbox/[0-9a-f-]{36}`));
    await expect(page.getByTestId("reading-pane")).toBeVisible();
    await expect(page.getByTestId("inbox-pane")).toBeHidden();
    const pane = (await page.getByTestId("reading-pane").boundingBox())!;
    expect(pane.width).toBeGreaterThan(390 - 2);
    await expect(page.getByTestId("inbox-back")).toBeVisible();
    await expect.poll(() => overflow(page), { timeout: LONG }).toBeLessThanOrEqual(0);

    await page.getByTestId("inbox-back").click();
    await expect(page.getByTestId("inbox-pane")).toBeVisible();
    await expect(page.getByTestId("reading-pane")).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/b/${bid}/inbox$`));

    // The address of a note opens its reading pane directly.
    await rows.first().click();
    const noteUrl = page.url();
    await page.goto(noteUrl);
    await expect(page.getByTestId("phone-bar")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("reading-pane")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("inbox-pane")).toBeHidden();
    expect(await shortTargets(page), "every link and button on a note is at least 44 px high").toEqual([]);
  });

  test("a note that asks for an answer at 390 px: the options and every control are finger-sized, nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBusiness(page, "inbox?tab=respond");
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("phone-bar")).toBeVisible({ timeout: LONG });
    await dismissCoachmarks(page);
    await page.getByTestId("inbox-list").getByRole("option").first().click();
    await expect(page.getByTestId("reading-pane")).toBeVisible();
    await expect(page.getByTestId("decision-bar")).toBeVisible({ timeout: LONG });
    await expect.poll(() => overflow(page), { timeout: LONG }).toBeLessThanOrEqual(0);
    expect(await shortTargets(page), "every link and button on a decision is at least 44 px high").toEqual([]);
  });

  test("another project route at 390 px still asks for a larger window", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBusiness(page, "today");
    await page.goto(`/b/${bid}/crm`);
    await expect(page.getByTestId("needs-larger-window")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("phone-bar")).toHaveCount(0);
  });

  test("Today at 1280 px is the desktop layout: sidebar, no menu button, two columns", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page, "today");
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("app-shell")).not.toHaveAttribute("data-phone", "");
    await expect(page.locator("nav[aria-label=Primary]")).toBeVisible();
    await expect(page.getByTestId("phone-menu-button")).toHaveCount(0);
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByTestId("kit-bar")).toBeVisible();
    const goal = (await page.getByTestId("today-screen").locator("[data-testid=needs-you]").boundingBox())!;
    const week = (await page.getByTestId("week-plan").boundingBox())!;
    expect(goal.width).toBeLessThan(week.width);
  });
});
