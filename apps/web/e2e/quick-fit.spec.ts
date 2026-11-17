/**
 * WP-14 T2: quick fit before the ideas, sharpen after; time and where you live before take charge.
 *
 * One new person, from the landing page's idea box to their project's Today:
 *   - the kept card has no Founder fit before anything is known about them;
 *   - the first profile's skill tags give it one, and the card says what it rests on ("Fit: N (quick profile)");
 *   - Commit, reached with a profile that never said how much time or where, asks for exactly those two and starts
 *     nothing without them (founder's answer A5, 2026-11-17);
 *   - the Studio offers the long profile once ("Help your team help you"); saving it changes the number in place,
 *     drops the "(quick profile)" basis and offers a fresh set;
 *   - with both answers known, Commit asks nothing more and one press reaches Today.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { LONG, answerFirstProfile } from "./helpers";

const fitOnKeptCard = (page: Page) => page.locator("[data-testid=card-kept] [data-idea-rating=founder_fit]");
const fitNumber = (line: string) => Number(/^Fit: (\d+)/.exec(line)?.[1]);

test("a new person sees fit with its basis on the first idea, is asked time and place at Commit, and sharpening changes the number in place", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    // Its own address, so this card fills no other test's window (the api reads the last X-Forwarded-For on a test stack).
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    await page.route("**/idea-box/draft", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }));
    await page.goto("/");
    await page.getByTestId("idea-input").fill("Bookkeeping reminders for freelance designers");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await page.getByTestId("idea-build").click();
    await expect(page).toHaveURL(/\/login\?next=%2Fstart%3Fclaim%3D/);
    const next = new URL(page.url()).searchParams.get("next")!;
    await page.goto(`/auth/dev?as=${randomUUID()}&next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/new\/card\/keep/, { timeout: LONG });
    await page.getByTestId("card-keep").click();
    await expect(page).toHaveURL(/\/new\/card\/[0-9a-f-]{36}$/, { timeout: LONG });
    const ideaId = new URL(page.url()).pathname.split("/").pop()!;

    // Nothing is known about the person yet: no fit number.
    await expect(fitOnKeptCard(page)).toHaveAttribute("data-unmeasured", "");

    // The first profile: two skill tags, and neither time nor place.
    await page.getByTestId("card-kept-next").click();
    await expect(page.getByTestId("first-profile")).toBeVisible({ timeout: LONG });
    for (const tag of ["Building software", "Finding and winning customers", "Product and brand", "Money and pricing", "I know my market"]) await page.getByRole("button", { name: tag, exact: true }).click();
    await answerFirstProfile(page, "Quick Fit", { about: false });
    await expect(page).toHaveURL(new RegExp(`/new/commit/${ideaId}$`), { timeout: LONG });

    // Take charge is stopped for exactly the two answers, and nothing starts.
    const about = page.getByTestId("commit-about-you");
    await expect(about).toBeVisible({ timeout: LONG });
    await expect(about.getByRole("radiogroup", { name: "How much time can you give?" })).toBeVisible();
    await expect(about.getByLabel("Where do you live?")).toBeVisible();
    await expect(about.locator("input:not([type=radio]), [role=radiogroup]")).toHaveCount(2);
    await page.getByTestId("take-charge").click();
    await expect(page.getByText("2 things to fix first")).toBeVisible();
    await expect(about.getByText("Pick how much time you can give.")).toBeVisible();
    await expect(about.getByText("Tell your team where you live.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/new/commit/${ideaId}$`));

    // The kept card now has a fit number and says what it rests on. Every tag was picked, so it is above neutral.
    await page.goto(`/new/card/${ideaId}`);
    const basis = fitOnKeptCard(page).locator("[data-idea-fit-basis=quick]");
    await expect(basis).toHaveText(/^Fit: \d+ \(quick profile\)$/, { timeout: LONG });
    const quick = fitNumber((await basis.textContent())!);

    // The Studio says the same on the card and offers the long profile once.
    await page.goto("/new/ideate");
    const card = page.locator(`[data-concept="${ideaId}"]`);
    await expect(card.locator("[data-concept-fit-basis=quick]")).toHaveText(`Fit: ${quick} (quick profile)`, { timeout: LONG });
    const offer = page.getByTestId("sharpen-offer");
    await expect(offer).toContainText("Help your team help you");
    await expect(offer).toContainText("Fit is based on your quick answers. Two minutes to sharpen it?");
    await page.getByTestId("sharpen-go").click();

    // The long profile: the quick ratings are there to sharpen; every skill goes to its lowest.
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await expect(page.getByText("Your team will suggest ideas that fit your skills, your time and your budget.")).toBeVisible();
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    const toggle = page.getByTestId("profile-detail-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    for (const skill of ["engineering", "sales", "design", "finance", "domain"]) {
      const slider = page.locator(`[data-skill=${skill}]`).getByRole("slider");
      await expect(slider).toHaveAttribute("aria-valuenow", "14");
      await slider.focus();
      await slider.press("Home");
      await expect(slider).toHaveAttribute("aria-valuenow", "1");
    }
    await page.getByTestId("profile-submit-bottom").click();

    // Back in the Studio: the number changed in place, the basis is gone, and a fresh set is offered.
    await expect(page).toHaveURL(/\/new\/ideate\?sharpened=1$/, { timeout: LONG });
    await expect(page.getByTestId("sharpen-done")).toContainText("Fit now rests on your full profile");
    await expect(page.getByTestId("sharpen-redraft")).toBeVisible();
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(card.locator("[data-concept-fit-basis]")).toHaveCount(0);
    await page.goto(`/new/card/${ideaId}`);
    await expect(fitOnKeptCard(page)).not.toHaveAttribute("data-unmeasured", "");
    await expect(fitOnKeptCard(page).locator("[data-idea-fit-basis]")).toHaveCount(0);
    const sharp = Number(await fitOnKeptCard(page).getByRole("meter").getAttribute("aria-valuenow"));
    expect(sharp).toBeGreaterThanOrEqual(1);
    expect(sharp).toBeLessThan(quick);

    // Commit asks only for what is still unknown (where they live), then one press starts the project.
    await page.goto(`/new/commit/${ideaId}`);
    await expect(about).toBeVisible({ timeout: LONG });
    await expect(about.getByRole("radiogroup")).toHaveCount(0);
    await about.getByLabel("Where do you live?").fill("Canada");
    await page.getByTestId("take-charge").click();
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/today/, { timeout: LONG });
  } finally {
    await context.close();
  }
});
