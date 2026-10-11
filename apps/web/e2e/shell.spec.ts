import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/**
 * Web core screens: login, the AppShell at 1440 px, NeedsLargerWindow below 1280 px, G chords, Settings tabs and the
 * development-only Simulate panel. Stack and commands: e2e/README.md.
 */
test.describe("login", () => {
  test("renders the magic-link form and, in development, the dev bypass", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
    await expect(page.getByTestId("dev-bypass")).toBeVisible();
  });

  test("the sign-in frame: the wordmark lock-up, one titled panel and no developer notes", async ({ page }) => {
    await page.goto("/login");
    const panel = page.getByTestId("brand-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Sign in", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/DEV_AUTH_USER_ID|Supabase/);
  });

  test("redirects a signed-out visitor from a business route to /login with next", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("a link opened on a different address says so above a form that can send a new one", async ({ page }) => {
    await page.goto("/login?error=other_address&next=%2Fb%2Fx");
    const notice = page.getByTestId("login-link-problem");
    await expect(notice).toContainText("Link opened on a different address");
    await expect(notice).toContainText("Send a new link from this page and open it in this browser.");
    await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  });

  test("/auth/callback with a code it cannot use lands on the login notice, not a bare form", async ({ page }) => {
    // The e2e stack has no Supabase, so the callback reports that; production reports the reason Supabase gave.
    await page.goto("/auth/callback?code=x&next=%2Fb%2Fx");
    await expect(page).toHaveURL(/\/login\?error=not_configured&next=%2Fb%2Fx$/);
    await expect(page.getByTestId("login-link-problem")).toContainText("Sign-in unavailable");
  });

  test("signing in never leaves this origin, even for a next a browser reads as another host", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    // "/\evil.example" and "/<tab>/evil.example" resolve to https://evil.example/ with `new URL(next, here)`.
    for (const next of ["%2F%5Cevil.example", "%2F%09%2Fevil.example"]) {
      const signIn = await page.request.get(`/auth/dev?next=${next}`, { maxRedirects: 0 });
      expect(signIn.status(), next).toBe(303);
      expect(new URL(signIn.headers().location ?? "", origin).origin, next).toBe(origin);
      // Signed in now (the dev cookie): the proxy sends /login on to next.
      const signedIn = await page.request.get(`/login?next=${next}`, { maxRedirects: 0 });
      expect(signedIn.status(), next).toBe(307);
      expect(new URL(signedIn.headers().location ?? "", origin).origin, next).toBe(origin);
    }
  });
});

