import { expect, test } from "@playwright/test";
import { LONG, areaTabBar, departmentBase, openBusiness, settled } from "./helpers";

/**
 * Foundmill Sites (WP-07). The Playwright stack runs with SITES_DOMAIN unset, so this spec holds the package's "Done
 * when" item 4: nothing in the product mentions a site. A project gets the Product › Site tab only once the platform
 * made it a site (`repos.sites.ensure`, reached only where SITES_DOMAIN is set), so the Product area offers no Site tab,
 * inline or behind "More detail". The golden path with SITES_DOMAIN set (a release, Publish, the address answering)
 * is completed in WP-07 T10, once site sessions (T3) save releases; until then apps/api `site.test.ts` and
 * packages/modules `site.test.tsx` cover the tab and Publish. Stack and commands: e2e/README.md.
 */
test.describe("Foundmill Sites while SITES_DOMAIN is unset", () => {
  test("the Product area offers no Site tab", async ({ page }) => {
    const bid = await openBusiness(page);
    await page.goto(`${departmentBase("product", bid)}/specification`);
    await settled(page);
    const bar = areaTabBar(page, "Product");
    await expect(bar).toBeVisible({ timeout: LONG });
    expect(await bar.getByRole("tab").allInnerTexts()).not.toContain("Site");
    const more = page.getByRole("button", { name: /^More detail/ });
    if (await more.isVisible()) {
      await more.click();
      await expect(page.getByTestId("more-detail-menu")).toBeVisible();
      await expect(page.getByTestId("more-detail-menu").getByRole("menuitem", { name: /^Site$/ })).toHaveCount(0);
    }
  });
});
