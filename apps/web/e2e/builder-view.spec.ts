import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, openSettings, setBuilderView, settled, toast } from "./helpers";

/**
 * Builder view (founder, 2026-11-08; docs/DESIGN.md "Builder view"): one account-wide switch, off by default, that shows
 * how the platform runs the team. Off: the Development tabs read "Working now · Plan · What changed · Live product ·
 * Specialists", nothing links to Code, Health or Hierarchy, a gated tab opened by URL says "This is part of Builder
 * view", the Agents table has no Form or "Rating /20", and no cycle number, tokens, ETA or test count shows. On:
 * everything comes back. The dev founder is shared by every spec, so the switch is restored afterwards.
 */
let before = false;
test.beforeAll(async ({ playwright }) => {
  before = await setBuilderView(playwright, false);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, before);
});

/** The base of a department's tabs ("/b/<id>/d/<slug>"), from its sidebar link. */
async function departmentBase(page: Page, label: RegExp): Promise<string> {
  const link = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: label }).first();
  await expect(link, `the seed gives Northwind a ${label} department`).toBeVisible({ timeout: LONG });
  return (await link.getAttribute("href"))!.replace(/(\/d\/[^/]+)\/.*$/, "$1");
}

async function openTab(page: Page, href: string, module: string): Promise<void> {
  await page.goto(href);
  await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", module, { timeout: LONG });
  await settled(page);
}

const ENGINE_WORDS = /\bcycle \d+\b|\b\d[\d,.]*K? tokens\b|\bETA\b|\b\d+ (?:of \d+ )?tests? passed\b/i;

test.describe("Builder view", () => {
  test("off: the founder's tabs, no links to the engine tabs, and the gate on a URL visit", async ({ page }) => {
    await openBusiness(page);
    const dev = await departmentBase(page, /development/i);
    const team = await departmentBase(page, /^team/i);
    // Nothing on the page links to a Builder view tab.
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => /\/d\/[^/]+\/(code|health|hierarchy)(\?|$)/.test(h))).toEqual([]);

    await openTab(page, `${dev}/plan`, "development/plan");
    await expect(page.getByRole("tab")).toHaveText(["Working now", "Plan", "What changed", "Live product", "Specialists"]);
    const tabHrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    expect(tabHrefs.filter((h) => /\/(code|health|hierarchy)(\?|$)/.test(h))).toEqual([]);
    await expect(page.getByTestId("app-shell")).not.toContainText(ENGINE_WORDS);

    // Code by URL: it opens, says what it is, and offers both ways on.
    await page.goto(`${dev}/code`);
    const gate = page.getByTestId("builder-gate");
    await expect(gate).toBeVisible({ timeout: LONG });
    await settled(page);
    await expect(gate).toContainText("This is part of Builder view");
    await expect(gate).toContainText("It shows how the team's work runs underneath. Turn on Builder view to see it, here and in every business.");
    await expect(gate.getByRole("button", { name: "Turn on Builder view" })).toBeVisible();
    await gate.getByTestId("builder-gate-open").click();
    await page.waitForURL(/\/d\/[^/]+\/training-ground/, { timeout: LONG });

    // Team: no Health or Hierarchy tab; the Agents table has no Form or Rating /20; Recruitment is still there.
    await openTab(page, `${team}/squad`, "team/squad");
    const teamTabs = await page.getByRole("tab").allTextContents();
    expect(teamTabs).not.toContain("Health");
    expect(teamTabs).not.toContain("Hierarchy");
    expect(teamTabs).toContain("Recruitment");
    const grid = page.getByRole("treegrid", { name: "Agents" });
    await expect(grid).toBeVisible({ timeout: LONG });
    await expect(grid.getByRole("columnheader", { name: /Rating \/20/ })).toHaveCount(0);
    await expect(grid.getByRole("columnheader", { name: /^Form/ })).toHaveCount(0);
    await expect(page.getByTestId("module-screen")).not.toContainText(/Rating \/20|of 20\b/);

    // Working now: tiles without tokens or ETA.
    await openTab(page, `${dev}/training-ground`, "development/training-ground");
    await expect(page.getByTestId("module-screen")).not.toContainText(ENGINE_WORDS);
  });

  test("Settings › Preferences turns it on: the engine comes back, then off again", async ({ page }) => {
    await openBusiness(page);
    const panel = await openSettings(page, "preferences", NORTHWIND_BUSINESS_ID);
    const sw = panel.getByTestId("builder-view-switch");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(panel.getByTestId("builder-view-panel")).toContainText("For operators and anyone building software with the team.");
    await sw.click();
    await expect(toast(page, "Builder view on")).toBeVisible({ timeout: LONG });
    await expect(sw).toHaveAttribute("aria-checked", "true");

    const dev = await departmentBase(page, /development/i);
    const team = await departmentBase(page, /^team/i);
    await openTab(page, `${dev}/plan`, "development/plan");
    await expect(page.getByRole("tab")).toHaveText(["Live sessions", "Plan", "Pull requests", "Code", "Environments", "Specialists"]);
    await openTab(page, `${dev}/code`, "development/code");
    await expect(page.getByTestId("builder-gate")).toHaveCount(0);
    await openTab(page, `${team}/squad`, "team/squad");
    const teamTabs = await page.getByRole("tab").allTextContents();
    expect(teamTabs).toEqual(expect.arrayContaining(["Health", "Hierarchy"]));

    // And off again from the same switch.
    const again = await openSettings(page, "preferences", NORTHWIND_BUSINESS_ID);
    await again.getByTestId("builder-view-switch").click();
    await expect(toast(page, "Builder view off")).toBeVisible({ timeout: LONG });
  });

  test("the gate's own button turns it on, for every business", async ({ page }) => {
    await openBusiness(page);
    const team = await departmentBase(page, /^team/i);
    await page.goto(`${team}/hierarchy`);
    const gate = page.getByTestId("builder-gate");
    await expect(gate).toBeVisible({ timeout: LONG });
    await settled(page);
    await gate.getByRole("button", { name: "Turn on Builder view" }).click();
    await expect(toast(page, "Builder view on")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "team/hierarchy", { timeout: LONG });
  });
});
