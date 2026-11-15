import { expect, test, type Request } from "@playwright/test";
import { API_URL, LONG, NORTHWIND_BUSINESS_ID, openBusiness, signIn } from "./helpers";

/**
 * Page speed without behaviour change (the network and navigation fixes): the shell's first queries and Home's
 * dashboards arrive with the page instead of being asked after hydration, Home's widgets share one recent ribbon and
 * one department list, and a sidebar click is one navigation. Stack and commands: e2e/README.md.
 */

/**
 * tRPC procedures in a browser request to the API whose input names `businessId`: reads go to the page's own origin
 * (`/api/trpc/a.b,c.d?batch=1…`, rewritten to the API), changes to the API itself (`/trpc/…`).
 */
function procedures(req: Request, businessId: string): string[] {
  const url = new URL(req.url());
  const at = url.pathname.indexOf("/trpc/");
  if (at < 0) return [];
  const paths = decodeURIComponent(url.pathname.slice(at + "/trpc/".length)).split(",");
  const raw = req.method() === "GET" ? url.searchParams.get("input") : req.postData();
  let inputs: Record<string, { json?: { businessId?: unknown } } | undefined> = {};
  try {
    inputs = raw ? (JSON.parse(raw) as typeof inputs) : {};
  } catch {
    return [];
  }
  return paths.filter((_, i) => inputs[String(i)]?.json?.businessId === businessId);
}

test.describe("first load of Home", () => {
  test("the shell's and Home's first queries come with the page; the widgets share their ribbon and departments", async ({ page }) => {
    await signIn(page);
    // signIn may land on a Home (another business's, or this one's) whose widgets are still loading, and network idle
    // can come before they ask: let them answer first, then count only this business's calls, from the load below.
    if (/\/home/.test(page.url())) await expect(page.locator("section[data-department]").first()).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    const asked: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET" && req.method() !== "POST") return;
      asked.push(...procedures(req, NORTHWIND_BUSINESS_ID));
    });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });
    await expect(page.locator("section[data-department]").first()).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });

    // Handed over by the server (lib/hydrate.server.tsx): never asked by the browser on a full load.
    for (const p of ["finance.overview", "cycle.status", "dashboard.list", "dashboard.get"]) expect(asked, p).not.toContain(p);
    // The sidebar's department list came with the page and the widgets read it from the cache.
    expect(asked).not.toContain("department.list");
    // One business-wide ribbon for the strip and every department card (plus the Journey Ribbon's own long range),
    // never one per card.
    expect(asked.filter((p) => p === "journey.ribbon").length).toBeLessThanOrEqual(2);
    // Department cards ask for their tasks in the same round as the other widgets.
    expect(asked.filter((p) => p === "dev.tasks.list").length).toBeGreaterThan(0);
  });
});

test.describe("navigation", () => {
  test("one sidebar click is one navigation, and going back to a screen just seen reuses it", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });

    const navigations: string[] = [];
    page.on("request", (req) => {
      const h = req.headers();
      if (h["rsc"] === "1" && !h["next-router-prefetch"]) navigations.push(new URL(req.url()).pathname);
    });
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    await sidebar.locator("[data-sidebar-item='inbox']").first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/inbox`), { timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    expect(navigations.filter((p) => p.endsWith("/inbox"))).toHaveLength(1);
    expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(2);

    // Back to Today and to Inbox again within the client cache window: no second request for Inbox.
    await sidebar.locator("[data-sidebar-item='home']").first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/today`), { timeout: LONG });
    await sidebar.locator("[data-sidebar-item='inbox']").first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/inbox`), { timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    expect(navigations.filter((p) => p.endsWith("/inbox")).length).toBeLessThanOrEqual(2);
  });
});

test.describe("transport", () => {
  test("reads come from the page's own origin (no CORS preflight); changes go to the API itself", async ({ page }) => {
    const reads: URL[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (req.method() === "GET" && url.pathname.includes("/trpc/")) reads.push(url);
    });
    await openBusiness(page, "inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    const site = new URL(page.url()).origin;
    expect(reads.length).toBeGreaterThan(0);
    for (const url of reads) {
      expect(url.origin, url.href).toBe(site);
      expect(url.pathname.startsWith("/api/trpc/"), url.href).toBe(true);
    }
    // A change (Refresh) goes straight to the API: it can run long. Answered here, so nothing changes on the server.
    const changes: string[] = [];
    await page.route(/\/trpc\/[^?]*inbox\.refresh/, (route) => {
      changes.push(route.request().url());
      return route.fulfill({ status: 503, contentType: "application/json", body: "[]" });
    });
    await page.keyboard.press("r");
    await expect.poll(() => changes.length, { timeout: LONG }).toBe(1);
    expect(new URL(changes[0]!).origin).toBe(new URL(API_URL).origin);
  });
});
