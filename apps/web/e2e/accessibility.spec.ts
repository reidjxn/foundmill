import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { LONG, NORTHWIND_BUSINESS_ID, signIn } from "./helpers";

/**
 * axe on real pages (founder's legal checklist, Nov 15, 2026, items 13–15: alt text, color contrast, keyboard). The
 * outer product at 390 px and 1280 px signed out (the landing page, the Terms, the Privacy Policy, sign-in, and the
 * pages an email opens, with a link that no longer works, which is what a stranger can reach without a token), the
 * pages a founder uses on a phone at 390 px, and the main console screens at 1440 px. The rules are the stories' rules
 * (packages/dugout/.storybook/a11y-rules.ts); a project's public page with its Follow form is checked in
 * public-page.spec.ts, where one is published. Nothing here writes. Stack and commands: e2e/README.md.
 */

const SIGNED_OUT = ["/", "/terms", "/privacy", "/login", "/email/pause", "/a/not-a-token", "/i/not-a-token"] as const;
const PHONE = ["/public-profile", "/network", `/b/${NORTHWIND_BUSINESS_ID}/today`, `/b/${NORTHWIND_BUSINESS_ID}/inbox`] as const;
const CONSOLE = [
  `/b/${NORTHWIND_BUSINESS_ID}/today`,
  `/b/${NORTHWIND_BUSINESS_ID}/home`,
  `/b/${NORTHWIND_BUSINESS_ID}/inbox`,
  `/b/${NORTHWIND_BUSINESS_ID}/crm`,
  `/b/${NORTHWIND_BUSINESS_ID}/settings/business`,
] as const;

/** The page has its heading and its data: no skeleton, nothing streaming, the network quiet. */
async function ready(page: Page, path: string): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status() ?? 0, `${path} answers`).toBeLessThan(500);
  await expect(page.locator("h1").first()).toBeVisible({ timeout: LONG });
  await page.waitForLoadState("networkidle", { timeout: LONG }).catch(() => undefined);
  await expect(page.locator('[data-testid="screen-skeleton"]')).toHaveCount(0, { timeout: LONG });
  await page.evaluate(() => document.fonts.ready);
}

async function signedOut(browser: Browser, width: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height: 900 } });
  return { page: await context.newPage(), close: () => context.close() };
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  for (const width of [390, 1280]) {
    test(`the signed-out pages at ${width} px`, async ({ browser }) => {
      test.setTimeout(240_000);
      const { page, close } = await signedOut(browser, width);
      try {
        for (const path of SIGNED_OUT) {
          await ready(page, path);
          await expectNoAxeViolations(page, `${path} at ${width} px, signed out`);
        }
      } finally {
        await close();
      }
    });
  }

  test("a founder's pages on a phone at 390 px", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    for (const path of PHONE) {
      await ready(page, path);
      await expectNoAxeViolations(page, `${path} at 390 px`);
    }
  });

  test("the console's main screens at 1440 px", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page);
    for (const path of CONSOLE) {
      await ready(page, path);
      await expectNoAxeViolations(page, `${path} at 1440 px`);
    }
  });
});
