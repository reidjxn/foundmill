import { expect, test, type Page } from "@playwright/test";
import { LONG, signInAs } from "./helpers";

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
});
