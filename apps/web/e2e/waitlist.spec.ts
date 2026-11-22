import { expect, test } from "@playwright/test";
import { LONG, TAP_TARGET_PX } from "./helpers";

/**
 * The public waitlist page (docs/holistic-plan/WP-14-behavior-brief.md T15). Stack and commands: e2e/README.md.
 *
 * Signed out, at 390 px: `/waitlist` renders in place (no sign-in redirect, no request for a larger window), says
 * "Foundmill opens in batches", and shows either a real batch ("Batch N opens|opened <US date>. <n> places…") or, on a
 * database with no batch set (the shared stack's seed sets none), the plain statement that the next batch has no date
 * and no number at all. One way on, "Join the waitlist", to the sign-in page, at least 44 px tall; nothing scrolls
 * sideways. Indexing: where robots.txt opens this page alone (sign-up closed on the production origin, which a stack with
 * no NEXT_PUBLIC_APP_URL counts as) the page says "index, follow", the rule is exactly `Allow: /waitlist$` beside
 * `Disallow: /`, and the sitemap names this page only; on any other origin the page is noindex and everything is closed.
 */
const PHONE = { width: 390, height: 844 };

test.describe("the public waitlist page", () => {
  test("signed out at 390 px: a real batch or none, one way on, no sideways scroll", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    await page.goto("/waitlist");
    const panel = page.getByTestId("waitlist-page");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(page).toHaveURL(/\/waitlist$/);
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Foundmill opens in batches" })).toBeVisible();
    await expect(page).toHaveTitle(/opens in batches/);

    const status = await panel.getAttribute("data-batch");
    expect(["batch", "none"]).toContain(status);
    if (status === "batch") {
      await expect(panel.getByTestId("waitlist-batch")).toHaveText(/^Batch \d+ (opens [A-Z][a-z]{2} \d{1,2}, \d{4}\. [\d,]+ places?\.|opened [A-Z][a-z]{2} \d{1,2}, \d{4}\. [\d,]+ places? left\.)$/);
    } else {
      const none = panel.getByTestId("waitlist-no-batch");
      await expect(none).toHaveText("The next batch has no date yet. Join the waitlist and your place is held for it.");
      // No batch set: no number of any kind is shown.
      expect(await panel.innerText()).not.toMatch(/\d/);
    }

    const join = panel.getByRole("link", { name: "Join the waitlist" });
    await expect(join).toHaveAttribute("href", "/login");
    expect((await join.boundingBox())!.height).toBeGreaterThanOrEqual(TAP_TARGET_PX);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/waitlist$/);
    await join.click();
    await page.waitForURL(/\/login/, { timeout: LONG });
    await context.close();
  });

  test("at desktop width the same page renders, and its robots tag agrees with robots.txt and the sitemap", async ({ page, request }) => {
    await page.goto("/waitlist");
    await expect(page.getByTestId("waitlist-page")).toBeVisible({ timeout: LONG });
    const meta = await page.locator('meta[name="robots"]').getAttribute("content");
    const robots = await (await request.get("/robots.txt")).text();
    const sitemap = await (await request.get("/sitemap.xml")).text();
    if (/^Allow: \/$/m.test(robots)) {
      // Sign-up is open on this stack: everything is indexable (landing.spec.ts covers it) and the sitemap lists the page.
      expect(meta).toBe("index, follow");
      expect(sitemap).toContain("/waitlist</loc>");
    } else if (/^Allow: \/waitlist\$$/m.test(robots)) {
      // Sign-up closed on the production origin: this page alone.
      expect(meta).toBe("index, follow");
      expect(robots).toMatch(/^Disallow: \/$/m);
      expect(robots.match(/^Allow: .*$/gm)).toEqual(["Allow: /waitlist$", "Allow: /_next/static/", "Allow: /opengraph-image.png"]);
      expect(sitemap.match(/<loc>/g)).toHaveLength(1);
      expect(sitemap).toContain("/waitlist</loc>");
    } else {
      // Any other origin: closed, and the page says noindex.
      expect(meta).toMatch(/noindex/);
      expect(robots).toMatch(/^Disallow: \/$/m);
      expect(robots).not.toMatch(/^Allow:/m);
    }
  });
});
