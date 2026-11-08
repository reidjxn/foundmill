import { expect, test, type APIRequestContext } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, NORTHWIND_BUSINESS_ID, devApi, openBusiness, openSwitcher, signIn, setBuilderView } from "./helpers";

// Builder view on for this file (it reads the "Reconnecting…" chip, which a founder without Builder view sees only as "Updates may be late" after 30 s); global-setup.ts starts every run with it off. Restored afterwards.
let builderViewBefore = false;
test.beforeAll(async ({ playwright }) => {
  builderViewBefore = await setBuilderView(playwright, true);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, builderViewBefore);
});

/** lib/chunk-error.ts CHUNK_RELOAD_KEY (a spec cannot import app code that reaches for the window). */
const CHUNK_RELOAD_KEY = "fm.chunk-reload-at";

/** The procedures a tRPC request carries, in batch order ("/api/trpc/inbox.get,inbox.list" → both). */
function procedures(url: URL): string[] {
  const at = url.pathname.indexOf("/trpc/");
  return at < 0 ? [] : decodeURIComponent(url.pathname.slice(at + "/trpc/".length)).split(",");
}

/** A batched read's answer when the API failed it. */
const FAILED_READ = { error: { json: { message: "Internal server error", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } } };

/** A dashboard's stored layout, read as the dev founder. */
async function storedLayout(api: APIRequestContext, dashboardId: string): Promise<unknown> {
  const input = encodeURIComponent(JSON.stringify({ json: { businessId: NORTHWIND_BUSINESS_ID, dashboardId } }));
  const res = await api.get(`/trpc/dashboard.get?input=${input}`);
  expect(res.ok(), `dashboard.get answered ${res.status()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: { layout: unknown } } } }).result.data.json.layout;
}

/**
 * The app shell's resilience and navigation (audit W07): a failed refetch keeps loaded content, a missing record says so,
 * the business menu and palette reach other businesses, Esc closes one layer, and a code chunk that cannot load reloads
 * the page. Stack and commands: e2e/README.md.
 */
test.describe("shell resilience", () => {
  test("a failed background refetch keeps the loaded Inbox on screen with a quiet notice (RES-04)", async ({ page }) => {
    await openBusiness(page, "inbox");
    const rows = page.locator("[data-inbox-row]");
    await expect(rows.first()).toBeVisible({ timeout: LONG });
    const before = await rows.count();
    // Every `inbox.list` read fails from here, wherever it sits in a batch: the refresh opens its new note, and that
    // note's read can share a request with the list's, ahead of it. The other reads in such a batch keep their answers.
    await page.route(
      (url) => procedures(url).includes("inbox.list"),
      async (route) => {
        const procs = procedures(new URL(route.request().url()));
        if (procs.every((p) => p === "inbox.list")) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(procs.map(() => FAILED_READ)) });
        const answers = (await (await route.fetch()).json()) as unknown[];
        return route.fulfill({ status: 207, contentType: "application/json", body: JSON.stringify(answers.map((a, i) => (procs[i] === "inbox.list" ? FAILED_READ : a))) });
      },
    );
    // With guidance on, the first-Continue callout (UX plan §7.7) sits under Continue in the top bar, over the Inbox
    // header's Refresh. It is not modal and "Got it" would mark it done for the whole dev account (first-days.spec.ts
    // expects it), so Refresh is pressed from the keyboard, as billing.spec.ts and crm.spec.ts do.
    const refresh = page.getByTestId("inbox-refresh");
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("refresh-failed").first()).toBeVisible({ timeout: LONG });
    await expect(rows).toHaveCount(before);
    await expect(page.getByTestId("error-panel")).toHaveCount(0);
  });

  test("a note, an agent and a dashboard that are not there say so, with the way back and no Try again (IAE-16, WEB-14)", async ({ page }) => {
    await openBusiness(page);
    const nothing = "00000000-0000-4000-8000-000000000000";
    for (const [path, heading] of [
      [`inbox/${nothing}`, "No such note"],
      [`agents/${nothing}/overview`, "No such agent"],
      [`home/${nothing}`, "No such dashboard"],
    ] as const) {
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/${path}`);
      await expect(page.getByTestId("not-found-panel")).toContainText(heading, { timeout: LONG });
      await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
    }
    // An address that is not an id never reaches the API: Home shows the default dashboard and corrects the address.
    const bad = page.waitForRequest((r) => /dashboard\.get/.test(r.url()) && /not-a-uuid/.test(decodeURIComponent(r.url())), { timeout: 3_000 }).then(() => true, () => false);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home/not-a-uuid`);
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
    expect(await bad).toBe(false);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox/not-a-uuid`);
    await expect(page.getByTestId("not-found-panel")).toContainText("No such note", { timeout: LONG });
  });

  test("a screen whose code cannot load says so in product words and offers a reload (RES-06)", async ({ page }) => {
    // The automatic reload (once a minute at most, lib/chunk-error.ts, unit-tested) has just run, so the panel offers the
    // manual one; and reloading with the screen's code missing would leave nothing to show it.
    const known = new Set<string>();
    page.on("request", (r) => {
      if (r.url().includes("/_next/static/chunks/")) known.add(r.url());
    });
    await openBusiness(page, "inbox");
    await page.evaluate((key) => window.sessionStorage.setItem(key, String(Date.now())), CHUNK_RELOAD_KEY);
    const loaded = new Set(known);
    let blocked = true;
    // Only the chunks the Inbox did not need fail (blocking the shell's own would leave nothing to show the panel).
    await page.route("**/_next/static/chunks/**", (route) => (blocked && !loaded.has(route.request().url()) ? route.fulfill({ status: 404, body: "" }) : route.continue()));
    await page.getByRole("link", { name: "Milestones" }).first().click();
    const panel = page.getByTestId("error-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("was updated");
    await expect(panel.getByRole("button", { name: "Reload" })).toBeVisible();
    expect(await panel.innerText()).not.toContain("Failed to load chunk");
    blocked = false;
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  });

  test("Switch business reaches Today, the other businesses and Create a new business (IAE-08, WEB-13)", async ({ page }) => {
    await openBusiness(page);
    let switcher = await openSwitcher(page);
    // By id: the foundations spec takes charge of throwaways named "Ledgerly <suffix>", which the founder owns too.
    await expect(switcher.locator(`[data-business-id="${LEDGERLY_BUSINESS_ID}"]`)).toBeVisible({ timeout: LONG });
    await switcher.getByRole("option", { name: /^Today$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/today$`));
    switcher = await openSwitcher(page);
    await switcher.getByRole("option", { name: /Create a new business/ }).click();
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
  });

  test("Ctrl+K reaches Create a new business and the other businesses, opens empty each time, and lists records by operators alone (IAE-08, GTM-27)", async ({ page }) => {
    await openBusiness(page);
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox").or(page.getByPlaceholder(/search/i)).first();
    await input.fill("new business");
    await expect(page.getByRole("option", { name: /Create a new business/ }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(input).toHaveValue("");
    await input.fill("role:customer");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: LONG });
    await input.fill("Ledgerly");
    // The seeded Ledgerly alone: the foundations spec takes charge of throwaways named "Ledgerly <suffix>", whose rows
    // read "Switch to Ledgerly <suffix>".
    const ledgerly = page.getByRole("option", { name: /^Switch to Ledgerly\s*Switch business$/ });
    await expect(ledgerly).toBeVisible({ timeout: LONG });
    await ledgerly.click();
    await expect(page).toHaveURL(new RegExp(`/b/${LEDGERLY_BUSINESS_ID}/today$`), { timeout: LONG });
  });

  test("Edit layout is offered only where a layout can be edited (OL-29)", async ({ page }) => {
    await openBusiness(page, "inbox");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Edit layout");
    await expect(page.getByRole("option", { name: /^Edit layout/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Edit layout");
    await expect(page.getByRole("option", { name: /^Edit layout/ })).toBeVisible();
  });

  test("Esc closes the Add widget drawer and leaves Edit mode on (OL-15)", async ({ page }) => {
    await openBusiness(page);
    await page.keyboard.press("e");
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-editing", "true");
    await page.getByRole("button", { name: /Add widget/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-editing", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-screen")).not.toHaveAttribute("data-editing", "true");
  });

  test("a layout edit survives a trip to the Inbox and back, and the next edit builds on it (WEB-09)", async ({ page, playwright }) => {
    await openBusiness(page);
    const screen = page.getByTestId("home-screen");
    const widgets = page.locator("[data-widget-id]");
    // The edit removes the first widget (the Journey Ribbon) from Northwind's default Home, which the specs after this
    // one and the golden path read on the same database: the stored layout is put back afterwards, pass or fail.
    const api = await devApi(playwright);
    const dashboardId = (await screen.getAttribute("data-dashboard-id"))!;
    const original = await storedLayout(api, dashboardId);
    try {
      await page.keyboard.press("e");
      const before = await widgets.count();
      test.skip(before < 2, "the active dashboard has no widget to remove");
      await widgets.first().hover();
      await page.getByRole("button", { name: /^Remove / }).first().click();
      await expect(widgets).toHaveCount(before - 1, { timeout: LONG });
      await page.keyboard.press("Escape");
      // Leaving Edit mode saves the layout: wait until the saved version stops moving before taking it as the baseline.
      await page.waitForLoadState("networkidle", { timeout: LONG });
      let versionAfterEdit = await screen.getAttribute("data-dashboard-version");
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(500);
        const now = await screen.getAttribute("data-dashboard-version");
        if (now === versionAfterEdit) break;
        versionAfterEdit = now;
      }
      await page.getByRole("link", { name: "Inbox" }).first().click();
      await page.waitForURL(/\/inbox/, { timeout: LONG });
      await page.getByRole("link", { name: "Today", exact: true }).first().click();
      await page.getByRole("tab", { name: "Details" }).click();
      await expect(screen).toBeVisible({ timeout: LONG });
      await expect(widgets).toHaveCount(before - 1);
      // Opening Home saved nothing by itself.
      await expect(screen).toHaveAttribute("data-dashboard-version", versionAfterEdit ?? /\d+/);
    } finally {
      const res = await api.post("/trpc/dashboard.update", { data: { json: { businessId: NORTHWIND_BUSINESS_ID, dashboardId, layout: original } } });
      expect(res.ok(), `dashboard.update answered ${res.status()}: ${await res.text()}`).toBe(true);
      await api.dispose();
    }
  });

  test("the live-connection chip appears when the stream is down for a few seconds (RES-11)", async ({ page, context }) => {
    await signIn(page);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    // A connection that is not up yet says nothing for its first seconds (the grace). This stack runs no stream service
    // (README), so the chip is checked as soon as the shell shows: once the grace has run out it is rightly there, and
    // Home with its Journey Ribbon can take longer than that to go quiet on the network.
    await expect(page.getByTestId("connection-chip")).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByTestId("connection-chip")).toBeVisible({ timeout: 20_000 });
    await context.setOffline(false);
    // This stack runs no stream service (README), so the chip cannot clear here; the reconnect that clears it is covered
    // by lib/__tests__/stream.test.ts.
  });
});

test.describe("keyboard focus is visible (A11Y-02, A11Y-20)", () => {
  test("a focused Inbox row draws the 2 px outline", async ({ page }) => {
    await openBusiness(page, "inbox");
    const row = page.locator("[data-inbox-row]").first();
    await expect(row).toBeVisible({ timeout: LONG });
    await page.keyboard.press("Tab");
    await row.focus({ timeout: 5_000 });
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const outline = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(outline.style).not.toBe("none");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});

test.describe("a phone gets the larger-window page, not a slice of the desktop one (PAS-4)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("the sign-in page shows NeedsLargerWindow", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("needs-larger-window")).toBeVisible({ timeout: LONG });
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width/);
  });
});
