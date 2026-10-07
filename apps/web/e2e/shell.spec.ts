import { expect, test } from "@playwright/test";

/**
 * Web core screens (not run in the build container: no browser). Needs apps/api in mock mode with
 * DEV_AUTH_USER_ID set to a seeded owner and NEXT_PUBLIC_APP_ENV=development.
 */
test.describe("login", () => {
  test("renders the magic-link form and, in development, the dev bypass", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
    await expect(page.getByTestId("dev-bypass")).toBeVisible();
  });

  test("redirects a signed-out visitor from a business route to /login with next", async ({ page }) => {
    await page.goto("/b/00000000-0000-4000-8000-000000000001/home");
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});

test.describe("shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  });

  test("renders the AppShell at 1440 px with sidebar, brand-colour bar and Continue", async ({ page }) => {
    test.skip(!/\/b\//.test(page.url()), "no seeded business for the dev user");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("kit-bar")).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue|Respond|Pause|Go to Journey|Come back/ })).toBeVisible();
    await expect(page.getByTestId("stop-all-trigger")).toBeVisible();
    // The sidebar foot carries the product mark (DESIGN §8a).
    await expect(page.locator("[data-sidebar-item=brand]")).toBeVisible();
  });

  test("Continue runs one cycle step through business.continue and reports it", async ({ page }) => {
    test.skip(!/\/b\//.test(page.url()), "no seeded business for the dev user");
    const button = page.getByRole("button", { name: /^Continue$/ });
    test.skip((await button.count()) === 0, "Continue is not idle (blocked items, a win to watch or a holiday)");
    await button.click();
    await expect(page.getByText(/Cycle started|One new note|Cycle resumed|already running/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("shows NeedsLargerWindow below 1280 px (BUILD §2.1 rule 10)", async ({ page }) => {
    test.skip(!/\/b\//.test(page.url()), "no seeded business for the dev user");
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(page.getByTestId("needs-larger-window")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test("G then letter navigates to a department; settings tabs resolve", async ({ page }) => {
    test.skip(!/\/b\//.test(page.url()), "no seeded business for the dev user");
    const dept = page.locator("[data-testid=app-shell] nav a[aria-keyshortcuts^='G ']").first();
    const chord = (await dept.getAttribute("aria-keyshortcuts")) ?? "";
    const letter = chord.split(" ")[1];
    test.skip(!letter, "no department chord");
    await page.keyboard.press("g");
    await page.keyboard.press(letter!.toLowerCase());
    await expect(page).toHaveURL(/\/d\//);
    const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
    for (const tab of ["business", "mode", "departments", "glossary", "members", "integrations", "keys", "billing", "danger"]) {
      await page.goto(`/b/${bid}/settings/${tab}`);
      await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", tab);
    }
  });
});
