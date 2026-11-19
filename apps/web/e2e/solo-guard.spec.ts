import { expect, test, type Page } from "@playwright/test";
import { soloGuardViolations } from "@foundmill/shared";
import { LONG, commitThrowaway, dismissCoachmarks, openSettings, settled, signIn } from "./helpers";

/**
 * The standing solo guard (docs/NETWORK.md §10, WP-12 T0): a project with one person, read at 1280 px and at 390 px,
 * says nothing that nudges the founder to add someone, and offers no invite control outside Settings › People. The e2e
 * stack runs with the people layer open (`LIVE_MODE=1`); apps/api's solo-guard.test.ts covers it closed. Every later
 * task that adds copy a solo founder can read adds a case here.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** The visible text of the page's content area, after the page has settled. */
async function visibleText(page: Page): Promise<string> {
  await settled(page);
  return page.getByTestId("app-shell").innerText();
}

const inviteControls = (page: Page) => page.getByRole("button", { name: /invite/i }).or(page.getByRole("link", { name: /invite/i }));

test.describe("solo guard", () => {
  test.describe.configure({ mode: "serial" });
  let bid = "";

  test("a new one-person project reads clean on Today and Needs you at 1280 and at 390 px", async ({ page }) => {
    test.setTimeout(180_000);
    bid = await commitThrowaway(page, `Solo Guard ${Date.now().toString(36)}`);
    for (const size of [DESKTOP, PHONE]) {
      await page.setViewportSize(size);
      for (const path of ["today", "inbox"]) {
        await page.goto(`/b/${bid}/${path}`);
        await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
        await dismissCoachmarks(page);
        const text = await visibleText(page);
        expect(text.length).toBeGreaterThan(50);
        expect(soloGuardViolations(text), `${path} at ${size.width}px`).toEqual([]);
        await expect(inviteControls(page), `${path} at ${size.width}px`).toHaveCount(0);
      }
    }
    await page.setViewportSize(DESKTOP);
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
  });

  test("Team › People lists one row and no invite control; the only invite control is in Settings › People", async ({ page }) => {
    test.skip(!bid, "needs the project made above");
    await signIn(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/b/${bid}/d/team/staff`);
    await expect(page.getByTestId("staff-summary")).toHaveText(/^1 person · /, { timeout: LONG });
    await expect(inviteControls(page)).toHaveCount(0);
    expect(soloGuardViolations(await visibleText(page))).toEqual([]);

    const settings = await openSettings(page, "members", bid);
    await expect(settings.getByTestId("invite-someone")).toBeVisible();
  });
});
