import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, signIn } from "./helpers";

/** Milestones (BUILD §11.4; the old `/trophies` path forwards here) on the seeded Northwind Skincare. Stack: e2e/README.md. */
test.describe("milestones", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("/trophies forwards to /milestones, which shows the eight milestones and the timeline", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/trophies`);
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/milestones$`), { timeout: LONG });
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    // Milestones is a Plan tab (founder areas, 2026-11-09): Roadmap beside it, and the Plan item lit.
    const bar = page.getByRole("tablist", { name: "Plan tabs" });
    await expect(bar.getByRole("tab")).toHaveText(["Roadmap", "Milestones"]);
    await expect(bar.getByRole("tab", { name: "Milestones" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-testid=app-shell] nav [data-sidebar-item='area-plan']")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-trophy]")).toHaveCount(8);
    await expect(page.getByTestId("milestones-timeline")).toBeVisible();
    // Guidance on (the product default): the timeline panel's one-sentence help tip, named after its title.
    await expect(page.getByTestId("milestones-timeline").getByRole("button", { name: "About Releases, decisions and launches" })).toBeVisible();
    // Two years of seeded wins light several milestones up.
    expect(await page.locator("[data-trophy][data-achieved]").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("milestones-screen")).toHaveAttribute("data-won", /^[1-8]$/);
    // Money milestones are in the business's own currency: Northwind keeps its books in pounds, never euros.
    await expect(page.locator("[data-trophy]").filter({ hasText: "MRR" }).first()).toContainText("£");
    await expect(page.locator("[data-trophy]").filter({ hasText: "€" })).toHaveCount(0);
    // Northwind sells a physical product (no subscriptions): a reached "MRR" milestone is trailing revenue, labeled Estimate.
    const reachedMrr = page.locator("[data-trophy][data-achieved]").filter({ hasText: "MRR" });
    for (const card of await reachedMrr.all()) await expect(card.locator("[data-provenance='estimate']")).toBeVisible();
  });

  test("a reached milestone opens its Customer Update when one is recorded", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    const reached = page.locator("[data-trophy][data-achieved] button").first();
    await expect(reached, "the seed gives Northwind at least one reached milestone").toBeVisible();
    await reached.click();
    // Either the replay of the win that reached it, or the note that none was recorded (Radix toasts repeat their title for the live region).
    await expect(page.getByTestId("journey-screen").or(page.getByText("No replay recorded for this milestone").first())).toBeVisible({ timeout: LONG });
    // Opened from Milestones, the replay goes back to Milestones.
    if (await page.getByTestId("journey-screen").count()) {
      await expect(page.getByTestId("journey-back")).toHaveText(/Milestones/);
      await page.getByTestId("journey-back").click();
      await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/milestones`), { timeout: LONG });
    }
  });
});

test.describe("milestones on a LIVE business", () => {
  const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    test(`every Share button is clickable where it is drawn, nothing covers it (${size.width}×${size.height})`, async ({ page }) => {
      await page.setViewportSize(size);
      await signIn(page);
      await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/milestones`);
      await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
      const shares = page.locator("[data-trophy-share]");
      const n = await shares.count();
      expect(n, "Ledgerly is LIVE and has reached milestones to share").toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const share = shares.nth(i);
        await share.scrollIntoViewIfNeeded();
        // The element at the button's center is the button (or inside it): not the next row's card, not the footer.
        const hit = await share.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!at && (at === el || el.contains(at));
        });
        expect(hit, `Share button ${i + 1} is not covered`).toBe(true);
      }
      await shares.first().click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: LONG });
    });
  }
});
