import { expect, test, type Browser } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, expectTapTarget, settled } from "./helpers";
import { expectNoAxeViolations } from "./axe";

/**
 * The opt-in gallery (docs/holistic-plan/LAUNCH_EVALUATION.md Session 10). A throwaway project publishes its page and
 * is not in `/explore` by default; its owner turns on "Show in Explore" in Product › Public page; `/explore` then lists
 * it, signed out, at 390 px and 1280 px (no horizontal scroll, 44 px tap targets, axe); the card opens the project's
 * page; turning the switch off removes it again. Stack and commands: e2e/README.md.
 */
const PITCH = "Gallery test: repairs at your door";
const ABOUT = "We come to you with a van full of parts and fix the bike where it stands.";

async function visitor(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 600, isMobile: width < 600 });
  return { page: await context.newPage(), close: () => context.close() };
}

test("a project is in /explore only after its owner opts in, and leaves it when they opt out", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const name = `Explore Bikes ${Date.now().toString(36)}`;
  const bid = await commitThrowaway(page, name);
  await page.goto(`/b/${bid}/today`);
  await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
  await dismissCoachmarks(page);
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
  // Not offered until the page is live.
  await expect(editor.getByRole("switch", { name: /Show in Explore/ })).toHaveCount(0);
  await editor.getByLabel(/One-line pitch/).fill(PITCH);
  await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
  await editor.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByTestId("page-confirm-publish").click();
  await expect(page.getByTestId("page-state")).toHaveText(/Live since/, { timeout: LONG });

  const gallery = async (width: number, height: number) => {
    const v = await visitor(browser, width, height);
    expect((await v.page.goto("/explore"))?.status()).toBe(200);
    await expect(v.page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible({ timeout: LONG });
    await expect(v.page.getByTestId("needs-larger-window")).toHaveCount(0);
    return v;
  };

  // Live is not listed: nothing is in the gallery by default.
  let v = await gallery(390, 844);
  await expect(v.page.locator("[data-explore-list]").getByText(name)).toHaveCount(0);
  await v.close();

  // The owner's own press.
  const toggle = editor.getByRole("switch", { name: /Show in Explore/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: LONG });

  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    v = await gallery(width, height);
    const card = v.page.locator("[data-explore-project] a").filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText(PITCH);
    await expectTapTarget(card, "gallery card tap target");
    expect(await v.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(v.page, `/explore at ${width} px`);
    if (width === 390) {
      await card.click();
      await expect(v.page).toHaveURL(/\/p\/[a-z0-9-]+$/);
      await expect(v.page.getByRole("heading", { level: 1 })).toHaveText(PITCH);
    }
    await v.close();
  }

  // Opting out takes it off again.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: LONG });
  v = await gallery(390, 844);
  await expect(v.page.locator("[data-explore-list]").getByText(name)).toHaveCount(0);
  await v.close();
});
