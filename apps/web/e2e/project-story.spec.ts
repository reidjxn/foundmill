import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, settled, toast } from "./helpers";

/**
 * A project's story and its milestone cards (docs/NETWORK.md F2 and F3; docs/THESIS_REVIEW.md package 5.3; migration
 * 0087). A throwaway project publishes its page, which records the milestone "Page live"; Plan › Milestones lists it
 * reached, first; its founder shows it on the page with one press ("On your page", Hide, Copy card link). Signed out,
 * at 390 px and 1280 px: `/p/<slug>/story` ("How ‹name› was built": the date, the words, "Verified by Foundmill", no
 * horizontal scroll, 44 px link targets, no text under 11 px, indexable with its own title) and the card at `/m/<id>`
 * (noindex, its own title, both share images). The project page's mark now leads to the story. Hidden again, the story
 * and the card answer not found and the mark goes back to the landing page. A throwaway business, since a sample
 * business shows nothing in public. Stack and commands: e2e/README.md.
 *
 * With `E2E_UX_AUDIT=1` the story and the card are also saved as docs/ux-audit/46-project-story-390.png,
 * 47-project-story-1280.png, 48-milestone-card-390.png and 49-milestone-card-1280.png (device scale 2), and the card's
 * two share images as 50-milestone-card-wide.png and 51-milestone-card-tall.png.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(here, "../../../docs/ux-audit");

const PITCH = "Bike repairs at your door, booked in a minute";
const ABOUT = "We come to you with a van full of parts and fix the bike where it stands.";
const US_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/** A signed-out visitor's page at `width`. */
async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 600, isMobile: width < 600 });
  return { page: await context.newPage(), close: () => context.close() };
}

/** What every public page here must hold at any width: no sideways scroll, 44 px links, no text under 11 px, never the desktop-only notice. */
async function expectFitsSmallScreens(page: Page, root: string, width: number): Promise<void> {
  await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
  const links = page.locator(`${root} a`);
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) expect((await links.nth(i).boundingBox())!.height, `link ${i + 1} tap target at ${width} px`).toBeGreaterThanOrEqual(44);
  const smallest = await page.locator(root).evaluate((el) => Math.min(...[...el.querySelectorAll<HTMLElement>("p, h1, h2, span, a, time")].filter((e) => e.textContent?.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))));
  expect(smallest, `smallest text at ${width} px`).toBeGreaterThanOrEqual(11);
}

async function shot(page: Page, file: string): Promise<void> {
  if (!process.env.E2E_UX_AUDIT) return;
  // The dev server's own badge is not part of the page.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: path.join(AUDIT_DIR, file), fullPage: true });
}

async function expectStory(page: Page, slug: string, name: string, width: number, file: string): Promise<void> {
  const res = await page.goto(`/p/${slug}/story`);
  expect(res?.status()).toBe(200);
  const story = page.locator("[data-project-story]");
  await expect(story).toBeVisible({ timeout: LONG });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`How ${name} was built`);
  await expect(story.locator("[data-story-note]")).toHaveText("Foundmill recorded each of these when it happened. None was typed in.");
  // One milestone, the one the founder showed: its date, its words and the proof (an icon and the words).
  const items = story.getByRole("list", { name: "Milestones" }).getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first().locator("time")).toHaveText(US_DATE);
  await expect(items.first().getByRole("heading", { level: 2 })).toHaveText("Page live");
  const verified = items.first().locator("[data-verified]");
  await expect(verified).toHaveText("Verified by Foundmill");
  await expect(verified.locator("svg")).toHaveCount(1);
  // The way back, and the free plan's one small line.
  await expect(story.locator("[data-story-project]")).toHaveAttribute("href", `/p/${slug}`);
  await expect(story.getByRole("link", { name: `See ${name}` })).toHaveAttribute("href", `/p/${slug}`);
  const foot = story.locator("footer[data-project-mark]");
  await expect(foot).toHaveAttribute("data-project-mark", "visitor");
  await expect(foot).toHaveText(new RegExp(`^${name} is built on Foundmill\\.\\s*Start your own$`));
  await expect(foot.getByRole("link", { name: "Start your own" })).toHaveAttribute("href", `/?via=p.${slug}`);
  // Nothing is counted, and there is no form.
  await expect(story).not.toContainText(/\d+\s+(milestones?|followers?|customers?)/i);
  await expect(page.locator("form, input, textarea")).toHaveCount(0);
  await expectFitsSmallScreens(page, "[data-project-story]", width);
  await shot(page, file);
}

