import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { confirmAdultOnForm, LONG, signInAs } from "./helpers";

/**
 * Attribution on the web (docs/NETWORK.md §5; lib/via.ts, proxy.ts, app/onboarding). Stack and commands: e2e/README.md.
 *
 * Every address accepts `?via=<reference>`: the first reference a visitor arrives with is kept in the httpOnly `fm_via`
 * cookie (a later one never replaces it, a value that is not a reference sets nothing), it is sent as `via` with the
 * save that creates the person's profile, and the cookie is gone once that save has succeeded. Whether the api records
 * it (a reference that names a public page or person) is the api's own suite (apps/api attribution.test.ts); the
 * reference here names nobody, and the founder's first save goes through exactly as it does without one.
 *
 * Each run signs in as a new account (`/auth/dev?as=<uuid>`), so it never touches the dev founder the other specs share.
 */
const VIA_COOKIE = "fm_via";
const kept = async (context: BrowserContext) => (await context.cookies()).find((c) => c.name === VIA_COOKIE);

test.describe("attribution", () => {
  test("the first `via` is kept out of the page's reach, sent with the save that creates the profile, then cleared", async ({ page, context }) => {
    // A value that is not a reference sets nothing.
    await page.goto("/?via=not-a-reference");
    expect(await kept(context)).toBeUndefined();

    // Signed out, on the landing page, with a reference.
    await page.goto("/?via=u.e2e-referrer");
    expect(await kept(context)).toMatchObject({ value: "u.e2e-referrer", httpOnly: true, sameSite: "Lax", path: "/" });
    expect(await page.evaluate(() => document.cookie)).not.toContain(VIA_COOKIE);

    // First touch wins: another reference, on another address, changes nothing.
    await page.goto("/login?via=p.e2e-someone-else");
    expect((await kept(context))?.value).toBe("u.e2e-referrer");

    // The visitor becomes a person: a new account meets the profile form.
    await signInAs(page, randomUUID(), "/onboarding");
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: LONG });
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("profile-submit")).toHaveText(/^Continue$/);
    await page.getByLabel(/What the team calls you/).fill("Attribution Founder");
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    // A new account confirms it is 18 or older on this form, once (0100).
    await confirmAdultOnForm(page);

    const save = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("founder.profile.update"), { timeout: LONG });
    await page.getByTestId("profile-submit-bottom").click();
    expect((await save).postData() ?? "").toContain('"via":"u.e2e-referrer"');

    // The save went through as it does for anyone, and the cookie is gone.
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible();
    expect(await kept(context)).toBeUndefined();

    // Editing the profile afterwards carries no reference, even when a new one has arrived since.
    await page.goto("/onboarding?via=p.e2e-later");
    await expect(page.getByTestId("profile-submit")).toHaveText(/Save and continue/, { timeout: LONG });
    const edit = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("founder.profile.update"), { timeout: LONG });
    await page.getByTestId("profile-submit-bottom").click();
    expect((await edit).postData() ?? "").not.toContain('"via"');
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
  });
});
