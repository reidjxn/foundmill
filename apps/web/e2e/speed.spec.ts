import { expect, test, type Request } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, signIn } from "./helpers";

/**
 * Page speed without behaviour change (the network and navigation fixes): the shell's first queries and Home's
 * dashboards arrive with the page instead of being asked after hydration, Home's widgets share one recent ribbon and
 * one department list, and a sidebar click is one navigation. Stack and commands: e2e/README.md.
 */

/** tRPC procedures in a browser request to the API (`/trpc/a.b,c.d?batch=1…`) whose input names `businessId`. */
function procedures(req: Request, businessId: string): string[] {
  const url = new URL(req.url());
  if (!url.pathname.startsWith("/trpc/")) return [];
  const paths = decodeURIComponent(url.pathname.slice("/trpc/".length)).split(",");
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
    // signIn may land on another business's Home whose widgets are still loading (network idle can come before they
    // ask): count only this business's calls, from the load below.
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

    // Back to Home and to Inbox again within the client cache window: no second request for Inbox.
    await sidebar.locator("[data-sidebar-item='home']").first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home`), { timeout: LONG });
    await sidebar.locator("[data-sidebar-item='inbox']").first().click();
    await expect(page).toHaveURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/inbox`), { timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    expect(navigations.filter((p) => p.endsWith("/inbox")).length).toBeLessThanOrEqual(2);
  });
});