async function expectCard(page: Page, cardPath: string, slug: string, name: string, width: number, file: string): Promise<void> {
  const res = await page.goto(cardPath);
  expect(res?.status()).toBe(200);
  const card = page.locator("[data-milestone-card]");
  await expect(card).toBeVisible({ timeout: LONG });
  await expect(card).toHaveAttribute("data-milestone-card", "page_live");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page live");
  await expect(card.locator("[data-project-name]")).toHaveText(name);
  await expect(card.locator("time")).toHaveText(US_DATE);
  await expect(card.locator("[data-verified]")).toHaveText("Verified by Foundmill");
  await expect(card.locator("[data-card-note]")).toHaveText("Foundmill recorded this when it happened. It was not typed in.");
  await expect(card.getByRole("link", { name: `See ${name}` })).toHaveAttribute("href", `/p/${slug}`);
  await expect(card.getByRole("link", { name: `How ${name} was built` })).toHaveAttribute("href", `/p/${slug}/story`);
  await expect(card.locator("footer[data-project-mark]").getByRole("link", { name: "Start your own" })).toHaveAttribute("href", `/?via=p.${slug}`);
  await expectFitsSmallScreens(page, "[data-milestone-card]", width);
  await shot(page, file);
}

test.describe("project story and milestone cards", () => {
  test("publish the page, see Page live reached, show it, open the story and the card signed out at 390 and 1280 px, hide it", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const name = `Story Bikes ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);

    // Before the page is published: ten milestones, the two early ones first, none reached and nothing to show yet.
    await page.goto(`/b/${bid}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy]")).toHaveCount(10);
    expect(await page.locator("[data-trophy]").evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-trophy")))).toEqual(["page_live", "first_follower", "customer_1"]);
    await expect(page.locator("[data-trophy='page_live']")).not.toHaveAttribute("data-achieved", "true");
    await expect(page.locator("[data-trophy-show]")).toHaveCount(0);
    await expect(page.getByTestId("milestones-page-note")).toHaveText("Publish your project's page to show a milestone on it.", { timeout: LONG });

    // Publish the page (the team drafted it; the founder rewrites it and presses Publish). Covered in full by public-page.spec.ts.
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    const check = page.getByTestId("needs-you").getByRole("button", { name: "Check it and publish" });
    await expect(async () => {
      await page.reload();
      await expect(check).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: LONG });
    await dismissCoachmarks(page);
    await check.click();
    await page.waitForURL(new RegExp(`/b/${bid}/d/[^/]+/public-page$`), { timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    const editor = page.getByTestId("public-page-editor");
    await expect(editor).toBeVisible({ timeout: LONG });
    await editor.getByLabel(/One-line pitch/).fill(PITCH);
    await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
    await editor.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByTestId("page-confirm-publish").click();
    await expect(page.getByTestId("page-state")).toHaveText(/Live since [A-Z][a-z]{2} \d{1,2}, \d{4}/, { timeout: LONG });
    const slug = new URL((await page.getByTestId("page-url").innerText()).trim()).pathname.replace("/p/", "");
    expect(slug).toMatch(/^[a-z0-9-]{3,40}$/);

    // Reached, and private: nothing is public on its own.
    const early = await visitor(browser, 390, 844);
    try {
      expect((await early.page.goto(`/p/${slug}/story`))?.status()).toBe(404);
      await expect(early.page.getByTestId("public-page-not-found")).toBeVisible();
      await early.page.goto(`/p/${slug}`);
      await expect(early.page.getByRole("link", { name: "Built on Foundmill" })).toHaveAttribute("href", `/?via=p.${slug}`);
    } finally {
      await early.close();
    }

    // Plan › Milestones: "Page live" is reached, with one press to show it.
    await page.goto(`/b/${bid}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    const live = page.locator("[data-trophy='page_live']");
    await expect(live).toHaveAttribute("data-achieved", "true", { timeout: LONG });
    await expect(live).toContainText("Page live");
    await expect(live).toContainText("Reached");
    await expect(page.getByTestId("milestones-screen")).toHaveAttribute("data-won", "1");
    await expect(page.getByTestId("milestones-page-note")).toHaveText("A milestone is public only after you press Show on your page, and you can hide it again at any time.");
    const show = live.getByRole("button", { name: "Show on your page: Page live" });
    await expect(show).toHaveText("Show on your page");
    await show.click();
    const onPage = live.locator("[data-trophy-on-page='shown']");
    await expect(onPage).toContainText("On your page", { timeout: LONG });
    await expect(toast(page, "On your page")).toBeVisible({ timeout: LONG });
    await expect(live.locator("[data-trophy-show]")).toHaveCount(0);
    await expect(onPage.getByRole("button", { name: "Hide: Page live" })).toBeVisible();
    // The controls sit under their own card, never over the next row.
    for (const control of await onPage.getByRole("button").all()) {
      const hit = await control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!at && (at === el || el.contains(at));
      });
      expect(hit, "a page control is not covered").toBe(true);
    }
    // No tally of what is shown anywhere on the screen.
    await expect(page.getByTestId("trophy-cabinet-panel")).not.toContainText(/\d+\s+(shown|on your page)/i);

    // Copy card link gives the card's address.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
    await onPage.getByRole("button", { name: "Copy card link: Page live" }).click();
    await expect(toast(page, "Card link copied")).toBeVisible({ timeout: LONG });
    const cardLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(cardLink).toMatch(/\/m\/[0-9a-f-]{36}$/);
    const cardPath = new URL(cardLink).pathname;

    // Signed out, on a phone: the story, the project page's mark leading to it, and the card.
    const phone = await visitor(browser, 390, 844);
    try {
      await expectStory(phone.page, slug, name, 390, "46-project-story-390.png");
      // Indexable while it exists, with its own title and address.
      await expect(phone.page).toHaveTitle(`How ${name} was built`);
      await expect(phone.page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
      await expect(phone.page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/p/${slug}/story$`));
      await expect(phone.page.locator('meta[property="og:title"]')).toHaveAttribute("content", `How ${name} was built`);

      // The project's page: the mark is still the one link at the foot, and now it goes to the story.
      await phone.page.goto(`/p/${slug}`);
      const mark = phone.page.getByRole("link", { name: "Built on Foundmill" });
      await expect(mark).toHaveAttribute("href", `/p/${slug}/story?via=p.${slug}`);
      await mark.click();
      await phone.page.waitForURL(new RegExp(`/p/${slug}/story\\?via=p\\.${slug}$`), { timeout: LONG });
      await expect(phone.page.locator("[data-project-story]")).toBeVisible({ timeout: LONG });

      await expectCard(phone.page, cardPath, slug, name, 390, "48-milestone-card-390.png");
      // Never indexed; its own title, description and share image.
      await expect(phone.page).toHaveTitle(`Page live: ${name}`);
      await expect(phone.page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex, follow/);
      await expect(phone.page.locator('meta[name="description"]')).toHaveAttribute("content", new RegExp(`^${name} reached this on [A-Z][a-z]{2} \\d{1,2}, \\d{4}\\. Verified by Foundmill\\.$`));
      await expect(phone.page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`${cardPath}/opengraph-image`));
      // Both share images: wide for link previews, tall for story posts.
      for (const [image, file] of [[`${cardPath}/opengraph-image`, "50-milestone-card-wide.png"], [`${cardPath}/story-image`, "51-milestone-card-tall.png"]] as const) {
        const res = await phone.page.request.get(image);
        expect(res.status(), image).toBe(200);
        expect(res.headers()["content-type"], image).toContain("image/png");
        const body = await res.body();
        expect(body.byteLength, image).toBeGreaterThan(2_000);
        if (process.env.E2E_UX_AUDIT) await writeFile(path.join(AUDIT_DIR, file), body);
      }
    } finally {
      await phone.close();
    }
    const desktop = await visitor(browser, 1280, 800);
    try {
      await expectStory(desktop.page, slug, name, 1280, "47-project-story-1280.png");
      await expectCard(desktop.page, cardPath, slug, name, 1280, "49-milestone-card-1280.png");
    } finally {
      await desktop.close();
    }

    // Signed in, the founder's own view of the story carries the sentence and no link to start another.
    await page.goto(`/p/${slug}/story`);
    const own = page.locator("[data-project-story] footer[data-project-mark]");
    await expect(own).toHaveAttribute("data-project-mark", "member", { timeout: LONG });
    await expect(own.getByRole("link")).toHaveCount(0);

    // Hide it: the story and the card answer not found at once, and the mark goes back to the landing page.
    await page.goto(`/b/${bid}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    await page.locator("[data-trophy='page_live']").getByRole("button", { name: "Hide: Page live" }).click();
    await expect(page.locator("[data-trophy='page_live']").getByRole("button", { name: "Show on your page: Page live" })).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy='page_live'] [data-trophy-on-page]")).toHaveCount(0);
    const gone = await visitor(browser, 390, 844);
    try {
      expect((await gone.page.goto(`/p/${slug}/story`))?.status()).toBe(404);
      await expect(gone.page.locator("[data-project-story]")).toHaveCount(0);
      await expect(gone.page.getByTestId("public-page-not-found")).toBeVisible();
      await expect(gone.page.getByTestId("needs-larger-window")).toHaveCount(0);
      expect((await gone.page.goto(cardPath))?.status()).toBe(404);
      await expect(gone.page.locator("[data-milestone-card]")).toHaveCount(0);
      await expect(gone.page.getByTestId("milestone-card-not-found")).toBeVisible();
      await expect(gone.page.getByRole("link", { name: "Go to Foundmill" })).toHaveAttribute("href", "/");
      expect((await gone.page.request.get(`${cardPath}/story-image`)).status()).toBe(404);
      expect((await gone.page.request.get(`${cardPath}/opengraph-image`)).status()).toBe(404);
      await gone.page.goto(`/p/${slug}`);
      await expect(gone.page.getByRole("link", { name: "Built on Foundmill" })).toHaveAttribute("href", `/?via=p.${slug}`);
    } finally {
      await gone.close();
    }
  });

  test("an unknown story and an unknown card are not-found pages, signed out, at phone width", async ({ browser }) => {
    const v = await visitor(browser, 390, 844);
    try {
      expect((await v.page.goto("/p/no-such-project-here/story"))?.status()).toBe(404);
      await expect(v.page.getByTestId("public-page-not-found")).toBeVisible();
      await expect(v.page.getByTestId("needs-larger-window")).toHaveCount(0);
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
        expect((await v.page.goto(`/m/${id}`))?.status(), id).toBe(404);
        await expect(v.page.getByTestId("milestone-card-not-found")).toBeVisible();
        await expect(v.page.getByTestId("needs-larger-window")).toHaveCount(0);
        // Never indexed (the page's own tag, and the one Next.js adds to every not-found).
        for (const robots of await v.page.locator('meta[name="robots"]').all()) await expect(robots).toHaveAttribute("content", /noindex/);
      }
      // The console's Milestones screen is not under the card's prefix: signed out it asks to sign in.
      await v.page.goto("/milestones");
      await expect(v.page).toHaveURL(/\/login/);
    } finally {
      await v.close();
    }
  });
});
