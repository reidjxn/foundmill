import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, expectTapTarget, openBusiness, openSwitcher, signIn } from "./helpers";

/**
 * A person's public profile (docs/THESIS_REVIEW.md package 2.3): Your public profile (/public-profile, from the business
 * switcher) with its fields, tags with suggestions, "What are you here for?" defaulting to "Building on my own", a
 * phone-width preview drawn by the public page itself, the address, and Publish behind a confirmation that says what
 * becomes public; then `/u/<handle>` signed out at 390 px and 1280 px: before publishing it is not found, published it
 * shows the person's fields (indexable, its own title and share card, no horizontal scroll, 44 px links) and none of the
 * profile's private fields (the seed gives the dev founder a budget, constraints, an experience and a residence; none
 * is anywhere in the HTML); taken down it is not found again. The dev founder's profile is taken down afterwards.
 *
 * With `E2E_UX_AUDIT=1` the public profile is also saved as docs/ux-audit/42-person-page-390.png and
 * 43-person-page-1280.png (device scale 2).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(here, "../../../docs/ux-audit");

const HEADLINE = "Baker turning weekend sourdough into a bread subscription";
const ABOUT = "I bake sourdough in a small kitchen and sell it to neighbors on Saturdays.\n\nNow I want people across the city to be able to order it online.";
const PLACE = "Leeds, UK";
/** The seed's private profile values for the dev founder (packages/db/src/seed/index.ts): never on the public page. */
const PRIVATE_VALUES = ["No consumer cold email in the EU", "Founder approves anything in their name", "6000000", "60,000", "full_time", "operator", "moderate", "demo-founder@foundmill.local", "0f0a0d00-0000-4000-8000-00000000f0a1"];

async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 600, isMobile: width < 600 });
  return { page: await context.newPage(), close: () => context.close() };
}

async function expectNotFound(browser: Browser, personPath: string, width: number): Promise<void> {
  const v = await visitor(browser, width, 844);
  try {
    const res = await v.page.goto(personPath);
    expect(res?.status()).toBe(404);
    await expect(v.page.getByTestId("public-person-not-found")).toBeVisible({ timeout: LONG });
    await expect(v.page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(v.page.locator("[data-person-page]")).toHaveCount(0);
    await expect(v.page.getByRole("link", { name: "Go to Foundmill" })).toHaveAttribute("href", "/");
    // Never indexable: every robots tag says noindex (Next.js adds its own on a not-found answer).
    const robots = await v.page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => e.getAttribute("content") ?? ""));
    expect(robots.length).toBeGreaterThan(0);
    for (const r of robots) expect(r).toMatch(/noindex/);
  } finally {
    await v.close();
  }
}

