import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, settled } from "./helpers";

/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1): Product › Public page in the console (fields with
 * counts, a phone-width preview, the address, Publish behind a confirmation that says what becomes public), Today's
 * quiet line before it is live, and `/p/<slug>` signed out at 390 px and 1280 px (indexable, its own title and share
 * card, no horizontal scroll, 44 px tap targets), gone once it is taken down. A throwaway business, since a sample
 * business never has a public page. Stack and commands: e2e/README.md.
 *
 * With `E2E_UX_AUDIT=1` the public page is also saved as docs/ux-audit/40-project-page-390.png and
 * 41-project-page-1280.png (device scale 2).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(here, "../../../docs/ux-audit");

const PITCH = "Bike repairs at your door, booked in a minute";
const ABOUT = "We come to you with a van full of parts and fix the bike where it stands.\n\nMost repairs take under an hour, and you only pay once it rides well.";
const FOR_WHOM = "People who ride to work and cannot lose a day to a repair shop.";

/** A signed-out visitor's page at `width`. */
async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 600, isMobile: width < 600 });
  return { page: await context.newPage(), close: () => context.close() };
}

async function expectPublicPage(page: Page, pagePath: string, width: number, shot: string): Promise<void> {
  const res = await page.goto(pagePath);
  expect(res?.status()).toBe(200);
  const article = page.locator("[data-project-page]");
  await expect(article).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PITCH);
  await expect(article.getByText("Who it is for")).toBeVisible();
  await expect(article.getByText(FOR_WHOM)).toBeVisible();
  await expect(article.getByText("Being built")).toBeVisible();
  await expect(article.getByText(/^Published [A-Z][a-z]{2} \d{1,2}, \d{4}$/)).toBeVisible();
  await expect(article.locator("[data-project-about] p")).toHaveCount(2);
  // Nothing to fill in: the page offers no form.
  await expect(page.locator("form, input, textarea")).toHaveCount(0);
  // No horizontal scroll, at 390 px included.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
  // Every link is a 44 px target; no text under the design system's 11 px floor.
  const made = page.getByRole("link", { name: "Made with Foundmill" });
  await expect(made).toHaveAttribute("href", "/");
  expect((await made.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const smallest = await article.evaluate((root) => Math.min(...[...root.querySelectorAll<HTMLElement>("p, h1, h2, span, a")].filter((e) => e.textContent?.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))));
  expect(smallest).toBeGreaterThanOrEqual(11);
  if (process.env.E2E_UX_AUDIT) {
    // The dev server's own badge is not part of the page.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: path.join(AUDIT_DIR, shot), fullPage: true });
  }
}

