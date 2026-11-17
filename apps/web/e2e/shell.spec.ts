import { expect, test, type Locator } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, openSettings, settled } from "./helpers";

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
    // "/\evil.example" and "/<tab>/evil.example" resolve to https://evil.example/ with `new URL(next, here)`; the
    // dot-segment forms collapse to the path "//evil.example", which Next's proxy turns into a protocol-relative Location
    // (audit PAS-1).
    for (const next of ["%2F%5Cevil.example", "%2F%09%2Fevil.example", "%2F.%2F%2Fevil.example", "%2F..%2F%2Fevil.example", "%2F%252e%252e%2F%2Fevil.example", "%2F..%2F%2Fevil.example%2Fphish%3Fa%3D1"]) {
      const signIn = await page.request.get(`/auth/dev?next=${next}`, { maxRedirects: 0 });
      expect(signIn.status(), next).toBe(303);
      expect(new URL(signIn.headers().location ?? "", origin).origin, next).toBe(origin);
      // Signed in now (the dev cookie): the proxy sends /login on to next.
      const signedIn = await page.request.get(`/login?next=${next}`, { maxRedirects: 0 });
      expect(signedIn.status(), next).toBe(307);
      expect(new URL(signedIn.headers().location ?? "", origin).origin, next).toBe(origin);
      expect(signedIn.headers().location ?? "", next).not.toMatch(/^\/\//);
    }
  });

  test("GET /auth/signout does not sign anyone out: only the sign-out form's POST does (audit PAS-8)", async ({ page }) => {
    await openBusiness(page);
    const get = await page.request.get("/auth/signout", { maxRedirects: 0 });
    expect([404, 405]).toContain(get.status());
    // Still signed in: the business opens.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  });

  test("signing out in one tab sends the browser's other tabs to sign-in, and closes their stream socket (audit RES-08)", async ({ page, context }) => {
    await openBusiness(page);
    const other = await context.newPage();
    await other.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(other.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    // The other tab hears the sign-out on a BroadcastChannel, which does not queue messages for a listener that is not
    // there yet: it must be hydrated (its watcher mounts with the first commit) before this tab signs out.
    await settled(other);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: LONG });
    await expect(other).toHaveURL(/\/login\?next=/, { timeout: LONG });
    await expect(other.getByTestId("app-shell")).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: /^(Continue|\d+ things? needs? you before the team can work|Pause|Come back)/ })).toBeVisible();
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

  test("the command palette keeps its operators out of sight until > or a colon, answers \"what is runway\" from Help, and offers the keyboard shortcuts (B12)", async ({ page }) => {
    await page.keyboard.press("Control+K");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(palette.getByTestId("palette-operators")).toHaveCount(0);
    await expect(palette.getByRole("option", { name: /Keyboard shortcuts/ })).toBeVisible();
    await page.keyboard.type("what is runway");
    const term = palette.getByRole("option", { name: /Runway.*How many months your cash lasts/ });
    await expect(term).toBeVisible({ timeout: LONG });
    await expect(palette.getByTestId("palette-operators")).toHaveCount(0);
    // Words that match no place, record or term: Ask leads alone, carrying them to an agent (CommandPalette "lets Ask
    // lead when the query matches nothing else"). The "Nothing matches…" empty state is for a palette with no Ask rows
    // either (a business without agents); its words are covered by the Dugout unit test.
    await page.getByRole("combobox").fill("qqqqzzzz");
    await expect(palette.getByRole("option").first()).toContainText("“qqqqzzzz”", { timeout: LONG });
    await expect(palette.locator("[cmdk-group-heading]")).toHaveText(["Ask"]);
    await expect(palette.locator("[cmdk-item]:not([data-kind='ask'])")).toHaveCount(0);
    await page.getByRole("combobox").fill(">");
    await expect(palette.getByTestId("palette-operators")).toBeVisible();
    await page.getByRole("combobox").fill("");
    await palette.getByRole("option", { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByTestId("keyboard-help")).toBeVisible();
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
    // Arrow keys: Up from the first item wraps to the last stop, the wordmark; Down returns to Today.
    const home = nav.getByRole("link", { name: "Today" });
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
    // The last stop is the foot's Sign out (c9dd4bb), a button: it posts to /auth/signout rather than navigating.
    await expect(nav.getByRole("button", { name: "Sign out" })).toBeFocused();
    // Leave the stored preference as it was found. From the keyboard: collapsed, the toggle sits where the Next.js
    // development indicator floats over the bottom-left corner in `next dev`, which would swallow a pointer click.
    await page.getByTestId("sidebar-toggle").press("Enter");
    await expect(nav).not.toHaveAttribute("data-collapsed", "true");
    await expect(brand).toBeVisible();
  });

  test("Continue stays Continue while notes wait for an answer, and the Inbox's Needs you tab holds them (Nov 7, 2026)", async ({ page }) => {
    // The seed leaves Northwind with decisions waiting (inbox.list counts.respond ≥ 1). A decision never holds Continue:
    // the button keeps its one meaning, and the sidebar's Needs you counts what needs the founder.
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("button", { name: /needs? you before the team can work/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Needs you/ }), "the seeded Northwind inbox has notes waiting for an answer; re-seed if none are left").toContainText(/\d/, { timeout: LONG });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox?tab=respond`);
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "respond", { timeout: LONG });
    await expect(page.getByRole("tab", { name: /^Needs you/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("inbox-list").locator("[data-inbox-row][data-needs-answer='true']").first()).toBeVisible({ timeout: LONG });
  });

  test("the sidebar asks the founder's questions, Contacts is a Customers tab, the Anthropic key stays out of its foot, and its \"?\" cap opens the keyboard shortcuts (B13, B15)", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    // Founder areas (2026-11-09): no department and no Contacts item; the CRM is a Customers tab.
    await expect(nav.locator("[data-sidebar-item='area-customers']")).toBeVisible({ timeout: LONG });
    await expect(nav.getByRole("link", { name: "Contacts" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "CRM" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Anthropic key" })).toHaveCount(0);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/crm`);
    await expect(page.getByRole("tablist", { name: "Customers tabs" }).getByRole("tab", { name: "Contacts" })).toHaveAttribute("aria-selected", "true", { timeout: LONG });
    await expect(nav.locator("[data-sidebar-item='area-customers']")).toHaveAttribute("aria-current", "page");
    // Settings › Keys is still a Settings tab (its own spec covers the key), reached from Settings.
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
    await nav.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByTestId("keyboard-help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("keyboard-help")).toHaveCount(0);
  });

  test("the top bar says what each control does: Continue, the mode chip, the runway chip and Stop all agents carry plain sentences (B1, B3, B8, B6)", async ({ page }) => {
    const tooltip = page.getByRole("tooltip");
    // A Playwright hover is one jump of the pointer. Radix keeps the tooltip just left open while the pointer is "in
    // transit" toward it and ends that only on the next pointer move, which a real mouse always makes and a single jump
    // never does: the old tooltip would stay and the new one never open. Nudge the pointer until exactly one tooltip,
    // the hovered control's, is showing (strict mode fails while two are).
    const hoverFor = async (target: Locator, check: () => Promise<void>) => {
      await target.hover();
      let nudge = 1;
      await expect(async () => {
        const box = (await target.boundingBox())!;
        nudge = -nudge;
        await page.mouse.move(box.x + box.width / 2 + nudge, box.y + box.height / 2);
        await check();
      }).toPass({ timeout: LONG });
    };
    // The mode chip says what the team can do in plain words, and its tooltip where to change it (founder, 2026-11-07).
    await hoverFor(page.getByRole("button", { name: /^What the team can do: / }), () => expect(tooltip).toContainText(/^(On vacation\. )?The team .*Change it in Settings › What the team can do\./, { timeout: 2_000 }));
    await hoverFor(page.getByTestId("kit-bar").locator("[data-runway-tone]"), () => expect(tooltip).toContainText("Runway: how many months your cash lasts", { timeout: 2_000 }));
    await hoverFor(page.getByTestId("stop-all-trigger"), () => expect(tooltip).toHaveText("Stop all agents (pauses everything, nothing is lost)", { timeout: 2_000 }));
    // The strip under the top bar has a sentence too, as its name.
    await expect(page.getByTestId("kit-bar").locator("xpath=following-sibling::*[@role='status']")).toHaveAttribute("aria-label", /(are|is) working|The team is idle/);
  });

  test("shows NeedsLargerWindow below 1280 px (BUILD §2.1 rule 10)", async ({ page }) => {
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(page.getByTestId("needs-larger-window")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test("G then an area's letter opens the area (G M Money); settings tabs resolve", async ({ page }) => {
    const shell = page.getByTestId("app-shell");
    const money = shell.locator("nav [data-sidebar-item='area-money']");
    await expect(money).toBeVisible({ timeout: LONG });
    await expect(money).toHaveAttribute("aria-keyshortcuts", "G M");
    // The chord is pending between the two keys (data-chord-pending on the shell), so the letter is not sent too early.
    await page.keyboard.press("g");
    await expect(shell).toHaveAttribute("data-chord-pending", "true");
    await page.keyboard.press("m");
    await expect(page).toHaveURL(/\/d\/finance\/overview$/);
    await expect(money).toHaveAttribute("aria-current", "page");
    for (const tab of ["business", "mode", "departments", "glossary", "members", "integrations", "keys", "billing", "preferences", "danger"]) {
      await openSettings(page, tab);
    }
  });

  test("the Simulate panel is development-only: absent from Settings › Integrations on the test stack, and nothing calls ingest from the browser (SEC-2)", async ({ page }) => {
    // `simulatePanelAvailable` (lib/env.ts) is true in development only (never staging), and apps/api answers `dev.simulate`
    // with 404 under APP_ENV=test, so the panel must not render here. SimulatePanel's own path through the API is
    // covered by components/settings/__tests__/IntegrationsTab.test.tsx.
    const ingestRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/simulate\//.test(req.url()) && !/\/trpc\//.test(req.url())) ingestRequests.push(req.url());
    });
    const screen = await openSettings(page, "integrations");
    await expect(screen.getByText("Connectors", { exact: true }).first()).toBeVisible();
    await expect(screen.getByTestId("simulate-panel")).toHaveCount(0);
    await expect(screen.locator("[data-simulate]")).toHaveCount(0);
    expect(ingestRequests).toEqual([]);
  });
});