async function expectPersonPage(browser: Browser, personPath: string, width: number, height: number, shot: string): Promise<void> {
  const v = await visitor(browser, width, height);
  const { page } = v;
  try {
    const res = await page.goto(personPath);
    expect(res?.status()).toBe(200);
    const html = await res!.text();
    const article = page.locator("[data-person-page]");
    await expect(article).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jamie Reyes");
    await expect(article.locator("[data-person-headline]")).toHaveText(HEADLINE);
    await expect(article.locator("[data-person-place]")).toHaveText(PLACE);
    await expect(article.locator("[data-person-about] p")).toHaveCount(2);
    await expect(article.locator("[data-person-strengths] li")).toHaveText(["Baking", "Talking to people"]);
    await expect(article.locator("[data-person-wants-to-learn] li")).toHaveText(["Selling"]);
    await expect(article.locator("[data-person-looking-for]")).toHaveText("Open to building with people");
    // No contact button, no form.
    await expect(article.locator("form, input, textarea, button")).toHaveCount(0);
    // The private fields are nowhere in what was sent.
    for (const value of PRIVATE_VALUES) expect(html, value).not.toContain(value);
    // Indexable, with its own title and share card.
    await expect(page).toHaveTitle(/^Jamie Reyes: Baker turning weekend sourdough/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/u\/[a-z0-9-]+\/opengraph-image/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${personPath}$`));
    // No horizontal scroll; the one link is a 44 px target; no text under 11 px.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
    const made = page.getByRole("link", { name: "Made with Foundmill" });
    await expect(made).toHaveAttribute("href", "/");
    await expectTapTarget(made, "Made with Foundmill is a 44 px target");
    const smallest = await article.evaluate((root) => Math.min(...[...root.querySelectorAll<HTMLElement>("p, h1, h2, span, a, li")].filter((e) => e.textContent?.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))));
    expect(smallest).toBeGreaterThanOrEqual(11);
    if (process.env.E2E_UX_AUDIT) {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.screenshot({ path: path.join(AUDIT_DIR, shot), fullPage: true });
    }
  } finally {
    await v.close();
  }
}

test.describe("person page", () => {
  test("write it, preview it at phone width, publish it after a confirmation, open it signed out at 390 and 1280 px, take it down", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const handle = `jamie-${Date.now().toString(36)}`;
    const personPath = `/u/${handle}`;

    await signIn(page);
    await page.goto("/public-profile");
    const editor = page.getByTestId("public-profile-editor");
    await expect(editor).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("heading", { level: 1, name: "Your public profile" })).toBeVisible();
    // A profile left public by an earlier run is taken down first.
    const state = page.getByTestId("public-profile-state");
    await expect(state).toHaveText(/^(Only you can see this|Public since .+)$/, { timeout: LONG });
    if ((await state.innerText()).startsWith("Public")) {
      await editor.getByRole("button", { name: "Take it down" }).click();
      await expect(page.getByTestId("public-profile-state")).toHaveText("Only you can see this", { timeout: LONG });
    }
    await expect(page.getByTestId("public-profile-state")).toHaveText("Only you can see this");
    await expect(editor.getByTestId("public-profile-name")).toContainText("Shown as Jamie Reyes.");

    // The address first: this run's own handle.
    await editor.getByRole("button", { name: "Change address" }).click();
    await editor.getByLabel("New address").fill(handle);
    await editor.getByRole("button", { name: "Save address" }).click();
    await expect(editor.getByTestId("public-profile-url")).toHaveText(new RegExp(`/u/${handle}$`), { timeout: LONG });

    // Not public yet: a stranger finds nothing, on a phone and on a desktop.
    await expectNotFound(browser, personPath, 390);

    await editor.getByRole("textbox", { name: /^Headline/ }).fill(HEADLINE);
    await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
    await editor.getByRole("textbox", { name: /^Place/ }).fill(PLACE);
    await expect(editor.locator("[data-count-for$='-headline']")).toHaveText(`${HEADLINE.length} / 80`);
    // Tags: clear what an earlier run left, type one, pick a suggestion.
    for (const field of ["Good at", "Wants to learn"]) {
      const chosen = editor.getByRole("list", { name: `${field} chosen` });
      while ((await chosen.count()) && (await chosen.getByRole("button").count())) await chosen.getByRole("button").first().click();
    }
    const strengths = editor.getByRole("textbox", { name: /^Good at/ });
    await strengths.fill("Baking");
    await strengths.press("Enter");
    await editor.getByLabel("Good at suggestions").getByRole("button", { name: "Talking to people" }).click();
    await editor.getByLabel("Wants to learn suggestions").getByRole("button", { name: "Selling" }).click();

    // "What are you here for?": building on my own is the default, and the preview says nothing about people.
    const lookingFor = editor.getByTestId("public-profile-looking-for");
    await expect(lookingFor).toContainText("What are you here for?");
    const preview = page.getByTestId("public-profile-preview");
    await lookingFor.getByRole("radio", { name: "Building on my own" }).click();
    await expect(preview.locator("[data-person-looking-for]")).toHaveCount(0);
    await lookingFor.getByRole("radio", { name: "Open to building with people" }).click();
    await expect(preview.locator("[data-person-looking-for]")).toHaveText("Open to building with people");

    // The preview is the public page itself, at phone width.
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText("Jamie Reyes");
    await expect(preview.locator("[data-person-headline]")).toHaveText(HEADLINE);
    expect(Math.round((await preview.locator("[data-person-page]").boundingBox())!.width)).toBeLessThanOrEqual(390);

    // Publish asks first and says what becomes public.
    await editor.getByRole("button", { name: "Publish", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Make your profile public?" })).toBeVisible();
    await expect(dialog).toContainText("Anyone with the link can read your name, your headline, your place, about, what you are good at, what you want to learn and what you are here for. You can take it down any time.");
    await dialog.getByTestId("public-profile-confirm-publish").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("public-profile-state")).toHaveText(/^Public since [A-Z][a-z]{2} \d{1,2}, \d{4}$/, { timeout: LONG });
    await expect(editor.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(editor.getByRole("link", { name: "Open" })).toHaveAttribute("href", new RegExp(`${personPath}$`));

    // Signed out, on a phone and on a desktop.
    await expectPersonPage(browser, personPath, 390, 844, "42-person-page-390.png");
    await expectPersonPage(browser, personPath, 1280, 800, "43-person-page-1280.png");

    // An email address in a public profile is held: nothing changes on the public page.
    await editor.getByRole("textbox", { name: /^About/ }).fill(`${ABOUT}\n\nWrite to jamie@example.com`);
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("public-profile-held")).toContainText("looks like an email address or a phone number", { timeout: LONG });
    await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);

    // Taken down: gone at once.
    await editor.getByRole("button", { name: "Take it down" }).click();
    await expect(page.getByTestId("public-profile-state")).toHaveText("Only you can see this", { timeout: LONG });
    await expectNotFound(browser, personPath, 1280);
  });

  test("Settings › Preferences and the business switcher lead to it", async ({ page }) => {
    await openBusiness(page, "settings/preferences");
    const panel = page.getByTestId("public-profile-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("A page about you at its own address, with no project needed.");
    await expect(panel.getByTestId("public-profile-edit")).toHaveAttribute("href", "/public-profile");
    const switcher = await openSwitcher(page);
    await switcher.getByRole("option", { name: /^Your public profile$/ }).click();
    await page.waitForURL(/\/public-profile$/, { timeout: LONG });
    await expect(page.getByTestId("public-profile-editor")).toBeVisible({ timeout: LONG });
  });
});
