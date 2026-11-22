import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { LONG, UUID, answerFirstProfile, dismissCoachmarks, settled } from "./helpers";

/**
 * The 390 px journey from a visitor to a shared link (docs/holistic-plan/LAUNCH_EVALUATION.md, Session 9): a signed-out
 * phone types an idea, sees the card and the page it would start as, signs in (the developer sign-in as a fresh id
 * stands in for the email link), keeps the card, answers the three questions, names the project, publishes its page from
 * Today and gets the share panel with the link, which a signed-out visitor can open. `needs-larger-window` is counted
 * on every screen. The screens are counted by their route, so a screen added to the path shows up here.
 *
 * The plan asks for six screens or fewer. Today the path has eight (below): the founder's Nov 13 decisions keep the
 * saved card (docs/IDEA_BOX.md) and Today as the front door, so the budget is the current eight and a change that adds
 * a ninth fails here. Lowering it to six is a product decision, not a test edit.
 */
const SCREEN_BUDGET = 8;

const ROUTES: Array<[string, RegExp]> = [
  ["landing", /^\/$/],
  ["sign-in", /^\/login/],
  ["keep the card", /^\/new\/card\/keep/],
  ["card kept", new RegExp(`^/new/card/${UUID}$`)],
  ["three questions", /^\/onboarding/],
  ["commit", new RegExp(`^/new/commit/${UUID}`)],
  ["today", new RegExp(`^/b/${UUID}/today`)],
  ["public page", new RegExp(`^/b/${UUID}/d/[^/]+/public-page`)],
];

async function phone(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  return { context, page: await context.newPage() };
}

test("390 px: from the idea box to a shared link in the screens the plan counts, never the larger-window ask", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await phone(browser);
  try {
    const seen: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const hit = ROUTES.find(([, re]) => re.test(new URL(frame.url()).pathname));
      if (hit && seen[seen.length - 1] !== hit[0]) seen.push(hit[0]);
    });
    const notWalled = () => expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    await page.route("**/idea-box/draft", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }));

    // 1. The idea box: the card lands with the page it would start as, before any sign-in.
    await page.goto("/");
    await page.getByTestId("idea-input").fill("Bike repairs at your door, booked in a minute");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    const preview = page.getByTestId("idea-page-preview");
    await expect(preview.locator("[data-project-page]")).toBeVisible();
    await expect(preview.locator("[data-brand-line]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await notWalled();
    await page.getByTestId("idea-build").click();

    // 2 and 3. Sign in, keep the card.
    await expect(page).toHaveURL(/\/login\?next=%2Fstart%3Fclaim%3D/);
    await notWalled();
    await page.goto(`/auth/dev?as=${randomUUID()}&next=${encodeURIComponent(new URL(page.url()).searchParams.get("next")!)}`);
    await expect(page).toHaveURL(/\/new\/card\/keep/, { timeout: LONG });
    await notWalled();
    await page.getByTestId("card-keep").click();

    // 4 and 5. The card is kept; the three questions.
    await expect(page).toHaveURL(new RegExp(`/new/card/${UUID}$`), { timeout: LONG });
    await notWalled();
    await page.getByTestId("card-kept-next").click();
    await expect(page.getByTestId("first-profile")).toBeVisible({ timeout: LONG });
    await notWalled();
    await answerFirstProfile(page, "Journey Founder");

    // 6. Commit as name and go.
    await expect(page).toHaveURL(new RegExp(`/new/commit/${UUID}$`), { timeout: LONG });
    await notWalled();
    await page.getByLabel(/Business name/).fill(`Journey Bikes ${Date.now().toString(36)}`);
    await page.getByTestId("take-charge").click();

    // 7. Today, and its one tap to the page.
    await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await notWalled();
    const check = page.getByTestId("needs-you").getByRole("button", { name: "Check it and publish" });
    await expect(async () => {
      await page.reload();
      await expect(check).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: LONG });
    await dismissCoachmarks(page);
    await check.click();

    // 8. The public page: publish, then the share panel in place holds the link.
    await page.waitForURL(new RegExp(`/b/${UUID}/d/[^/]+/public-page$`), { timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    await expect(page.getByTestId("public-page-editor")).toBeVisible({ timeout: LONG });
    await notWalled();
    await page.getByTestId("public-page-editor").getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog", { name: "Publish your public page?" }).getByTestId("page-confirm-publish").click();
    const panel = page.getByRole("dialog", { name: "Send your page to three people" });
    await expect(panel).toBeVisible({ timeout: LONG });
    const link = (await panel.locator("[data-share-link]").innerText()).trim();
    await notWalled();

    // The link opens for a signed-out visitor on a phone.
    const visitor = await phone(browser);
    try {
      const res = await visitor.page.goto(link);
      expect(res?.status()).toBe(200);
      await expect(visitor.page.getByTestId("needs-larger-window")).toHaveCount(0);
    } finally {
      await visitor.context.close();
    }

    expect(seen, `screens met: ${seen.join(" > ")}`).toEqual(ROUTES.map(([n]) => n));
    expect(seen.length).toBeLessThanOrEqual(SCREEN_BUDGET);
  } finally {
    await context.close();
  }
});
