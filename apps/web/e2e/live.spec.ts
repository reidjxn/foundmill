import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, signIn } from "./helpers";

/**
 * The LIVE pages (BUILD §6.2, §11.14): /network, /communities[/id] and /leaderboards[/boardId], opened from the sidebar of
 * the seeded Ledgerly (the LIVE business; Northwind is Personal and has no LIVE block). They sit outside /b/[bid], so
 * the shell takes its business from the one the founder last opened. The demo seed gives Ledgerly a community with posts
 * and a board it leads; it gives the founder no connections or messages, so the Network lists show their empty states.
 * Stack and commands: e2e/README.md.
 */
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** Signs in, opens a business Home (its layout remembers the business) and waits for the shell. */
async function openHome(page: Page, businessId: string): Promise<void> {
  await signIn(page);
  await page.goto(`/b/${businessId}/home`);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  await page.waitForLoadState("networkidle", { timeout: LONG });
}

test.describe("live pages from the sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await openHome(page, LEDGERLY_BUSINESS_ID);
  });

  test("Network: opens inside the shell with the strip, requests, messages, connections and the visibility control", async ({ page }) => {
    await nav(page).getByRole("link", { name: "Network" }).click();
    await expect(page).toHaveURL(/\/network$/, { timeout: LONG });
    await expect(page.getByTestId("network-screen")).toBeVisible({ timeout: LONG });
    // The same shell as the business pages: Ledgerly's bar, the sidebar with the LIVE item lit, the Foundmill wordmark.
    await expect(page.getByTestId("kit-bar")).toContainText("Ledgerly");
    await expect(nav(page).getByRole("link", { name: "Network" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Foundmill" })).toBeVisible();

    const strip = page.getByTestId("network-strip");
    await expect(strip).toContainText("Unread messages");
    await expect(strip).toContainText("Requests waiting");
    await expect(strip).toContainText("Connections");
    await expect(page.getByTestId("requests-panel")).toBeVisible();
    await expect(page.getByTestId("sent-requests-panel")).toBeVisible();
    // Messages are between people: the panel says only the founder's own Send writes one.
    await expect(page.getByTestId("messages-panel")).toContainText("only your own Send sends it");
    await expect(page.getByTestId("connections-panel")).toBeVisible();
    // Not a 404 and not an error panel.
    await expect(page.getByTestId("error-panel")).toHaveCount(0);
  });

  test("Network: the profile visibility control offers the four levels and saves a change (then restores it)", async ({ page }) => {
    await page.goto("/network");
    const panel = page.getByTestId("visibility-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    const radios = panel.getByRole("radio");
    await expect(radios).toHaveCount(4);
    await expect(panel.getByRole("radio", { name: /^Public/ })).toBeVisible();
    await expect(panel.getByRole("radio", { name: /^Connections/ })).toBeVisible();
    await expect(panel.getByRole("radio", { name: /^Community/ })).toBeVisible();
    await expect(panel.getByRole("radio", { name: /^Private/ })).toBeVisible();
    // One is checked once the API has answered.
    await expect(panel.locator("[role=radio][data-state=checked]")).toHaveCount(1, { timeout: LONG });
    const original = (await panel.locator("[role=radio][data-state=checked]").getAttribute("id")) ?? "";
    const other = original === "visibility-connections" ? "visibility-community" : "visibility-connections";

    await panel.locator(`#${other}`).click();
    await expect(panel.locator(`#${other}`)).toHaveAttribute("data-state", "checked", { timeout: LONG });
    await expect(page.getByText(/^Profile visibility: /)).toBeVisible();
    // It is stored: a reload shows the same choice.
    await page.reload();
    await expect(page.getByTestId("visibility-panel").locator(`#${other}`)).toHaveAttribute("data-state", "checked", { timeout: LONG });
    await page.getByTestId("visibility-panel").locator(`#${original}`).click();
    await expect(page.getByTestId("visibility-panel").locator(`#${original}`)).toHaveAttribute("data-state", "checked", { timeout: LONG });
  });

  test("Communities: lists the communities with Join or Leave, opens the feed and posts with Ctrl+Enter", async ({ page }) => {
    await nav(page).getByRole("link", { name: "Communities" }).click();
    await expect(page).toHaveURL(/\/communities$/, { timeout: LONG });
    await expect(page.getByTestId("communities-screen")).toBeVisible({ timeout: LONG });
    await expect(nav(page).getByRole("link", { name: "Communities" })).toHaveAttribute("aria-current", "page");
    const grid = page.getByRole("grid", { name: "Communities" });
    const fintech = grid.getByRole("row", { name: /Fintech ops founders/ });
    await expect(fintech).toBeVisible({ timeout: LONG });

    // Join and Leave toggle on the row; the test ends a member again (the demo founder created this community).
    const leave = grid.getByRole("button", { name: "Leave Fintech ops founders" });
    const join = grid.getByRole("button", { name: "Join Fintech ops founders" });
    if (await leave.isVisible()) {
      await leave.click();
      await expect(join).toBeVisible({ timeout: LONG });
    } else {
      // An earlier run was interrupted outside the community: join, leave and join again.
      await join.click();
      await expect(leave).toBeVisible({ timeout: LONG });
      await leave.click();
      await expect(join).toBeVisible({ timeout: LONG });
    }
    await join.click();
    await expect(leave).toBeVisible({ timeout: LONG });

    // Open it (double-click, as Enter on the focused row does) and read the feed.
    await fintech.dblclick();
    await expect(page).toHaveURL(/\/communities\/[0-9a-f-]{36}$/, { timeout: LONG });
    await expect(page.getByTestId("community-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("profile-header").getByRole("heading", { name: "Fintech ops founders" })).toBeVisible();
    const feed = page.getByTestId("community-feed");
    await expect(feed.getByTestId("feed-post").first()).toBeVisible({ timeout: LONG });
    await expect(feed).toContainText("first-touch to outbound");
    // A post is the person's own unless they choose the business: the choice is offered to the founder, and off by default.
    const asBusiness = page.getByRole("switch", { name: "Post as Ledgerly" });
    await expect(asBusiness).toBeVisible();
    await expect(asBusiness).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Posting as yourself")).toBeVisible();

    // Reply opens the thread under a post, with its own box; the reply lands in it and the toggle counts it.
    const newest = feed.getByTestId("feed-post").first();
    await newest.getByRole("button", { name: "Reply", exact: true }).click();
    const thread = newest.getByTestId("reply-thread");
    await expect(thread).toBeVisible({ timeout: LONG });
    const replyText = `Playwright reply ${Date.now()}`;
    const replyBox = thread.getByLabel("Write a reply");
    await replyBox.fill(replyText);
    await replyBox.press("Control+Enter");
    await expect(thread.getByTestId("feed-reply").filter({ hasText: replyText })).toBeVisible({ timeout: LONG });
    await expect(newest.getByRole("button", { name: /\d+ repl(y|ies)$/ })).toBeVisible({ timeout: LONG });

    // The post box: Ctrl+Enter sends, the field clears and the post heads the feed.
    const text = `Playwright post ${Date.now()}`;
    const box = page.getByLabel("Write a post");
    await box.fill(text);
    await box.press("Control+Enter");
    await expect(feed.getByTestId("feed-post").first()).toContainText(text, { timeout: LONG });
    await expect(feed.getByTestId("feed-post").first()).not.toContainText("Ledgerly");
    await expect(box).toHaveValue("");
    await expect(page.getByTestId("community-members")).toBeVisible();
  });

  test("Leaderboards: lists the boards with the business's position and opens one with its entries", async ({ page }) => {
    await nav(page).getByRole("link", { name: "Leaderboards" }).click();
    await expect(page).toHaveURL(/\/leaderboards$/, { timeout: LONG });
    await expect(page.getByTestId("leaderboards-screen")).toBeVisible({ timeout: LONG });
    await expect(nav(page).getByRole("link", { name: "Leaderboards" })).toHaveAttribute("aria-current", "page");
    const grid = page.getByRole("grid", { name: "Leaderboards" });
    const growth = grid.getByRole("row", { name: /Growth/ });
    await expect(growth).toBeVisible({ timeout: LONG });
    // The seeded Ledgerly leads its growth board; the positions panel and the row both say so.
    await expect(growth).toContainText("#1");
    await expect(page.getByTestId("positions-panel").getByTestId("position-row").first()).toContainText("#1", { timeout: LONG });
    await expect(page.getByTestId("leaderboards-panel")).toContainText("Numbers a founder types in never rank");

    await growth.dblclick();
    await expect(page).toHaveURL(/\/leaderboards\/[0-9a-f-]{36}$/, { timeout: LONG });
    const board = page.getByTestId("leaderboard-screen");
    await expect(board).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kit-bar")).toContainText("Ledgerly");
    const entries = page.getByRole("grid", { name: /entries$/ });
    await expect(entries).toBeVisible({ timeout: LONG });
    await expect(entries.getByRole("columnheader", { name: /Position/ })).toBeVisible();
    await expect(entries.getByRole("columnheader", { name: /Movement/ })).toBeVisible();
    await expect(entries.getByRole("columnheader", { name: /Business/ })).toBeVisible();
    await expect(entries.getByRole("columnheader", { name: /Form/ })).toBeVisible();
    const mine = entries.getByRole("row", { name: /Ledgerly/ });
    await expect(mine).toBeVisible({ timeout: LONG });
    await expect(mine).toContainText("You");
    await expect(mine).toContainText("#1");
    await expect(mine.getByRole("img", { name: "Ledgerly logo" })).toBeVisible();
    await expect(page.getByTestId("leaderboard-entries")).toContainText("Verified integration metrics only");
  });
});

test.describe("live pages and the current business", () => {
  test("the shell follows the business the founder last opened; a Personal one gets a notice, not an error", async ({ page }) => {
    await openHome(page, LEDGERLY_BUSINESS_ID);
    await page.goto("/network");
    await expect(page.getByTestId("network-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kit-bar")).toContainText("Ledgerly");
    await expect(page.getByTestId("personal-notice")).toHaveCount(0);

    // Opening Northwind (Personal) makes it the current business: the same URL now renders in its shell.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    for (const path of ["/network", "/communities", "/leaderboards"]) {
      await page.goto(path);
      await expect(page.getByTestId("kit-bar")).toContainText("Northwind Skincare", { timeout: LONG });
      await expect(page.getByTestId("personal-notice")).toContainText("Personal business", { timeout: LONG });
      await expect(page.getByTestId("error-panel")).toHaveCount(0);
    }
    // The Personal sidebar has no LIVE block, and the page is still a page, not a 404.
    await expect(nav(page).getByRole("link", { name: "Leaderboards" })).toHaveCount(0);
    await expect(page.getByTestId("leaderboards-screen")).toBeVisible();
    await expect(page.getByTestId("positions-panel")).toContainText("Personal business");
  });

  test("the LIVE pages are for signed-in founders: signed out, each goes to /login with the page as next", async ({ page }) => {
    await page.context().clearCookies();
    for (const path of ["/network", "/communities", "/leaderboards"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));
    }
  });
});
