import { expect, test, type Page } from "@playwright/test";
import { LONG, openBusiness, openExplainer } from "./helpers";

/**
 * Product (BUILD §11.5) on the seeded Northwind Skincare: Vision, Roadmap (board and timeline), Sources and Research
 * read as founder copy and never cut or collide (the Specification editor and Changes have their own specs:
 * specification.spec.ts, e2e/tests/golden-path.spec.ts AC-11.5.2). Stack and commands: e2e/README.md.
 */
async function openProductTab(page: Page, tab: string, query = ""): Promise<void> {
  await openBusiness(page);
  const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
  await expect(product, "the seed gives Northwind a Product department").toBeVisible({ timeout: LONG });
  const href = (await product.getAttribute("href"))!;
  await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, `/d/$1/${tab}`) + query);
  await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", `product/${tab}`, { timeout: LONG });
}

test.describe("product", () => {
  test("Vision names who wrote each block and lists the outline quietly", async ({ page }) => {
    await openProductTab(page, "vision");
    const narrative = page.locator("[data-vision-narrative]");
    await expect(narrative).toBeVisible({ timeout: LONG });
    // Provenance is a name (the agent, or "You"), never the bare word "Agent".
    await expect(narrative.getByText("Agent", { exact: true })).toHaveCount(0);
    // The outline is a list of section names, not a cloud of chips.
    await expect(page.locator("[data-outline-section]").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Roadmap items in Now" })).toBeVisible();
  });

  test("Vision: the department's intro sits inside the first panel and the summary's first word is defined (UX plan §7.10, guidance on by default)", async ({ page }) => {
    await openProductTab(page, "vision");
    const button = page.locator("button[data-explainer='product/vision']");
    await expect(button).toBeVisible({ timeout: LONG });
    // No banner in the panel; the one button sits in the tab row and opens the three lines.
    await expect(page.locator("[data-panel-body] [data-explainer]")).toHaveCount(0);
    await expect(page.getByText("What this screen is for")).toHaveCount(0);
    const explainer = await openExplainer(page, "product/vision");
    await expect(explainer).toContainText("What your business is building.");
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    // The defined word carries the dotted underline; its definition opens on hover.
    const term = page.getByTestId("spec-summary").locator("[data-term='specification']");
    await expect(term).toBeVisible();
    await term.hover();
    await expect(page.locator("[data-definition-card]")).toContainText(/specification/i, { timeout: LONG });
    // Opening it marked the page read; the unread dot stays gone after a reload (remembered per account).
    await expect(button).not.toHaveAttribute("data-unread", /.*/);
    await page.reload();
    await expect(page.locator("button[data-explainer='product/vision']")).not.toHaveAttribute("data-unread", /.*/, { timeout: LONG });
  });

  test("Vision: a pinned paragraph's author link opens the agent, and the paragraph opens the Specification (audit #397)", async ({ page }) => {
    await openProductTab(page, "vision");
    // "Block" reads "paragraph" everywhere a founder reads (UX plan §7.11, C13).
    const pinned = page.getByRole("list", { name: "Pinned paragraphs" });
    await expect(page.getByRole("list", { name: "Pinned blocks" })).toHaveCount(0);
    await expect(pinned).toBeVisible({ timeout: LONG });
    // Nothing interactive sits inside a block's button.
    expect(await pinned.locator("[data-pinned-block] a, [data-pinned-block] button").count()).toBe(0);
    const author = pinned.locator("[data-pinned-block-meta] a[href*='/agents/']").first();
    test.skip((await author.count()) === 0, "no pinned block written by an agent in this seed");
    const href = (await author.getAttribute("href"))!;
    await author.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: LONG });
    await page.goBack();
    await page.locator("[data-pinned-block]").first().click();
    await expect(page).toHaveURL(/\/specification\?block=/, { timeout: LONG });
  });

  test("Specification and Roadmap: the demo founder's sign-off reads Signed off with its date (founder, 2026-10-18)", async ({ page }) => {
    await openProductTab(page, "specification");
    const spec = page.getByTestId("signoff-banner");
    await expect(spec).toHaveAttribute("data-signoff-status", "approved", { timeout: LONG });
    await expect(spec.getByTestId("signoff-pill")).toContainText(/^Signed off [A-Z][a-z]{2} \d{1,2}, \d{4} · v\d+$/);
    await expect(spec.getByTestId("signoff-approve")).toHaveCount(0);
    await openProductTab(page, "roadmap");
    const roadmap = page.getByTestId("signoff-banner");
    await expect(roadmap).toHaveAttribute("data-signoff-status", "approved", { timeout: LONG });
    await expect(roadmap.getByTestId("signoff-pill")).toContainText(/^Signed off [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await openProductTab(page, "vision");
    await expect(page.getByTestId("signoff-summary")).toHaveText("Specification: signed off · Roadmap: signed off", { timeout: LONG });
    // "Sign-off" is a defined word in the banner's title (UX plan §7.10 column heads and panel titles).
    await openProductTab(page, "roadmap");
    await expect(page.getByTestId("signoff-banner").locator("[data-term='sign_off']")).toBeVisible({ timeout: LONG });
  });

  test("Roadmap board: owners by name, linked blocks inside their cards", async ({ page }) => {
    await openProductTab(page, "roadmap");
    const board = page.locator("[data-roadmap-board]");
    await expect(board).toBeVisible({ timeout: LONG });
    await expect(board.locator("[data-roadmap-item]").first()).toBeVisible({ timeout: LONG });
    // Never the literal placeholder "Department".
    await expect(board.getByText("Department", { exact: true })).toHaveCount(0);
    for (const card of await board.locator("[data-roadmap-item]").all()) {
      const box = (await card.boundingBox())!;
      for (const linked of await card.locator("[data-linked-block]").all()) {
        const l = (await linked.boundingBox())!;
        expect(l.x + l.width, "a linked spec block stays inside its card").toBeLessThanOrEqual(box.x + box.width + 1);
      }
    }
  });

  test("Roadmap timeline: three-letter months and a Today tag that never sits on a month", async ({ page }) => {
    await openProductTab(page, "roadmap", "?view=timeline");
    const timeline = page.locator("[data-roadmap-timeline]");
    await expect(timeline).toBeVisible({ timeout: LONG });
    await expect(timeline).not.toContainText(/\bSept\b/);
    const today = timeline.locator("[data-today-tag]");
    await expect(today).toBeVisible();
    const t = (await today.boundingBox())!;
    for (const month of await timeline.locator(".t-label.absolute").all()) {
      const m = (await month.boundingBox())!;
      const overlaps = m.x < t.x + t.width && t.x < m.x + m.width && m.y < t.y + t.height && t.y < m.y + m.height;
      expect(overlaps, `Today overlaps "${await month.innerText()}"`).toBe(false);
    }
  });

  test("Research: coverage in whole numbers with full section names; notes without a summary offer the source", async ({ page }) => {
    await openProductTab(page, "research");
    const coverage = page.locator("[data-coverage]");
    await expect(coverage.first()).toBeVisible({ timeout: LONG });
    for (const row of await coverage.all()) await expect(row.locator("span").last()).toHaveText(/^\d+$/);
    const notes = page.getByRole("list", { name: "Research notes" });
    await expect(notes).toBeVisible();
    await expect(notes).not.toContainText(/Not summari[sz]ed yet/);
    const unsummarised = notes.locator("[data-read-source]");
    if (await unsummarised.count()) await expect(unsummarised.first()).toHaveText(/Read the source/);
    // The seeded sources carry what the Source Watcher writes: sections they back and the topics they raise.
    const counts = await coverage.locator("span:last-child").allInnerTexts();
    expect(counts.some((c) => Number(c) > 0), "at least one spec section is backed by a source").toBe(true);
    await expect(page.getByRole("list", { name: "Topics" }).getByRole("listitem").first()).toBeVisible();
  });

  test("Sources: seeded sources say what they say and link spec blocks; a new link is read by the Source Watcher", async ({ page }) => {
    await openProductTab(page, "sources");
    const table = page.getByRole("grid", { name: "Sources" }).or(page.getByLabel("Sources", { exact: true })).first();
    await expect(table).toBeVisible({ timeout: LONG });
    // The seeded interview reads as the Source Watcher wrote it: a summary and the spec blocks it touches.
    const interview = table.getByRole("row").filter({ hasText: "Customer interview: reactive-skin panel" });
    await expect(interview).toContainText(/quarterly refill under £35/, { timeout: LONG });
    expect(await interview.getByRole("button").count(), "the interview links spec blocks").toBeGreaterThan(0);
    // Adding a link shows it at once, waiting for (or already read by) the Source Watcher; read, it says what the page says.
    const suffix = Date.now().toString(36);
    await page.getByRole("button", { name: "Add source" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a source" });
    await dialog.getByLabel(/Link/).fill(`https://example.com/e2e-pricing-${suffix}`);
    await dialog.getByRole("button", { name: "Add source" }).click();
    await expect(dialog).toBeHidden({ timeout: LONG });
    const added = table.getByRole("row").filter({ hasText: new RegExp(suffix, "i") });
    await expect(added).toBeVisible({ timeout: LONG });
    await expect(added).toContainText(/Waiting for the Source Watcher|per month/, { timeout: LONG });
    // A source added by mistake goes again from the right-click menu, after a confirmation (TPD-30).
    await added.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove source" }).click();
    const confirm = page.getByRole("dialog", { name: "Remove this source?" });
    await confirm.getByRole("button", { name: "Remove source" }).click();
    await expect(confirm).toBeHidden({ timeout: LONG });
    await expect(added).toHaveCount(0, { timeout: LONG });
    await expect(page.getByTestId("module-screen")).not.toContainText(/\b1 sources\b/);
  });

  test("Roadmap board: a card moved to another column and back returns to its place (TPD-34)", async ({ page }) => {
    await openProductTab(page, "roadmap");
    const later = page.getByRole("list", { name: "Later items" });
    await expect(later.locator("[data-roadmap-item]").first()).toBeVisible({ timeout: LONG });
    const before = await later.locator("[data-roadmap-item]").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-roadmap-item")));
    const last = later.locator(`[data-roadmap-item="${before.at(-1)}"]`);
    await last.focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByRole("list", { name: "Next items" }).locator(`[data-roadmap-item="${before.at(-1)}"]`)).toBeVisible({ timeout: LONG });
    await page.getByRole("list", { name: "Next items" }).locator(`[data-roadmap-item="${before.at(-1)}"]`).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(later.locator(`[data-roadmap-item="${before.at(-1)}"]`)).toBeVisible({ timeout: LONG });
    await expect.poll(() => later.locator("[data-roadmap-item]").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-roadmap-item")))).toEqual(before);
  });

  test("Sources: the default view fits the panel at 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProductTab(page, "sources");
    const table = page.getByRole("table", { name: "Sources" }).or(page.getByLabel("Sources", { exact: true })).first();
    await expect(table).toBeVisible({ timeout: LONG });
    const panel = (await page.getByTestId("module-screen").boundingBox())!;
    const last = page.getByRole("columnheader").last();
    const box = (await last.boundingBox())!;
    expect(box.x + box.width, "the last column is not cut by the panel").toBeLessThanOrEqual(panel.x + panel.width);
  });
});
