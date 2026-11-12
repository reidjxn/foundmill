import { expect, test } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, NORTHWIND_BUSINESS_ID, areaLink, areaTabBar, departmentBase, dismissCoachmarks, openBusiness, setBuilderView, settled } from "./helpers";

/**
 * Founder areas (founder decisions 2026-11-09; docs/DESIGN.md §8–§9) on the seeded Northwind Skincare: the sidebar asks
 * the founder's questions (Today, Needs you, Plan, Customers, Money, Product, Team), each area's tab bar spans the
 * departments over its modules with the defaults inline and the rest behind "More detail", breadcrumbs say which area
 * a department page belongs to ("Product › Formulation Lab"), each area opens on one plain sentence (the shapes, never
 * the seeded numbers, are asserted, on Northwind and Ledgerly), and the G chords follow the areas. Builder view is off
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
  test("the sidebar reads Today, Needs you, Plan, Customers, Money, Product, Team and Team call; no department and no Contacts item", async ({ page }) => {
    await openBusiness(page, "today");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const labels = await nav.locator("ul").first().locator("[data-sidebar-label]").allTextContents();
    expect(labels).toEqual(["Today", "Needs you", "Plan", "Customers", "Money", "Product", "Team", "Team call"]);
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

  test("each area opens on one plain sentence, first on every tab, with the kind line for a department with its own name", async ({ page }) => {
    await openBusiness(page);
    await dismissCoachmarks(page);
    const opening = async (path: string, area: string, sentence: RegExp, kind?: string | null) => {
      await page.goto(`${B}/${path}`);
      const line = page.getByRole("region", { name: `${area} at a glance` });
      await expect(line.locator("[data-area-sentence]")).toHaveText(sentence, { timeout: LONG });
      if (kind === undefined) return line;
      if (kind === null) await expect(line.locator("[data-area-kind]")).toHaveCount(0);
      else await expect(line.locator("[data-area-kind]")).toHaveText(kind);
      return line;
    };

    // Money: cash, spending and months of cash (Estimate) in Northwind's pounds, with the Company line under it.
    const MONEY = /^(You have £[\d,.]+[KM]? and (spend about £[\d,.]+[KM]? a month( more than comes in)?, so you have (about [\d.]+ months?|less than a month) of cash|earn more than you spend, so cash is not running out)\.Estimate|You have £[\d,.]+[KM]?; how long it lasts .*|Connect your bank and this line shows your cash and how long it lasts\.|Your bank balance is £[\d,.]+[KM]? below zero, .*)$/;
    const money = await opening("d/finance/overview", "Money", MONEY, "Finance is part of Money.");
    // The Company line counts Compliance's 30-day window ("Due within 30 days"); with nothing inside it, it names the next filing.
    const DAY = String.raw`[A-Z][a-z]{2} \d{1,2}(, \d{4})?`;
    const COMPANY = new RegExp(
      String.raw`^Company: (Northwind Skincare Ltd: (\d+ filings? (is|are) due in the next 30 days, (on|the first on) ${DAY}|nothing is due in the next 30 days(; the next filing is ${DAY}|, and no later filing is on the calendar)|\d+ filings? (is|are) overdue(, and \d+ more (is|are) due in the next 30 days)?)\.|Your company is (not incorporated yet|being incorporated)\.)$`,
    );
    await expect(money.locator("[data-area-section='company']")).toHaveText(COMPANY);
    await opening("d/finance/runway", "Money", MONEY);
    const legal = await opening("d/legal/entity", "Money", MONEY, "Legal is part of Money, in its Company section.");
    await expect(legal.locator("[data-area-section='company']")).toBeVisible();
    // One fact: the line's due-soon count is the Compliance tile's "Due within 30 days", on the same page.
    const compliance = await opening("d/legal/compliance", "Money", MONEY);
    await expect(compliance.locator("[data-area-section='company']")).toHaveText(COMPANY, { timeout: LONG });
    const companyLine = (await compliance.locator("[data-area-section='company']").textContent()) ?? "";
    const dueTile = page.locator("[data-metric-tile]").filter({ has: page.locator("[data-metric-label]", { hasText: /^Due within 30 days$/ }) });
    await expect(dueTile.locator("[data-value]")).toHaveAttribute("data-value", /^\d+$/, { timeout: LONG });
    const tileCount = Number(await dueTile.locator("[data-value]").getAttribute("data-value"));
    const lineCount = Number(/(\d+) (?:more )?(?:filings? )?(?:is|are) due in the next 30 days/.exec(companyLine)?.[1] ?? 0);
    expect(lineCount, companyLine).toBe(tileCount);

    // Plan: the goal (or that none is set) and what is in Now, on the Roadmap and on Milestones.
    const PLAN = /^(Your goal: .+\.|A goal waits for your answer: .+\.|No goal is set yet\.)( .+)?( \d+ things? (is|are) in Now.*| \d+ things? in Now (is|are) done\.| Nothing is in Now on the roadmap yet\.)(Estimate|Forecast)?$/;
    await opening("d/product/roadmap", "Plan", PLAN, "Product is part of Plan.");
    await opening("milestones", "Plan", PLAN, null);

    // Customers: the 35-day channel window and the live campaigns (or not selling yet), on Leads, Campaigns and Contacts.
    const CUSTOMERS = /^(In the last 35 days: (no new leads|[\d,]+ new leads?)[^.]*\.( (No campaign is|\d+ campaigns? (is|are)) live\.)?|Selling has not started yet\.)$/;
    await opening("d/distribution/leads", "Customers", CUSTOMERS, "Retail Partnerships is part of Customers.");
    await opening("d/distribution/campaigns", "Customers", CUSTOMERS);
    await opening("crm", "Customers", CUSTOMERS, null);

    // Product: what went live in the last 7 days and what waits for the founder (or the sign-off), Formulation Lab named.
    const PRODUCT = /^((\d+ changes? went live|Nothing went live) in the last 7 days( and (nothing waits|\d+ waits?) for your go-ahead)?\.( Your live product last changed on [A-Z][a-z]{2} \d{1,2}(, \d{4})?\.)?|Your specification and roadmap (wait for your sign-off|are being drafted)\.|The team builds from your signed-off specification and roadmap\.)$/;
    await opening("d/product/specification", "Product", PRODUCT, null);
    await opening("d/development/pull-requests", "Product", PRODUCT, "Development is part of Product.");
    await opening("d/operations/specialists", "Product", PRODUCT, "Formulation Lab is part of Product.");

    // Team: the Chief of Staff, named through an EntityLink, runs the leads and the specialists.
    const team = await opening("d/team/squad", "Team", /^(.+, your Chief of Staff, runs|Your .+ runs) (\d+ leads?( and \d+ specialists?)?|\d+ specialists?|the team on its own so far)(; \d+ (is|are) down or failing)?\.$/, null);
    await expect(team.locator("[data-area-sentence] a.entity-link").first()).toHaveAttribute("href", new RegExp(`^${B}/agents/[0-9a-f-]{36}`));
  });

  test("Ledgerly's areas open on their sentences too, money in the business's own pounds", async ({ page }) => {
    await openBusiness(page);
    const L = `/b/${LEDGERLY_BUSINESS_ID}`;
    const sentence = (area: string) => page.getByRole("region", { name: `${area} at a glance` }).locator("[data-area-sentence]");
    await page.goto(`${L}/d/finance/overview`);
    await expect(sentence("Money")).toHaveText(/^(You have £[\d,.]+[KM]? and .+\.Estimate|Connect your bank and this line shows your cash and how long it lasts\.|You have £[\d,.]+[KM]?; .+|Your bank balance is £.+)$/, { timeout: LONG });
    await expect(sentence("Money")).not.toContainText("$");
    await page.goto(`${L}/d/distribution/leads`);
    await expect(sentence("Customers")).toHaveText(/^(In the last 35 days: .+\.|Selling has not started yet\.)$/, { timeout: LONG });
    await expect(page.getByRole("region", { name: "Customers at a glance" }).locator("[data-area-kind]")).toHaveText("Distribution is part of Customers.");
    await page.goto(`${L}/d/product/roadmap`);
    await expect(sentence("Plan")).toHaveText(/^(Your goal: |A goal waits for your answer: |No goal is set yet\.).+/, { timeout: LONG });
    await page.goto(`${L}/d/team/squad`);
    await expect(sentence("Team")).toContainText(/Chief of Staff/, { timeout: LONG });
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
