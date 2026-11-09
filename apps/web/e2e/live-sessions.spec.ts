import { expect, test } from "@playwright/test";
import { LONG, departmentBase, openBusiness, setBuilderView } from "./helpers";

// Builder view on for this file (it reads the tiles' tokens and ETA); global-setup.ts starts every run with it off. Restored afterwards.
let builderViewBefore = false;
test.beforeAll(async ({ playwright }) => {
  builderViewBefore = await setBuilderView(playwright, true);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, builderViewBefore);
});

/**
 * Development › Live sessions (BUILD §11.6) on the seeded Northwind Skincare: the tiles, the focused tile with its
 * replay strip and Nudge, and costs in the business's own currency. Stack and commands: e2e/README.md.
 */
test.describe("live sessions", () => {
  test("a focused tile keeps its footer clear of the replay strip; costs are in pounds", async ({ page }) => {
    test.setTimeout(180_000); // the elapsed clock ticks by the minute once a session has run for an hour
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
    // The sidebar lists areas, not departments: the seeded Development keeps the module's slug.
    await page.goto(`${departmentBase("development")}/training-ground`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/training-ground", { timeout: LONG });
    const tiles = page.locator("[data-tile-id]");
    await expect(tiles.first(), "the seed has agents working").toBeVisible({ timeout: LONG});

    // Guidance on (the product default): the department's intro sits in the panel's body above the tiles, and every
    // tile carries a visible "…" so hovering is never the only way to its controls (UX plan §7.10, §7.12).
    const explainer = page.locator("[data-explainer='development/live-sessions']");
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText("Each tile is one agent on one task.");
    expect(await explainer.evaluate((el) => !!el.closest("[data-panel-body]"))).toBe(true);
    expect(await page.locator("[data-tile-actions]").count()).toBe(await tiles.count());

    // Northwind runs in GBP: no tile shows a cost in euros.
    await expect(page.getByRole("region", { name: "Agent tiles" })).not.toContainText("€");

    // Tile headers never clip: agent names and task titles read in full (FitText may step them down, not cut them).
    const cut = await page.locator("[data-tile-header] [data-fit]").evaluateAll((els) => els.filter((e) => e.getAttribute("data-fit") === "truncated").map((e) => e.textContent));
    expect(cut, "no tile header name or task ends in an ellipsis at 1280 px").toEqual([]);
    // Every waiting tile says something of its own: no empty line repeats across tiles.
    const lines = await page.locator("[data-specialist-empty], [data-terminal-empty]").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
    expect(new Set(lines).size, `empty tiles repeat a line: ${lines.join(" | ")}`).toBe(lines.length);
    // Only sourcing work talks about RFQs: an empty specialist tile never says "no RFQs sent" by default (TPD-23).
    await expect(page.locator("[data-specialist-empty]").filter({ hasText: /no RFQs sent/ })).toHaveCount(0);
    // Every cost keeps its Estimate label, however small the tile (SOAK-07).
    const footers = page.getByTestId("tile-footer");
    const footerCount = await footers.count();
    for (let i = 0; i < footerCount; i += 1) await expect(footers.nth(i)).toContainText("Estimate");
    // A started session no worker has picked up says Queued and is counted apart from running ones (SOAK-08).
    const queuedTiles = await page.locator("[data-tile-queued]").count();
    if (queuedTiles) await expect(page.getByTestId("ground-counts")).toContainText(`${queuedTiles} queued`);
    // Elapsed time ticks while a session runs, without new events (VSOAK2-X1). The clock's resolution follows the
    // session's age (formatDuration: seconds, then minutes, then hours once past a day), so only a clock under a day old
    // can visibly move within the poll; a seeded session older than that shows "1d 4h" and is checked for shape only
    // (the per-second tick itself is unit-tested in packages/modules training-ground.test.tsx).
    const clocks = page.locator("[data-testid=tile-footer] [title=Elapsed]");
    const clockTexts = (await clocks.allTextContents()).map((t) => t.trim());
    for (const t of clockTexts) expect(t, "an elapsed clock reads as a duration").toMatch(/^(\d+s|\d+m \d{2}s|\d+h \d{2}m|\d+d \d+h)$/);
    const fine = clockTexts.findIndex((t) => !/d /.test(t));
    if (fine >= 0) {
      const clock = clocks.nth(fine);
      const before = clockTexts[fine];
      await expect.poll(async () => (await clock.textContent())?.trim(), { timeout: 70_000, message: "the elapsed clock moves on its own" }).not.toBe(before);
    }

    // Focus the first tile: it takes two thirds of the grid, the replay strip and Nudge appear under it.
    await tiles.first().click({ position: { x: 160, y: 120 } });
    const focused = page.locator("[data-tile-id][data-focused=true]");
    await expect(focused).toBeVisible({ timeout: LONG });
    const strip = page.locator("[aria-label^='Replay of']").first();
    await expect(strip).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("nudge-menu")).toBeVisible();
    // The focused tile ends above the strip (it used to grow under it and lose its footer).
    const tileBox = (await focused.boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    expect(tileBox.y + tileBox.height, "the focused tile's bottom edge sits above the replay strip").toBeLessThanOrEqual(stripBox.y + 1);
  });

  test("a nudge that reached no session says so instead of showing the agent's answer (audit OL-04, TPD-16)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
    await page.goto(`${departmentBase("development")}/training-ground`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/training-ground", { timeout: LONG });
    // The seeded sessions have no workflow behind them, so no nudge can arrive.
    const tiles = page.locator("[data-tile-id]");
    await expect(tiles.first()).toBeVisible({ timeout: LONG });
    await tiles.first().click({ position: { x: 160, y: 120 } });
    await page.getByTestId("nudge-menu").first().click();
    await page.getByRole("menuitem").first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Not delivered" })).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("nudge-ack")).toHaveCount(0);
  });
});
