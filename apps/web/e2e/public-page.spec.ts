import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, expectTapTarget, settled } from "./helpers";
import { expectNoAxeViolations } from "./axe";

/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1): Product › Public page in the console (fields with
 * counts, a phone-width preview, the address, Publish behind a confirmation that says what becomes public), the team's
 * first draft and the Product lead's note in Today's Needs you (packages 1.2 and 1.3), Today's quiet line once that
 * note is answered and nothing is live, and `/p/<slug>` signed out at 390 px and 1280 px (indexable, its own title and share
 * card, no horizontal scroll, 44 px tap targets), gone once it is taken down. Package 1.6 (double opt-in): a stranger
 * signs up at 390 px signed out (the box is required, one line asking them to check their email, the same answer for the
 * same address again; the bot check passes on the stack's mock Turnstile token, as on the idea box, and a post without
 * JavaScript, which cannot run it, is refused in plain words and records nothing), and the founder sees no follower counted yet and one contact in Customers, "Follower (fo***@…)",
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
  for (const target of [follow.getByRole("button", { name: "Follow" }), follow.getByLabel("Your email", { exact: true }), follow.locator("label").filter({ has: page.getByRole("checkbox") })]) {
    await expectTapTarget(target, "follow form tap target");
  }
  await expect(page.locator("textarea")).toHaveCount(0);
  // No horizontal scroll, at 390 px included.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
  // Every link is a 44 px target; no text under the design system's 11 px floor.
  // The mark, as a signed-out visitor meets it (docs/NETWORK.md F2): the page's one link, small, naming this page as where they came from.
  await expect(article.locator("[data-project-mark]")).toHaveAttribute("data-project-mark", "visitor");
  const made = page.getByRole("link", { name: "Built on Foundmill" });
  await expect(made).toHaveAttribute("href", `/?via=p.${pagePath.replace("/p/", "")}`);
  await expectTapTarget(made, "Built on Foundmill is a 44 px target");
  expect(await made.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeLessThanOrEqual(13);
  // The only other link: the bot check's disclosure under the Follow button, on every plan, in a new tab.
  const disclosure = follow.locator("[data-follow-bot-check]");
  await expect(disclosure).toHaveText("Protected by Cloudflare Turnstile (privacy)");
  const privacy = disclosure.getByRole("link", { name: "Cloudflare Turnstile privacy policy (opens in a new tab)" });
  await expect(privacy).toHaveAttribute("href", "https://www.cloudflare.com/turnstile-privacy-policy/");
  await expect(privacy).toHaveAttribute("target", "_blank");
  await expect(privacy).toHaveAttribute("rel", "noopener noreferrer");
  await expectTapTarget(privacy, "the Turnstile privacy link is a 44 px target");
  // What happens to the address, under the consent box, before the button: the Privacy Policy's section on following.
  const howUsed = follow.locator("[data-follow-privacy]").getByRole("link", { name: "How your email is used, in the Privacy Policy (opens in a new tab)" });
  await expect(howUsed).toHaveText("How your email is used");
  await expect(howUsed).toHaveAttribute("href", "/privacy#following");
  await expect(howUsed).toHaveAttribute("target", "_blank");
  await expectTapTarget(howUsed, "the How your email is used link is a 44 px target");
  await expect(article.getByRole("link")).toHaveCount(3);
  // The page and its form pass axe (WCAG 2.2 AA, the stories' rules; e2e/accessibility.spec.ts has the rest).
  await expectNoAxeViolations(page, `${pagePath} at ${width} px, signed out`);
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
    // Four widths of a published page, each now with an axe run (WP-10 T7).
    test.setTimeout(360_000);
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
    // The preview shows the mark as a visitor will see it, and says once that a paid plan removes it.
    await expect(preview.locator("[data-project-mark]")).toHaveAttribute("data-project-mark", "visitor");
    await expect(preview.getByTestId("page-mark-note")).toHaveText("The small line at the foot is removed on a paid plan.");

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
      // Its own title and share card. A short page is public and not listed for search engines yet (WP-08 T7).
      await expect(phone.page).toHaveTitle(/^Doorstep Bikes [a-z0-9]+: Bike repairs at your door/);
      await expect(phone.page.locator('meta[name="robots"]')).toHaveAttribute("content", /^noindex, follow/);
      // One structured-data block, and the page as Markdown for AI readers (WP-08 T7).
      await expect(phone.page.locator('script[type="application/ld+json"]')).toHaveCount(1);
      expect(JSON.parse((await phone.page.locator('script[type="application/ld+json"]').textContent()) ?? "{}")["@graph"][0]["@type"]).toBe("ProfilePage");
      const md = await phone.page.request.get(`${pagePath}/llms.txt`);
      expect(md.status()).toBe(200);
      expect(await md.text()).toContain("> Bike repairs at your door");
      await expect(phone.page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Bike repairs at your door/);
      await expect(phone.page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/p\/[a-z0-9-]+\/opengraph-image/);
      await expect(phone.page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/p\/[a-z0-9-]+$/);
      // The mark goes to the landing page, carrying where the visitor came from.
      await phone.page.getByRole("link", { name: "Built on Foundmill" }).click();
      await phone.page.waitForURL(/\/\?via=p\.[a-z0-9-]+$/, { timeout: LONG });
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
      // The bot check's box sits in the form and takes no room while it has nothing to show (the local stack passes the
      // mock Turnstile token, as for the idea box; e2e/idea-box.spec.ts).
      const widgetBox = form.locator("[data-follow-widget]");
      await expect(widgetBox).toHaveCount(1);
      await expect(widgetBox).toBeHidden();
      await form.getByLabel("Your email", { exact: true }).fill(follower);
      // The box is required: without it nothing is sent and the form says why in plain words.
      await form.getByRole("button", { name: "Follow" }).click();
      await expect(form.getByRole("alert")).toHaveText("Tick the box to agree to get email about this project.", { timeout: LONG });
      await expect(form.getByLabel("Your email", { exact: true })).toHaveValue(follower);
      await form.getByRole("checkbox", { name: /^I agree to get email from Doorstep Bikes [a-z0-9]+ about this project\. I can unsubscribe at any time\.$/ }).check();
      await form.getByRole("button", { name: "Follow" }).click();
      const done = fan.page.locator("[data-project-follow='done']");
      await expect(done.getByRole("status")).toHaveText(/^Check your email to confirm\. Doorstep Bikes [a-z0-9]+ will only write to you after you do\.$/, { timeout: LONG });
      // The one moment the mark is a sentence: after a visitor follows, small, under the answer.
      const builtOn = done.locator("[data-follow-built-on]");
      await expect(builtOn).toHaveText(/^Doorstep Bikes [a-z0-9]+ is built on Foundmill\.\s*Start your own$/);
      await expect(builtOn.getByRole("link", { name: "Start your own" })).toHaveAttribute("href", `/?via=p.${pagePath.replace("/p/", "")}`);
      // Nothing else is revealed, and no follower's address is on the page.
      await expect(fan.page.locator("input[type=email]")).toHaveCount(0);
      await expect(fan.page.locator("body")).not.toContainText(follower);
      // The same address again: the same answer, nothing more.
      await fan.page.goto(pagePath);
      const again = fan.page.locator("form[data-project-follow]");
      await again.getByLabel("Your email", { exact: true }).fill(follower.toUpperCase());
      await again.getByRole("checkbox").check();
      await again.getByRole("button", { name: "Follow" }).click();
      await expect(fan.page.locator("[data-project-follow='done']").getByRole("status")).toHaveText(/^Check your email to confirm\. Doorstep Bikes [a-z0-9]+ will only write to you after you do\.$/, { timeout: LONG });
      const overflow = await fan.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "horizontal overflow after following").toBeLessThanOrEqual(0);
    } finally {
      await fan.close();
    }
    // Without JavaScript the form still posts and answers (a Server Action, a native checkbox), but the bot check
    // (Turnstile) cannot run without it: the plain sentence, the address kept, and nothing recorded (the founder's
    // Customers below hold only the one follower).
    const plain = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    try {
      const p = await plain.newPage();
      await p.goto(pagePath);
      const form = p.locator("form[data-project-follow]");
      await form.getByLabel("Your email", { exact: true }).fill(follower.replace("follower-", "plain-"));
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Follow" }).click();
      const refused = p.locator("form[data-project-follow]");
      await expect(refused.getByRole("alert")).toHaveText("We could not check this browser, so you are not following yet. Reload the page and try again.", { timeout: LONG });
      await expect(refused.getByLabel("Your email", { exact: true })).toHaveValue(follower.replace("follower-", "plain-"));
      await expect(p.locator("[data-project-follow='done']")).toHaveCount(0);
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
    // Signed in, the founder's own view of the public page carries the mark as plain words: no link, dimmer.
    await page.goto(pagePath);
    const own = page.locator("[data-project-mark]");
    await expect(own).toHaveAttribute("data-project-mark", "member", { timeout: LONG });
    await expect(own).toHaveText("Built on Foundmill");
    // No link but the two every viewer of the Follow form gets: how the email is used, and the bot check's disclosure.
    await expect(page.locator("[data-project-page]").getByRole("link")).toHaveCount(2);
    await expect(page.locator("[data-project-page] [data-follow-privacy]").getByRole("link")).toHaveCount(1);
    await expect(page.locator("[data-project-page] [data-follow-bot-check]").getByRole("link")).toHaveCount(1);
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
