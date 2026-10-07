import { expect, test } from "@playwright/test";

/**
 * Smoke: the signed-out entry point. `/` is redirected by the web proxy to `/login`, which renders the brand lock-up
 * (the wordmark is an image named after APP_NAME), the desktop-only notice and, in development/test, the dev bypass
 * the golden path signs in with. Keeps the e2e package well-formed when the stack is up but nothing is seeded.
 */
test.describe("landing page", () => {
  test("redirects to /login and renders the product name as the brand mark and in the title, with the desktop-only notice", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    const mark = page.getByRole("main").getByRole("img").first();
    await expect(mark).toBeVisible();
    const name = ((await mark.getAttribute("aria-label")) ?? (await mark.getAttribute("alt")) ?? "").trim();
    expect(name.length).toBeGreaterThan(0);
    await expect(page).toHaveTitle(new RegExp(`${name}$`));
    await expect(page.getByText(/Desktop only/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue as developer" })).toBeVisible();
  });
});
