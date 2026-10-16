import { expect, test, type Request } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, settled, signIn } from "./helpers";

/**
 * The web server's own path (speed round 2): a signed-in `/` goes straight to the last business from the proxy, and a
 * last business that no longer opens costs one hop instead of a dead end or a loop; the app frame goes out before the
 * business layout's data; browser titles follow navigations with one `<title>` in the document; the founder profile
 * the layout read is not asked again by the browser. Stack and commands: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;
/** No business of the dev founder's (and none at all in the seed). */
const GONE = "00000000-0000-4000-8000-0000000000ff";

/** `founder.profile.get` calls in a browser request that carry no input: the shell's, the Inbox's and the reading pane's key. */
function plainProfileReads(req: Request): number {
  const url = new URL(req.url());
  if (!url.pathname.startsWith("/trpc/")) return 0;
  const paths = decodeURIComponent(url.pathname.slice("/trpc/".length)).split(",");
  let inputs: Record<string, { json?: unknown } | undefined> = {};
  try {
    inputs = JSON.parse(url.searchParams.get("input") ?? req.postData() ?? "{}") as typeof inputs;
  } catch {
    return 0;
  }
  return paths.filter((p, i) => p === "founder.profile.get" && inputs[String(i)]?.json == null).length;
}

test.describe("opening the app", () => {
  test("a signed-in `/` with a last business answers with a redirect to its Home, before any page renders", async ({ page, baseURL }) => {
    await openBusiness(page);
    const res = await page.request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers()["location"] ?? "", baseURL).pathname).toBe(`${B}/home`);
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`${B}/home$`), { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  });

  test("a last business that no longer opens is forgotten: `/` picks another, never the dead end, never a loop", async ({ page, context, baseURL }) => {
    await signIn(page);
    await context.addCookies([{ name: "fm_last_business", value: GONE, url: baseURL! }]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/home$|\/new$/, { timeout: LONG });
    expect(page.url()).not.toContain(GONE);
    await expect(page.getByText("Nothing at this address")).toHaveCount(0);
    const cookie = (await context.cookies()).find((c) => c.name === "fm_last_business");
    expect(cookie?.value ?? "").not.toBe(GONE);
    // The same business opened from a link still says it is not there.
    await page.goto(`/b/${GONE}/home`);
    await expect(page.getByText("Nothing at this address")).toBeVisible({ timeout: LONG });
  });
});

test.describe("the business frame", () => {
  test("the app frame and the document head go out before the layout's data, and the shell replaces the frame", async ({ page }) => {
    await signIn(page);
    const res = await page.request.get(`${B}/inbox`);
    expect(res.ok()).toBe(true);
    const html = await res.text();
    const frame = html.indexOf('data-testid="shell-skeleton"');
    const shell = html.indexOf('data-testid="app-shell"');
    expect(frame).toBeGreaterThan(0);
    expect(shell).toBeGreaterThan(frame);
    // The scripts are announced in the head, ahead of the frame.
    expect(html.indexOf("<script")).toBeLessThan(frame);
    await page.goto(`${B}/inbox`);
    await settled(page);
    await expect(page.getByTestId("shell-skeleton")).toHaveCount(0);
  });

  test("the browser title follows a click in the sidebar, with one title in the document", async ({ page }) => {
    /** The page's own titles: an icon's SVG `<title>` is not one. */
    const pageTitles = () => page.evaluate(() => [...document.querySelectorAll("title")].filter((t) => !t.closest("svg")).map((t) => t.textContent));
    await openBusiness(page);
    await expect(page).toHaveTitle(/^Home · Northwind Skincare · /);
    await page.getByRole("navigation", { name: "Primary" }).locator("[data-sidebar-item='inbox']").first().click();
    await expect(page).toHaveURL(new RegExp(`${B}/inbox`), { timeout: LONG });
    await expect(page).toHaveTitle(/^Inbox · Northwind Skincare · /);
    expect(await pageTitles()).toHaveLength(1);
    // A screen with charts (SVG titles above the streamed page title) loaded in full.
    await page.goto(`${B}/d/finance/overview`);
    await settled(page);
    await expect(page).toHaveTitle(/^Overview · Finance · Northwind Skincare · /);
    expect(await pageTitles()).toEqual([await page.title()]);
  });

  test("the founder profile the layout read is not asked again by the shell, the Inbox or the reading pane", async ({ page }) => {
    await signIn(page);
    await page.waitForLoadState("networkidle", { timeout: LONG });
    let asked = 0;
    page.on("request", (req) => (asked += plainProfileReads(req)));
    await page.goto(`${B}/inbox`);
    await settled(page);
    await page.waitForLoadState("networkidle", { timeout: LONG });
    const first = page.getByTestId("shell-content").locator("[data-inbox-row]").first();
    if (await first.count()) {
      await first.click();
      await page.waitForLoadState("networkidle", { timeout: LONG });
    }
    expect(asked).toBe(0);
  });
});
