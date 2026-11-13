import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG } from "./helpers";

/**
 * The Terms of Service and the Privacy Policy (founder, 2026-11-13): `/terms` and `/privacy` signed out at 390 px and
 * 1280 px. Each answers 200 with its title, the date, the contents and the sections; is indexable with its own title and
 * canonical address; has no horizontal scroll; every contents link lands on its section; and the bar links the other
 * document. The landing page's footer and the sign-in page link both. A signed-in founder reads them too.
 *
 * With `E2E_UX_AUDIT=1` the pages are also saved as docs/ux-audit/44-privacy-390.png and 45-terms-1280.png (device
 * scale 2).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(here, "../../../docs/ux-audit");

async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 600, isMobile: width < 600 });
  return { page: await context.newPage(), close: () => context.close() };
}

const DOCS = [
  { path: "/terms", title: "Terms of Service", other: "Privacy", otherPath: "/privacy", shot: "45-terms-1280.png" },
  { path: "/privacy", title: "Privacy Policy", other: "Terms", otherPath: "/terms", shot: "44-privacy-390.png" },
] as const;

for (const doc of DOCS) {
  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`${doc.path} at ${width} px: public, indexable, no horizontal scroll, contents land on their sections`, async ({ browser }) => {
      const { page, close } = await visitor(browser, width, height);
      try {
        const res = await page.goto(doc.path);
        expect(res?.status()).toBe(200);
        await expect(page.locator("[data-legal-page]")).toBeVisible({ timeout: LONG });
        await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(doc.title);
        await expect(page.locator("[data-legal-updated]")).toHaveText(/^Last updated [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
        await expect(page).toHaveTitle(`${doc.title} · Foundmill`);
        const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => e.getAttribute("content") ?? ""));
        expect(robots).toEqual(["index, follow"]);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${doc.path}$`));

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);

        // Every contents entry is an anchor to a section heading of the same name.
        const entries = page.locator("[data-legal-contents] a");
        const n = await entries.count();
        expect(n).toBeGreaterThan(8);
        for (let i = 0; i < n; i++) {
          const href = (await entries.nth(i).getAttribute("href"))!;
          await expect(page.locator(`h2${href}`)).toContainText((await entries.nth(i).textContent())!);
          if (width < 600) expect((await entries.nth(i).boundingBox())!.height, `${href} is a 44 px target`).toBeGreaterThanOrEqual(44);
        }
        const last = entries.nth(n - 1);
        const target = (await last.getAttribute("href"))!;
        await last.click();
        await expect(page).toHaveURL(new RegExp(`${target}$`));
        await expect(page.locator(`h2${target}`)).toBeInViewport();

        // The bar links the other document.
        await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: doc.other }).click();
        await expect(page).toHaveURL(new RegExp(`${doc.otherPath}$`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(DOCS.find((d) => d.path === doc.otherPath)!.title);

        if (process.env.E2E_UX_AUDIT === "1" && doc.shot.includes(String(width))) {
          await page.goto(doc.path);
          await page.screenshot({ path: path.join(AUDIT_DIR, doc.shot), fullPage: false });
        }
      } finally {
        await close();
      }
    });
  }
}

test("the landing page's footer and the sign-in page link the Terms and the Privacy Policy", async ({ browser }) => {
  const { page, close } = await visitor(browser, 1440, 900);
  try {
    await page.goto("/");
    await expect(page.getByTestId("landing-terms")).toHaveAttribute("href", "/terms");
    await expect(page.getByTestId("landing-privacy")).toHaveAttribute("href", "/privacy");
    await page.goto("/login");
    const legal = page.getByTestId("login-legal");
    await expect(legal).toContainText("18 or older");
    await expect(legal.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await legal.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
  } finally {
    await close();
  }
});

test("a signed-in founder reads the Terms too (no redirect to their business)", async ({ page }) => {
  const res = await page.goto("/terms");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of Service");
});
