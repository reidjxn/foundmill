import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, expectTapTarget, settled } from "./helpers";

/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1): Product › Public page in the console (fields with
 * counts, a phone-width preview, the address, Publish behind a confirmation that says what becomes public), the team's
 * first draft and the Product lead's note in Today's Needs you (packages 1.2 and 1.3), Today's quiet line once that
 * note is answered and nothing is live, and `/p/<slug>` signed out at 390 px and 1280 px (indexable, its own title and share
 * card, no horizontal scroll, 44 px tap targets), gone once it is taken down. Package 1.6 (double opt-in): a stranger
 * signs up at 390 px signed out (the box is required, one line asking them to check their email, the same answer for the
 * same address again), and the founder sees no follower counted yet and one contact in Customers, "Follower (fo***@…)",
 * with "Public page" and "Not confirmed yet". This stack runs no gateway and no ingest (one PGlite database is one
 * process), so no confirmation email goes out and the signup stays pending, which is the honest state; the email, the
 * signed link and the confirm page are covered by apps/gateway `follow-confirm.test.ts` and apps/ingest
 * `follow-confirm.test.ts`. A throwaway business, since a sample business never has a public page. Stack and commands:
 * e2e/README.md.
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
  // One form: Follow (package 1.6), with 44 px targets.
  const follow = page.locator("form[data-project-follow]");
  await expect(follow).toHaveCount(1);
  await expect(follow.getByRole("heading", { level: 2 })).toHaveText(/^Follow Doorstep Bikes/);
  for (const target of [follow.getByRole("button", { name: "Follow" }), follow.getByLabel("Your email"), follow.locator("label").filter({ has: page.getByRole("checkbox") })]) {
    await expectTapTarget(target, "follow form tap target");
  }
  await expect(page.locator("textarea")).toHaveCount(0);
  // No horizontal scroll, at 390 px included.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
  // Every link is a 44 px target; no text under the design system's 11 px floor.
  const made = page.getByRole("link", { name: "Made with Foundmill" });
  await expect(made).toHaveAttribute("href", "/");
  await expectTapTarget(made, "Made with Foundmill is a 44 px target");
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

    // Today (packages 1.2 and 1.3): the team drafted the page first, and the Product lead's note asks for it in Needs you;
    // while that note is open the quiet line stays away (one or the other). Its one tap opens the tab.
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    const needs = page.getByTestId("needs-you");
    const check = needs.getByRole("button", { name: "Check it and publish" });
    await expect(async () => {
      await page.reload();
      await expect(check).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: LONG });
    await expect(needs).toContainText("Your project's page is ready");
    await expect(page.getByTestId("public-page-note")).toHaveCount(0);
    await dismissCoachmarks(page);
    await check.click();
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
    // The team's draft is already in the fields; the founder rewrites it in their own words.
    await expect(editor.getByLabel(/One-line pitch/)).not.toHaveValue("");
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
    await expect(dialog).toContainText("Anyone with the link can read the project's name and logo, its one-line pitch, about, who it is for, the stage and a form to follow it. You can take it down any time.");
    await dialog.getByTestId("page-confirm-publish").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("page-state")).toHaveText(/Live since [A-Z][a-z]{2} \d{1,2}, \d{4}/, { timeout: LONG });
    await expect(editor.getByRole("button", { name: "Copy link" })).toBeVisible();
    const url = (await page.getByTestId("page-url").innerText()).trim();
    const pagePath = new URL(url).pathname;
    expect(pagePath).toMatch(/^\/p\/[a-z0-9-]{3,40}$/);
    await expect(editor.getByRole("link", { name: "Open" })).toHaveAttribute("href", url);

    // The IndexNow key file route under a live page: a name that is not a key, and a key nobody connected, are the same quiet 404 as plain text.
    for (const name of ["not-a-key.txt", "aaaaaaaa.txt"]) {
      const res = await page.request.get(`${pagePath}/${name}`);
      expect(res.status(), name).toBe(404);
      expect(res.headers()["content-type"], name).toContain("text/plain");
      expect(res.headers()["cache-control"], name).toBe("no-store");
      expect(await res.text(), name).not.toContain("aaaaaaaa");
    }

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

    // Package 1.6: a stranger follows the project from a phone, signed out.
    const follower = `follower-${Date.now().toString(36)}@example.com`;
    const fan = await visitor(browser, 390, 844);
    try {
      await fan.page.goto(pagePath);
      const form = fan.page.locator("form[data-project-follow]");
      await expect(form).toBeVisible({ timeout: LONG });
      await expect(form).toContainText(/Leave your email and Doorstep Bikes [a-z0-9]+ will let you know when there is news\./);
      await form.getByLabel("Your email").fill(follower);
      // The box is required: without it nothing is sent and the form says why in plain words.
      await form.getByRole("button", { name: "Follow" }).click();
      await expect(form.getByRole("alert")).toHaveText("Tick the box to agree to get email about this project.", { timeout: LONG });
      await expect(form.getByLabel("Your email")).toHaveValue(follower);
      await form.getByRole("checkbox", { name: /^I agree to get email from Doorstep Bikes [a-z0-9]+ about this project\. I can unsubscribe at any time\.$/ }).check();
      await form.getByRole("button", { name: "Follow" }).click();
      const done = fan.page.locator("[data-project-follow='done']");
      await expect(done.getByRole("status")).toHaveText(/^Check your email to confirm\. Doorstep Bikes [a-z0-9]+ will only write to you after you do\.$/, { timeout: LONG });
      // Nothing else is revealed, and no follower's address is on the page.
      await expect(fan.page.locator("input[type=email]")).toHaveCount(0);
      await expect(fan.page.locator("body")).not.toContainText(follower);
      // The same address again: the same answer, nothing more.
      await fan.page.goto(pagePath);
      const again = fan.page.locator("form[data-project-follow]");
      await again.getByLabel("Your email").fill(follower.toUpperCase());
      await again.getByRole("checkbox").check();
      await again.getByRole("button", { name: "Follow" }).click();
      await expect(fan.page.locator("[data-project-follow='done']").getByRole("status")).toHaveText(/^Check your email to confirm\. Doorstep Bikes [a-z0-9]+ will only write to you after you do\.$/, { timeout: LONG });
      const overflow = await fan.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "horizontal overflow after following").toBeLessThanOrEqual(0);
    } finally {
      await fan.close();
    }
    // Without JavaScript the form still posts and answers (a Server Action, a native checkbox).
    const plain = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    try {
      const p = await plain.newPage();
      await p.goto(pagePath);
      const form = p.locator("form[data-project-follow]");
      await form.getByLabel("Your email").fill(follower.replace("follower-", "plain-"));
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Follow" }).click();
      await expect(p.locator("[data-project-follow='done']").getByRole("status")).toHaveText(/^Check your email to confirm\. Doorstep Bikes [a-z0-9]+ will only write to you after you do\.$/, { timeout: LONG });
    } finally {
      await plain.close();
    }

    // The founder: nobody counts as a follower until they confirm from the email, and the signup is a contact in
    // Customers under a masked name, "Not confirmed yet".
    const tabUrl = page.url();
    await page.reload();
    await settled(page);
    await expect(editor).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("page-followers")).toHaveCount(0);
    await page.goto(`/b/${bid}/crm`);
    const grid = page.getByRole("grid", { name: "CRM records" });
    await expect(grid).toBeVisible({ timeout: LONG });
    const masked = "Follower (fo***@example.com)";
    const rows = grid.getByRole("row").filter({ hasText: masked });
    await expect(rows).toHaveCount(1, { timeout: LONG });
    await rows.getByRole("link", { name: masked }).click();
    const facts = page.getByTestId("key-facts");
    await expect(facts).toBeVisible({ timeout: LONG });
    await expect(facts).toContainText("Public page");
    await expect(facts.getByTestId("email-consent")).toHaveText("Not confirmed yet");
    await page.goto(tabUrl);
    await settled(page);
    await dismissCoachmarks(page);
    await expect(editor).toBeVisible({ timeout: LONG });

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

    // With the note answered and nothing live, Today's quiet line leads back to the tab.
    await page.goto(`/b/${bid}/today`);
    const line = page.getByTestId("public-page-note");
    await expect(line).toBeVisible({ timeout: LONG });
    await expect(line.getByRole("link")).toHaveText(/Your project's public page is ready to check/);
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