test.describe("public page", () => {
  test("write it, preview it at phone width, publish it after a confirmation, open it signed out at 390 and 1280 px, take it down", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const bid = await commitThrowaway(page, `Doorstep Bikes ${Date.now().toString(36)}`);

    // Today: one quiet line while nothing is live, to the tab.
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    const note = page.getByTestId("public-page-note");
    await expect(note).toBeVisible({ timeout: LONG });
    await expect(note.getByRole("link")).toHaveText(/Your project's public page is ready to check/);
    await note.getByRole("link").click();
    await page.waitForURL(new RegExp(`/b/${bid}/d/[^/]+/public-page$`), { timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);

    // The tab sits right after Specification in the Product area.
    const tabs = page.getByRole("tablist").first().getByRole("tab");
    const labels = await tabs.allInnerTexts();
    expect(labels.indexOf("Public page")).toBe(labels.indexOf("Specification") + 1);

    const editor = page.getByTestId("public-page-editor");
    await expect(editor).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("page-state")).toHaveText(/Not published yet/);
    await editor.getByLabel(/One-line pitch/).fill(PITCH);
    await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
    await editor.getByRole("textbox", { name: /^Who it is for/ }).fill(FOR_WHOM);
    await editor.getByRole("button", { name: "Being built" }).click();
    await expect(editor.locator("[data-count-for$='-pitch']")).toHaveText(`${PITCH.length} / 140`);
    // The preview is the public page itself, at phone width.
    const preview = page.getByTestId("public-page-preview");
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(PITCH);
    expect(Math.round((await preview.locator("[data-project-page]").boundingBox())!.width)).toBeLessThanOrEqual(390);

    // Publish asks first and says what becomes public.
    await editor.getByRole("button", { name: "Publish", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Publish your public page?" })).toBeVisible();
    await expect(dialog).toContainText("Anyone with the link can read the project's name and logo, its one-line pitch, about, who it is for and the stage. You can take it down any time.");
    await dialog.getByTestId("page-confirm-publish").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("page-state")).toHaveText(/Live since [A-Z][a-z]{2} \d{1,2}, \d{4}/, { timeout: LONG });
    await expect(editor.getByRole("button", { name: "Copy link" })).toBeVisible();
    const url = (await page.getByTestId("page-url").innerText()).trim();
    const pagePath = new URL(url).pathname;
    expect(pagePath).toMatch(/^\/p\/[a-z0-9-]{3,40}$/);
    await expect(editor.getByRole("link", { name: "Open" })).toHaveAttribute("href", url);

    // Signed out, on a phone and on a desktop.
    const phone = await visitor(browser, 390, 844);
    try {
      await expectPublicPage(phone.page, pagePath, 390, "40-project-page-390.png");
      // Indexable, with its own title and share card.
      await expect(phone.page).toHaveTitle(/^Doorstep Bikes [a-z0-9]+: Bike repairs at your door/);
      await expect(phone.page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
      await expect(phone.page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Bike repairs at your door/);
      await expect(phone.page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/p\/[a-z0-9-]+\/opengraph-image/);
      await expect(phone.page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/p\/[a-z0-9-]+$/);
      // Made with Foundmill goes to the landing page.
      await phone.page.getByRole("link", { name: "Made with Foundmill" }).click();
      await phone.page.waitForURL(/\/$/, { timeout: LONG });
    } finally {
      await phone.close();
    }
    const desktop = await visitor(browser, 1280, 800);
    try {
      await expectPublicPage(desktop.page, pagePath, 1280, "41-project-page-1280.png");
    } finally {
      await desktop.close();
    }

    // Changes: the state line says so until they are published.
    await editor.getByLabel(/One-line pitch/).fill(`${PITCH}, any day`);
    await expect(page.getByTestId("page-state")).toHaveText(/Live, with changes not yet published/);
    await editor.getByRole("button", { name: "Save draft" }).click();
    await expect(editor.getByText("Draft saved")).toBeVisible({ timeout: LONG });

    // Take it down: the address answers not found, the draft stays.
    await editor.getByRole("button", { name: "Take it down" }).click();
    await expect(page.getByTestId("page-state")).toHaveText(/Not published yet/, { timeout: LONG });
    await expect(editor.getByLabel(/One-line pitch/)).toHaveValue(`${PITCH}, any day`);
    const gone = await visitor(browser, 390, 844);
    try {
      const res = await gone.page.goto(pagePath);
      expect(res?.status()).toBe(404);
      await expect(gone.page.locator("[data-project-page]")).toHaveCount(0);
    } finally {
      await gone.close();
    }
  });

  test("an unknown address is a not-found page, signed out, at phone width", async ({ browser }) => {
    const v = await visitor(browser, 390, 844);
    try {
      const res = await v.page.goto("/p/no-such-project-here");
      expect(res?.status()).toBe(404);
      await expect(v.page.getByTestId("needs-larger-window")).toHaveCount(0);
      await expect(v.page.getByTestId("public-page-not-found")).toBeVisible();
      await expect(v.page.getByRole("link", { name: "Go to Foundmill" })).toHaveAttribute("href", "/");
    } finally {
      await v.close();
    }
  });
});
