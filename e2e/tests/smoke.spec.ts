import { expect, test } from "@playwright/test";

// The golden path (BUILD §17) arrives with the web build. Until then this smoke test keeps the e2e package
// well-formed and checks the staging landing page at the desktop size the product is built for.
test.describe("landing page", () => {
  test("renders the product name as title and heading, with the desktop-only notice", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const name = ((await heading.textContent()) ?? "").trim();
    expect(name.length).toBeGreaterThan(0);
    await expect(page).toHaveTitle(name);
    await expect(page.getByText(/Desktop only/)).toBeVisible();
  });
});
