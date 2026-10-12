import { expect, test } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Development › Live sessions (BUILD §11.6) on the seeded Northwind Skincare: the tiles, the focused tile with its
 * replay strip and Nudge, and costs in the business's own currency. Stack and commands: e2e/README.md.
 */
test.describe("live sessions", () => {
  test("a focused tile keeps its footer clear of the replay strip; costs are in pounds", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page);
    const dev = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /development/i }).first();
    await expect(dev, "the seed gives Northwind a Development department").toBeVisible({ timeout: LONG });
    const href = (await dev.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/training-ground"));
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/training-ground", { timeout: LONG });
    const tiles = page.locator("[data-tile-id]");
    await expect(tiles.first(), "the seed has agents working").toBeVisible({ timeout: LONG });

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
    // Elapsed time ticks while a session runs, without new events (VSOAK2-X1).
    const clock = page.locator("[data-testid=tile-footer] [title=Elapsed]").first();
    if (await clock.count()) {
      const before = await clock.textContent();
      await expect.poll(async () => clock.textContent(), { timeout: 5_000, message: "the elapsed clock moves on its own" }).not.toBe(before);
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
});
