import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, areaLink, areaTabBar, departmentBase, dismissCoachmarks, openBusiness, setBuilderView, settled } from "./helpers";

/**
 * Founder areas (founder decisions 2026-11-09; docs/DESIGN.md §8–§9) on the seeded Northwind Skincare: the sidebar asks
 * the founder's questions (Today, Needs you, Plan, Customers, Money, Product, Team), each area's tab bar spans the
 * departments over its modules with the defaults inline and the rest behind "More detail", breadcrumbs say which area
 * a department page belongs to ("Product › Formulation Lab"), and the G chords follow the areas. Builder view is off
 * for this file (global-setup.ts starts every run with it off); restored afterwards. Stack: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;
let builderBefore = false;
test.beforeAll(async ({ playwright }) => {
  builderBefore = await setBuilderView(playwright, false);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, builderBefore);
});

test.describe("founder areas", () => {
  test("the sidebar reads Today, Needs you, Plan, Customers, Money, Product, Team; no department and no Contacts item", async ({ page }) => {
    await openBusiness(page, "today");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const labels = await nav.locator("ul").first().locator("[data-sidebar-label]").allTextContents();
    expect(labels).toEqual(["Today", "Needs you", "Plan", "Customers", "Money", "Product", "Team"]);
    for (const gone of ["Inbox", "Contacts", "Milestones", "Formulation Lab", "Retail Partnerships", "Finance", "Legal"]) await expect(nav.getByRole("link", { name: new RegExp(`^${gone}(,|$)`) })).toHaveCount(0);
    await expect(nav.locator("[data-sidebar-item='inbox']")).toHaveAttribute("href", `${B}/inbox?tab=respond`);
    await expect(areaLink(page, "money")).toHaveAttribute("href", `${B}/d/finance/overview`);
    await expect(areaLink(page, "plan")).toHaveAttribute("href", `${B}/d/product/roadmap`);
    // The LIVE block and the foot are unchanged.
    await expect(nav.getByRole("link", { name: /^Network/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("an area's bar shows its defaults inline; More detail holds the rest, and an opened detail tab joins the bar", async ({ page }) => {
    await openBusiness(page, "d/distribution/leads");
    await dismissCoachmarks(page);
    const bar = areaTabBar(page, "Customers");
    await expect(bar.getByRole("tab")).toHaveText([/^Leads/, /^Campaigns/, /^Contacts/], { timeout: LONG });
    await expect(areaLink(page, "customers")).toHaveAttribute("aria-current", "page");
    const more = page.getByRole("button", { name: "More detail, 4 tabs" });
    await expect(more).toBeVisible();
    // Beside the tablist, never inside it.
    expect(await more.evaluate((el) => el.closest("[role=tablist]") === null)).toBe(true);
    await more.click();
    const menu = page.getByTestId("more-detail-menu");
    await expect(menu.getByRole("menuitem")).toHaveText(["Board", "Channels", "Creative", "Attribution"]);
    await menu.getByRole("menuitem", { name: "Channels" }).click();
    await expect(page).toHaveURL(new RegExp(`${B}/d/distribution/channels`), { timeout: LONG });
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "distribution/channels", { timeout: LONG });
    await expect(bar.getByRole("tab", { name: "Channels" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "More detail, 3 tabs" })).toBeVisible();
    // Contacts, a fixed surface, sits in the same bar and lights the same area.
    await bar.getByRole("tab", { name: "Contacts" }).click();
    await expect(page).toHaveURL(new RegExp(`${B}/crm$`), { timeout: LONG });
    await expect(areaTabBar(page, "Customers").getByRole("tab", { name: "Contacts" })).toHaveAttribute("aria-selected", "true", { timeout: LONG });
    await expect(areaLink(page, "customers")).toHaveAttribute("aria-current", "page");
  });

  test("Northwind's renamed departments: breadcrumbs read Product › Formulation Lab and Money › Legal, the title stays the department", async ({ page }) => {
    await openBusiness(page);
    await page.goto(`${departmentBase("operations")}/specialists`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/specialists", { timeout: LONG });
    await settled(page);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("listitem")).toHaveText(["Product", "Formulation Lab"]);
    await expect(crumbs.getByRole("link", { name: "Product" })).toHaveAttribute("href", `${B}/d/product/specification`);
    await expect(page.getByTestId("kitbar-screen-title")).toHaveText("Formulation Lab");
    await expect(areaLink(page, "product")).toHaveAttribute("aria-current", "page");
    // Formulation Lab's first tab is promoted inline; the two Specialists tabs name their departments.
    const bar = areaTabBar(page, "Product");
    await expect(bar.getByRole("tab", { name: "Specialists · Formulation Lab" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: /^More detail/ }).click();
    await expect(page.getByTestId("more-detail-menu").getByRole("menuitem", { name: "Specialists · Development" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The legal module is Money's Company section: its entity tab reads Company.
    await page.goto(`${departmentBase("legal")}/entity`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "legal/entity", { timeout: LONG });
    await expect(crumbs.getByRole("listitem")).toHaveText(["Money", "Legal"]);
    await expect(areaTabBar(page, "Money").getByRole("tab")).toHaveText([/^Overview/, /^Runway/, /^Company/, /^Compliance/]);
    await expect(areaLink(page, "money")).toHaveAttribute("aria-current", "page");
  });

  test("G chords follow the areas: G P Plan, G C Customers, G M Money, G R Product, G T Team, G I Needs you, G H Today", async ({ page }) => {
    await openBusiness(page, "today");
    await dismissCoachmarks(page);
    const shell = page.getByTestId("app-shell");
    const chord = async (letter: string, url: RegExp) => {
      await page.getByTestId("shell-content").focus();
      await page.keyboard.press("g");
      await expect(shell).toHaveAttribute("data-chord-pending", "true");
      await page.keyboard.press(letter);
      await expect(page).toHaveURL(url, { timeout: LONG });
      await settled(page);
    };
    await chord("p", new RegExp(`${B}/d/product/roadmap$`));
    await chord("c", new RegExp(`${B}/d/distribution/leads$`));
    await chord("m", new RegExp(`${B}/d/finance/overview$`));
    await chord("r", new RegExp(`${B}/d/product/specification$`));
    await chord("t", new RegExp(`${B}/d/team/squad$`));
    await chord("i", new RegExp(`${B}/inbox\\?tab=respond$`));
    await chord("h", new RegExp(`${B}/today$`));
  });
});
