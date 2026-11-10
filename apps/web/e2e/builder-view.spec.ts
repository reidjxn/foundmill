import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, areaTabBar, departmentBase, openBusiness, openSettings, setBuilderView, settled, toast } from "./helpers";

/**
 * Builder view (founder, 2026-11-08; docs/DESIGN.md "Builder view"): one account-wide switch, off by default, that shows
 * how the platform runs the team. Off: the Product area shows Specification, What changed and Live product inline (Working now,
 * Work list and Specialists behind More detail), nothing links to Code, Health or Hierarchy, a gated tab opened by URL says "This is part of Builder
 * view", the Agents table has no Form or "Rating /20", and no cycle number, tokens, ETA or test count shows; What
 * changed reads "Waiting for your go-ahead" and "Gone live", Live product shows "Your live product" and the previews,
 * and a Working now tile has no terminal. On: everything comes back. The dev founder is shared by every spec, so the switch is restored afterwards.
 */
let before = false;
test.beforeAll(async ({ playwright }) => {
  before = await setBuilderView(playwright, false);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, before);
});

async function openTab(page: Page, href: string, module: string): Promise<void> {
  await page.goto(href);
  await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", module, { timeout: LONG });
  await settled(page);
}

const ENGINE_WORDS = /\bcycle \d+\b|\b\d[\d,.]*K? tokens\b|\bETA\b|\b\d+ (?:of \d+ )?tests? passed\b/i;

test.describe("Builder view", () => {
  test("off: the founder's tabs, no links to the engine tabs, and the gate on a URL visit", async ({ page }) => {
    await openBusiness(page);
    const dev = departmentBase("development");
    const team = departmentBase("team");
    // Nothing on the page links to a Builder view tab.
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => /\/d\/[^/]+\/(code|health|hierarchy)(\?|$)/.test(h))).toEqual([]);

    // The Product area's bar: its defaults, the open Work list, and Formulation Lab's promoted tab; the rest behind
    // More detail, never Code (docs/DESIGN.md §9).
    await openTab(page, `${dev}/plan`, "development/plan");
    await expect(areaTabBar(page, "Product").getByRole("tab")).toHaveText(["Specification", "Work list · Development", "What changed", "Live product", "Specialists · Formulation Lab"]);
    await page.getByRole("button", { name: /^More detail/ }).click();
    await expect(page.getByTestId("more-detail-menu").getByRole("menuitem")).toHaveText(["Vision", "Changes", "Sources", "Research", "Working now", "Specialists · Development", "Work list · Formulation Lab"]);
    await page.keyboard.press("Escape");
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
    // "Open" goes to the department's first inline tab in its area: What changed.
    await gate.getByTestId("builder-gate-open").click();
    await page.waitForURL(/\/d\/[^/]+\/pull-requests/, { timeout: LONG });

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

    // Working now: tiles without tokens or ETA, terminals, diffs or the Task graph.
    await openTab(page, `${dev}/training-ground`, "development/training-ground");
    await expect(page.getByTestId("module-screen")).not.toContainText(ENGINE_WORDS);
    await expect(page.getByTestId("module-screen")).toContainText("Working now");
    await expect(page.getByRole("tab", { name: "Terminal" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Diff" })).toHaveCount(0);
    await expect(page.getByRole("log", { name: /Terminal output/ })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Task graph" })).toHaveCount(0);
  });

  test("off: What changed and Live product read in the founder's words, with no PR numbers, branches or commits", async ({ page }) => {
    await openBusiness(page);
    // The Live feed on Home names no cycle and no pull request number.
    await expect(page.getByTestId("app-shell")).not.toContainText(/\bCycle \d+|Merged PR #\d+/);
    const dev = departmentBase("development");

    await openTab(page, `${dev}/pull-requests`, "development/pull-requests");
    const screen = page.getByTestId("module-screen");
    await expect(page.getByRole("grid", { name: "Waiting for your go-ahead" })).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("grid", { name: "Gone live" })).toBeVisible();
    await expect(page.getByTestId("what-changed-waiting")).toContainText("Waiting for your go-ahead");
    await expect(page.getByTestId("what-changed-live")).toContainText("Gone live");
    await expect(page.getByRole("grid", { name: "Open pull requests" })).toHaveCount(0);
    // The seed's done code tasks are listed as put live, each with its date.
    await expect(page.getByRole("grid", { name: "Gone live" }).getByText(/^Put live [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/).first()).toBeVisible({ timeout: LONG });
    await expect(screen).not.toContainText(/#\d+|agent\/|\bMerged\b|\bBranch\b|\bCommit\b|pull request/i);

    await openTab(page, `${dev}/environments`, "development/environments");
    const card = page.getByTestId("live-product-card");
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(card).toContainText("Your live product");
    await expect(page.getByRole("grid", { name: "Previews of changes" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "Environments" })).toHaveCount(0);
    await expect(page.getByTestId("module-screen")).not.toContainText(/agent\/|\bBranch\b|\bCommit\b|\bProvider\b|Vercel|Netlify|Railway/);
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

    const dev = departmentBase("development");
    const team = departmentBase("team");
    await openTab(page, `${dev}/plan`, "development/plan");
    // Every tab inline under its stored title, no More detail menu (founder decision 3); a long bar still overflows into More.
    const all = await areaTabBar(page, "Product").locator("[role=tab]").allTextContents();
    expect(all).toEqual(expect.arrayContaining(["Vision", "Live sessions", "Plan · Development", "Pull requests", "Code", "Environments", "Specialists · Development", "Specialists · Formulation Lab"]));
    await expect(page.getByRole("button", { name: /^More detail/ })).toHaveCount(0);
    await openTab(page, `${dev}/code`, "development/code");
    await expect(page.getByTestId("builder-gate")).toHaveCount(0);
    // The change and preview lists are the builder's tables again.
    await openTab(page, `${dev}/pull-requests`, "development/pull-requests");
    await expect(page.getByRole("grid", { name: "Merged pull requests" })).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("grid", { name: "Waiting for your go-ahead" })).toHaveCount(0);
    await openTab(page, `${dev}/environments`, "development/environments");
    await expect(page.getByRole("grid", { name: "Environments" })).toBeVisible({ timeout: LONG });
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
    const team = departmentBase("team");
    await page.goto(`${team}/hierarchy`);
    const gate = page.getByTestId("builder-gate");
    await expect(gate).toBeVisible({ timeout: LONG });
    await settled(page);
    await gate.getByRole("button", { name: "Turn on Builder view" }).click();
    await expect(toast(page, "Builder view on")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "team/hierarchy", { timeout: LONG });
  });
});
