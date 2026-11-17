import { expect, test } from "@playwright/test";

/**
 * Smoke: the signed-out entry points. `/` renders the landing page, whose calls to action lead to `/login`, which
 * renders the brand lock-up (the wordmark is an image named after APP_NAME), the note that sign-in works on any screen
 * while the workspace needs 1280 px (Nov 12: `/login` works from 390 px) and, in
 * development/test, the dev bypass the golden path signs in with. Keeps the e2e package well-formed when the stack is
 * up but nothing is seeded.
 */
test.describe("landing page", () => {
  test("shows the landing page, whose Sign in leads to /login with the product name as the brand mark and in the title, and the screen-size note", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible();
    await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
    const mark = page.getByRole("main").getByRole("img").first();
    await expect(mark).toBeVisible();
    const name = ((await mark.getAttribute("aria-label")) ?? (await mark.getAttribute("alt")) ?? "").trim();
    expect(name.length).toBeGreaterThan(0);
    await expect(page).toHaveTitle(new RegExp(`${name}$`));
    await expect(page.getByText(/Sign-in works on any screen\. The workspace itself is built for screens 1280 px wide or more\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue as developer" })).toBeVisible();
  });
});