test.describe("not found", () => {
  test("an address with no business behind it gets the branded page and one way on", async ({ page }) => {
    await openBusiness(page);
    await page.goto("/b/00000000-0000-4000-8000-0000000000ff/home");
    await expect(page.getByTestId("brand-panel")).toBeVisible({ timeout: LONG });
    await expect(page.getByText("Nothing at this address")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to your business" })).toHaveAttribute("href", "/");
  });
});

test.describe("shell", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("renders the AppShell at 1440 px with sidebar, brand-colour bar and Continue", async ({ page }) => {
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("kit-bar")).toBeVisible();
    await expect(page.getByTestId("kit-bar")).toContainText("Northwind Skincare");
    await expect(page.getByRole("button", { name: /^(Continue|Respond to \d+ items?|Pause|Go to Journey|Come back)/ })).toBeVisible();
    await expect(page.getByTestId("stop-all-trigger")).toBeVisible();
    // The sidebar foot closes with the Foundmill wordmark (DESIGN §8a); see the next test.
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Foundmill" })).toBeVisible();
  });

  test("Sign out sits in the sidebar foot, ends the session and lands on the sign-in page", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: LONG });
    // Signed out for real: the business sends this visitor back to sign in.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: LONG });
  });

  test("the command palette offers Sign out", async ({ page }) => {
    await page.keyboard.press("Control+K");
    await page.keyboard.type("log out");
    await expect(page.getByRole("option", { name: /Sign out/ }).first()).toBeVisible({ timeout: LONG });
  });

  test("the sidebar foot closes with the Foundmill wordmark alone: a link to /, aligned with the icons, hidden when collapsed, reachable by arrow keys (DESIGN §8a)", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    const brand = nav.getByRole("link", { name: "Foundmill" });
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute("href", "/");
    // The wordmark is the whole content: one vector image, no text and no FM monogram (that is the favicon only).
    await expect(brand.locator("svg")).toHaveCount(1);
    await expect(brand).toHaveText("");
    const wordmark = (await brand.locator("svg").boundingBox())!;
    const settingsIcon = (await nav.getByRole("link", { name: "Settings" }).locator("svg").first().boundingBox())!;
    expect(wordmark.height).toBeGreaterThanOrEqual(12);
    expect(wordmark.height).toBeLessThanOrEqual(14);
    expect(wordmark.x).toBeCloseTo(settingsIcon.x, 0);
    // Arrow keys: Up from the first item wraps to the last stop, the wordmark; Down returns to Home.
    const home = nav.getByRole("link", { name: "Home" });
    await home.focus();
    await page.keyboard.press("ArrowUp");
    await expect(brand).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(home).toBeFocused();
    // Collapsed to 64 px there is no room for it, and no mark takes its place.
    await page.getByTestId("sidebar-toggle").click();
    await expect(nav).toHaveAttribute("data-collapsed", "true");
    await expect(nav.getByRole("link", { name: "Foundmill" })).toHaveCount(0);
    await expect(nav.locator("[data-sidebar-item=brand]")).toHaveCount(0);
    await home.focus();
    await page.keyboard.press("ArrowUp");
    await expect(nav.getByRole("link", { name: "Anthropic key" })).toBeFocused();
    // Leave the stored preference as it was found. From the keyboard: collapsed, the toggle sits where the Next.js
    // development indicator floats over the bottom-left corner in `next dev`, which would swallow a pointer click.
    await page.getByTestId("sidebar-toggle").press("Enter");
    await expect(nav).not.toHaveAttribute("data-collapsed", "true");
    await expect(brand).toBeVisible();
  });

  test("Continue reads Respond · N while notes wait for an answer and opens the first of them (AC-11.3.3)", async ({ page }) => {
    // The seed leaves Northwind with decisions waiting (inbox.list counts.respond ≥ 1), so Continue is blocked here;
    // the idle Continue → business.continue path is exercised on a fresh business in inbox.spec.ts.
    const respond = page.getByRole("button", { name: /^Respond to \d+ items?$/ });
    await expect(respond, "the seeded Northwind inbox has notes waiting for an answer; re-seed if none are left").toBeVisible({ timeout: LONG });
    await expect(respond).toHaveText(/^Respond · \d+$/);
    await respond.click();
    await page.waitForURL(/\/inbox\/[0-9a-f-]{36}/, { timeout: LONG });
    await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", /unread|read/);
  });

  test("shows NeedsLargerWindow below 1280 px (BUILD §2.1 rule 10)", async ({ page }) => {
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(page.getByTestId("needs-larger-window")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test("G then letter navigates to a department; settings tabs resolve", async ({ page }) => {
    const shell = page.getByTestId("app-shell");
    const dept = shell.locator("nav a[href*='/d/'][aria-keyshortcuts^='G ']").first();
    await expect(dept).toBeVisible();
    const chord = (await dept.getAttribute("aria-keyshortcuts")) ?? "";
    const letter = chord.split(" ")[1];
    expect(letter, "every department link carries a G chord").toMatch(/^[A-Z]$/);
    const target = (await dept.getAttribute("href"))!;
    // The chord is pending between the two keys (data-chord-pending on the shell), so the letter is not sent too early.
    await page.keyboard.press("g");
    await expect(shell).toHaveAttribute("data-chord-pending", "true");
    await page.keyboard.press(letter!.toLowerCase());
    await expect(page).toHaveURL(new RegExp(`${target.replace(/\/[^/]+$/, "")}(/|$)`));
    await expect(page).toHaveURL(/\/d\//);
    for (const tab of ["business", "mode", "departments", "glossary", "members", "integrations", "keys", "billing", "danger"]) {
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/settings/${tab}`);
      await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", tab, { timeout: LONG });
    }
  });

  test("the Simulate panel is development-only: absent from Settings › Integrations on the test stack, and nothing calls ingest from the browser (SEC-2)", async ({ page }) => {
    // `simulatePanelAvailable` (lib/env.ts) is true in development and staging only, and apps/api answers `dev.simulate`
    // with 404 under APP_ENV=test, so the panel must not render here. SimulatePanel's own path through the API is
    // covered by components/settings/__tests__/IntegrationsTab.test.tsx.
    const ingestRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/simulate\//.test(req.url()) && !/\/trpc\//.test(req.url())) ingestRequests.push(req.url());
    });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/settings/integrations`);
    await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "integrations", { timeout: LONG });
    await expect(page.getByText("Connectors", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("simulate-panel")).toHaveCount(0);
    await expect(page.locator("[data-simulate]")).toHaveCount(0);
    expect(ingestRequests).toEqual([]);
  });
});
