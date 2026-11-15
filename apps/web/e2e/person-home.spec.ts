import { expect, test, type Page } from "@playwright/test";
import { confirmAdultOnForm, LONG, signInAs } from "./helpers";

/**
 * /home — the home of a signed-in person with no project yet (docs/THESIS_REVIEW.md package 2.4). Signs in as its own
 * account (the dev bootstrap creates it with no business on first sight, as for the example viewer), completes the
 * profile once, and checks that `/` lands on the home instead of the doors, at 1280 and at 390 px. Stack and commands:
 * e2e/README.md.
 */
const PERSON_ID = process.env.E2E_PERSON_HOME_ID ?? "e2e0e2e0-0000-4000-8000-0000000a0e01";

async function signInWithProfile(page: Page): Promise<void> {
  await signInAs(page, PERSON_ID, "/");
  const form = page.getByTestId("onboarding-form");
  await expect(form.or(page.getByTestId("person-home"))).toBeVisible({ timeout: LONG });
  if (await form.isVisible()) {
    await page.getByLabel(/What the team calls you/).fill("Robin");
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    await confirmAdultOnForm(page);
    await page.getByTestId("profile-submit-bottom").click();
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
    await page.goto("/");
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("the home of a person with no project (2.4)", () => {
  test("`/` lands on the home, which leads with Start something and offers finding people beside it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithProfile(page);
    await expect(page).toHaveURL(/\/home$/, { timeout: LONG });
    await expect(page.getByTestId("person-home")).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Robin");
    await expect(page.getByTestId("home-start-link")).toHaveAttribute("href", "/new");
    // The people layer is open on the e2e stack (LIVE_MODE=1): the offer links to it. Nobody is suggested.
    await expect(page.getByTestId("home-find")).toContainText("you can do all of it on your own");
    await expect(page.getByTestId("home-waiting")).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // Two columns on a wide screen: the offer sits beside Start something, not under it.
    const startWide = await page.getByTestId("home-start").boundingBox();
    const findWide = await page.getByTestId("home-find").boundingBox();
    expect(Math.abs(findWide!.y - startWide!.y)).toBeLessThan(2);

    await page.getByTestId("home-start-link").click();
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
  });

  test("works from 390 px: no larger-window ask, no sideways scroll, both choices reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithProfile(page);
    await expect(page).toHaveURL(/\/home$/, { timeout: LONG });
    await expect(page.getByTestId("person-home")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByTestId("home-start-link")).toBeVisible();
    await expect(page.getByTestId("home-find")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const start = await page.getByTestId("home-start-link").boundingBox();
    expect(start && start.x >= 0 && start.x + start.width <= 390).toBe(true);
    // A finger's target (DESIGN §6 tap-target), and one column: the find card sits under Start something.
    expect(start!.height).toBeGreaterThanOrEqual(44);
    const startCard = await page.getByTestId("home-start").boundingBox();
    const findCard = await page.getByTestId("home-find").boundingBox();
    expect(findCard!.y).toBeGreaterThanOrEqual(startCard!.y + startCard!.height);
  });
  test("Find a project or people opens the Network in the person frame, with no connect control (2.4)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithProfile(page);
    await expect(page.getByTestId("person-home")).toBeVisible({ timeout: LONG });
    await page.getByRole("link", { name: /Find a project or people/ }).click();
    await expect(page).toHaveURL(/\/network$/, { timeout: LONG });
    await expect(page.getByTestId("network-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("person-live-frame")).toBeVisible();
    // No business shell, no business notice, nothing that asks to connect.
    await expect(page.getByTestId("personal-notice")).toHaveCount(0);
    await expect(page.getByTestId("ask-to-connect")).toHaveCount(0);
    await expect(page.getByTestId("profile-connect")).toHaveCount(0);
    // The adult confirmation is the same as for anyone: confirm it when the screen asks, then Communities is one click away.
    const notice = page.getByTestId("adult-notice");
    if (await notice.isVisible().catch(() => false)) {
      await notice.getByRole("checkbox").click();
      await page.getByTestId("adult-confirm").click();
      await expect(notice).toHaveCount(0, { timeout: LONG });
    }
    await page.getByTestId("person-live-nav").getByRole("link", { name: "Communities" }).click();
    await expect(page).toHaveURL(/\/communities$/, { timeout: LONG });
    await expect(page.getByTestId("person-live-frame")).toBeVisible({ timeout: LONG });
    await page.getByTestId("person-live-home").click();
    await expect(page).toHaveURL(/\/home$/, { timeout: LONG });
  });

  test("the people pages work from 390 px: Network, Communities and the public profile (2.1 part B)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithProfile(page);
    await expect(page.getByTestId("person-home")).toBeVisible({ timeout: LONG });
    await page.getByRole("link", { name: /Find a project or people/ }).click();
    await expect(page).toHaveURL(/\/network$/, { timeout: LONG });
    await expect(page.getByTestId("network-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByTestId("ask-to-connect")).toHaveCount(0);
    const notice = page.getByTestId("adult-notice");
    if (await notice.isVisible().catch(() => false)) {
      await notice.getByRole("checkbox").click();
      await page.getByTestId("adult-confirm").click();
      await expect(notice).toHaveCount(0, { timeout: LONG });
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // One column: messages (the main column) come before the side panels, and the frame's links are finger-sized.
    const messages = await page.getByTestId("messages-panel").boundingBox();
    const search = await page.getByTestId("people-search-input").boundingBox();
    expect(messages!.y).toBeLessThan(search!.y);
    expect(messages!.width).toBeGreaterThan(300);
    for (const link of await page.getByTestId("person-live-nav").getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }

    await page.getByTestId("person-live-nav").getByRole("link", { name: "Communities" }).click();
    await expect(page).toHaveURL(/\/communities$/, { timeout: LONG });
    await expect(page.getByTestId("communities-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a community" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.goto("/public-profile");
    await expect(page.getByTestId("public-profile-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const editor = await page.getByTestId("public-profile-editor").boundingBox();
    const preview = await page.getByTestId("public-profile-preview").boundingBox();
    expect(preview!.y).toBeGreaterThan(editor!.y + editor!.height - 1);
  });
});
