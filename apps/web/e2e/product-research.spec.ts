import { expect, test, type Page } from "@playwright/test";
import { LONG, UUID, commitThrowaway, openBusiness } from "./helpers";

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
  const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
  await expect(product, "the seed gives every business a Product department").toBeVisible({ timeout: LONG });
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
    await expect(panel.locator("[data-explainer='product/research']")).toContainText("Who we will talk to and what we will ask, before building more.");
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

    // The researcher's note is an Update in the Inbox (it blocks nothing).
    await page.goto(`/b/${bid}/inbox`);
    const note = page.getByText(/^How we'll test the specification with/).first();
    await expect(note).toBeVisible({ timeout: LONG });

    // Team › Agents lists the Product Researcher, hired at Take charge into the Product department (the Team
    // department keeps the archetype's slug; its agents tab keeps the slug `squad`).
    await page.goto(`/b/${bid}/d/team/squad`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "team/squad", { timeout: LONG });
    await expect(page.getByRole("row").filter({ hasText: "Product research analyst" }).first()).toBeVisible({ timeout: LONG });
    expect(page.url()).toMatch(new RegExp(`/b/${UUID}/d/team/squad`));
  });
});
