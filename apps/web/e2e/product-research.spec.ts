import { expect, test, type Page } from "@playwright/test";
import { LONG, UUID, chooseTableView, commitThrowaway, inboxRow, openBusiness, openExplainer } from "./helpers";

/**
 * The Product Researcher (BUILD §11.5 Research tab; the founder's 2026-10-18 request): the seeded Northwind reads its
 * research plan on Product › Research and opens an artifact; a fresh business gets its plan drafted by the api as soon
 * as its foundations are ready (Home asks for it), the researcher's note reaches the Inbox and Team › Agents lists the
 * Product Researcher. The stack runs MODEL_MODE=mock without Temporal (apps/web/e2e/README.md).
 */
async function openProductTab(page: Page, tab: string, bid?: string): Promise<void> {
  if (bid) await page.goto(`/b/${bid}/home`);
  else await openBusiness(page);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  // By slug, not label: departments are labels over modules (a services business calls Product "Service design").
  const product = page.locator("[data-testid=app-shell] nav a[href*='/d/product/']").first();
  await expect(product, "every archetype gives the business a department with the product slug").toBeVisible({ timeout: LONG });
  const href = (await product.getAttribute("href"))!;
  await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, `/d/$1/${tab}`));
  await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", `product/${tab}`, { timeout: LONG });
}

test.describe("product research", () => {
  test("Northwind: the Research tab carries the plan first, with at least three artifacts, and opens one", async ({ page }) => {
    await openProductTab(page, "research");
    const panel = page.getByTestId("research-plan");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toHaveAttribute("data-research-state", "ready", { timeout: LONG });
    await expect(panel).toContainText("Testing the specification with");
    // Guidance on (the product default): the plan's intro sits in the panel's body (UX plan §7.11).
    await expect(await openExplainer(page, "product/research")).toContainText("Who we will talk to and what we will ask, before building more.");
    const cards = panel.getByRole("list", { name: "Research artifacts" }).getByRole("listitem");
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    // The plan sits above the sources' panels.
    const planBox = (await panel.boundingBox())!;
    const competitors = page.getByText("Competitors", { exact: true }).first();
    const compBox = (await competitors.boundingBox())!;
    expect(planBox.y).toBeLessThan(compBox.y);
    // Read opens the artifact as plain Markdown in a dialog; every threshold is an Estimate.
    // Exact: a draft card also carries "Mark ready".
    await cards.first().getByRole("button", { name: "Read", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: LONG });
    await expect(dialog.locator("[data-research-artifact-body]")).toContainText(/Estimate/);
    await expect(dialog.locator("[data-research-artifact-body] a")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // The assumptions name the sections they come from.
    await expect(panel.getByRole("list", { name: "Riskiest assumptions" }).getByRole("listitem").first()).toBeVisible();
  });

  test("a fresh business: the plan is drafted once the foundations are ready, the researcher's note reaches the Inbox, Team lists the Product Researcher", async ({ page }) => {
    test.setTimeout(240_000);
    const bid = await commitThrowaway(page, `Research ${Date.now().toString(36)}`);
    // Home drafts the foundations (the shell's ensure), then asks for the research plan when they turn ready; the mock
    // drafts in well under a minute, so the Research tab may open while either is still running and fills in by itself.
    await page.goto(`/b/${bid}/home`);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });

    await openProductTab(page, "research", bid);
    const panel = page.getByTestId("research-plan");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toHaveAttribute("data-research-state", "ready", { timeout: LONG });
    await expect(panel).toContainText("Testing the specification with");
    expect(await panel.getByRole("list", { name: "Research artifacts" }).getByRole("listitem").count()).toBeGreaterThanOrEqual(5);
    await expect(panel.locator("[data-research-first-steps]")).toContainText(/research tasks? for the next cycles/);

    // The researcher's note is an update (it blocks nothing). In the project's first week it is folded into the Chief of
    // Staff's note of the day (WP-04 T8), which lists it by its subject.
    await page.goto(`/b/${bid}/inbox`);
    const digest = inboxRow(page, "What your team did today");
    await expect(async () => {
      await page.reload();
      await expect(digest).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: LONG });
    await digest.click();
    await expect(page.getByTestId("inbox-item")).toContainText("How we'll test the specification with", { timeout: LONG });

    // Team › Agents lists the Product Researcher, hired at Take charge into the Product department (the Team
    // department keeps the archetype's slug; its agents tab keeps the slug `squad`).
    await page.goto(`/b/${bid}/d/team/squad`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "team/squad", { timeout: LONG });
    // The tab opens on Simple while guidance is on (Agent, Status, Current task, Rating; UX plan §7.10), which has no
    // Role column; General carries it.
    await chooseTableView(page, "General");
    // In the project's first week the tab shows the starting team and whoever has work (WP-04 T4); "Show all" opens
    // everyone, the researcher of the plan included.
    await page.getByTestId("squad-show-all").click({ timeout: LONG });
    // Leads first (Nov 8, 2026): specialists sit collapsed under their lead; open every lead to find the researcher.
    const expanders = page.getByRole("button", { name: /^Show \d+ specialists? under / });
    await expect(expanders.first()).toBeVisible({ timeout: LONG });
    while ((await expanders.count()) > 0) await expanders.first().click();
    await expect(page.getByRole("row").filter({ hasText: "Product research analyst" }).first()).toBeVisible({ timeout: LONG });
    expect(page.url()).toMatch(new RegExp(`/b/${UUID}/d/team/squad`));
  });
});
