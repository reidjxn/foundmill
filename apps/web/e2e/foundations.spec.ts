import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { LONG, UUID, ensureDeck, signIn } from "./helpers";

/**
 * Foundations on the first open (BUILD §11.1 "Take charge" → first open, §11.5 Vision · Specification · Roadmap): a new
 * business opens with its vision, specification and roadmap drafting in the background, Home and the Product tabs show
 * "Drafting your vision, specification and roadmap…", and they fill in when the drafting is ready. Door A drafts from
 * the idea and the founder profile; Door B from the Import report, and every imported issue lands on the roadmap.
 * The stack runs MODEL_MODE=mock without Temporal, so the api drafts in-process (apps/web/e2e/README.md).
 */

const ENSURE = "product.foundations.ensure";

/**
 * Holds every `product.foundations.ensure` call until `release()`, so the test sees the business before its drafting
 * starts (the mock model drafts in well under a second) and the order "drafting, then ready" is deterministic.
 */
async function holdEnsure(page: Page): Promise<{ release: () => Promise<void>; held: () => number }> {
  const held: Route[] = [];
  let released = false;
  const handler = async (route: Route, request: Request) => {
    if (request.method() !== "POST" || released) return route.continue();
    held.push(route);
  };
  await page.route((url) => url.pathname.includes(ENSURE), handler);
  return {
    held: () => held.length,
    release: async () => {
      released = true;
      await page.unroute((url) => url.pathname.includes(ENSURE), handler);
      for (const route of held.splice(0)) await route.continue().catch(() => undefined); // a route of a page we left is gone
    },
  };
}

async function takeCharge(page: Page, name: string): Promise<{ bid: string; itemId: string }> {
  await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/inbox/${UUID}`), { timeout: LONG });
  const m = page.url().match(new RegExp(`/b/(${UUID})/inbox/(${UUID})`))!;
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  // The Board item renders once the page has hydrated and its queries answered (next dev compiles the route first).
  await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
  return { bid: m[1]!, itemId: m[2]! };
}

test.describe("foundations", () => {
  // Each test drafts a card or runs an import, commits a business and visits several routes next dev compiles on first use.
  test.setTimeout(240_000);

  test("Door A: Home shows the drafting, then the vision, specification and roadmap are ready", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    const hold = await holdEnsure(page);
    const name = `Foundations ${Date.now().toString(36)}`;
    const { bid } = await takeCharge(page, name);

    // Home before the drafting has finished: the drafting state, never a blocked page.
    await page.goto(`/b/${bid}/home`);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
    const status = page.getByTestId("foundations-status");
    await expect(status).toBeVisible({ timeout: LONG });
    await expect(status).toHaveAttribute("data-foundations-state", /pending|drafting/);
    await expect(status.getByRole("status")).toContainText("Drafting your vision, specification and roadmap…");
    await expect(status).toContainText("From your idea and your founder profile.");
    expect(hold.held()).toBeGreaterThanOrEqual(1);

    // The shell's ensure goes through: the drafting starts in the background and Home turns ready by itself.
    await hold.release();
    await expect(status).toHaveAttribute("data-foundations-state", "ready", { timeout: LONG });
    await expect(status.getByRole("status")).toContainText("Your vision, specification and roadmap are drafted.");
    await expect(status).toContainText(/specification sections · \d+ roadmap items, \d+ in Now/);

    // The way in: the Vision tab shows the stored vision and the north star with its label.
    await status.getByRole("button", { name: "Open the vision" }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${bid}/d/[a-z0-9-]+/vision`), { timeout: LONG });
    const record = page.getByTestId("vision-record");
    await expect(record).toBeVisible({ timeout: LONG });
    await expect(record.locator("[data-vision-statement]")).toContainText(name);
    await expect(record.getByRole("list")).toBeVisible();
    await expect(page.getByTestId("north-star")).toContainText(/Forecast|Estimate/);
    await expect(page.getByTestId("foundations-status")).toHaveCount(0);

    // The roadmap has Now, Next and Later items; the specification's blocks are written by an agent.
    const deptSlug = page.url().match(new RegExp(`/b/${bid}/d/([a-z0-9-]+)/vision`))![1]!;
    await page.goto(`/b/${bid}/d/${deptSlug}/roadmap`);
    const board = page.locator("[data-roadmap-board]");
    await expect(board).toBeVisible({ timeout: LONG });
    for (const h of ["now", "next", "later"]) expect(await board.locator(`[data-roadmap-item][data-horizon="${h}"]`).count(), h).toBeGreaterThan(0);
    await page.goto(`/b/${bid}/d/${deptSlug}/specification`);
    const outline = page.getByRole("navigation", { name: "Spec outline" });
    await expect(outline.getByRole("button").first()).toBeVisible({ timeout: LONG });
    await expect(outline.getByLabel("Agent-written").first()).toBeVisible();

    // The Product lead's note is in the Inbox.
    await page.goto(`/b/${bid}/inbox`);
    await expect(page.getByText("Vision, specification and roadmap drafted").first()).toBeVisible({ timeout: LONG });
  });

  test("Door B: the business is drafted from the Import report, which claims nothing it has not read", async ({ page }) => {
    await signIn(page);
    await page.goto("/new/import");
    await expect(page.getByTestId("import-sources")).toBeVisible({ timeout: LONG });
    await page.getByLabel("Import from GitHub").check();
    await page.getByLabel("Repository").fill("acme/ledgerly");
    await page.getByTestId("start-import").click();
    const report = page.getByTestId("scouting-report");
    await expect(report).toBeVisible({ timeout: LONG });
    // Nothing is read before the business exists: no invented issues, the repository is still to be read.
    await expect(page.getByTestId("roadmap-seeds").locator("li")).toHaveCount(0);
    await expect(report).toContainText("Not read yet");

    await page.getByTestId("continue-to-commit").click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+\?name=Ledgerly&from=import/, { timeout: LONG });
    const { bid } = await takeCharge(page, `Ledgerly ${Date.now().toString(36)}`);
    // The Board's first item carries the Import report's first decisions.
    await expect(page.getByTestId("inbox-item")).toContainText("Where should the team start with what you imported?", { timeout: LONG });

    await page.goto(`/b/${bid}/d/product/roadmap`);
    const board = page.locator("[data-roadmap-board]");
    await expect(board).toBeVisible({ timeout: LONG });
    // Drafting may still be running when the tab opens; it fills in by itself.
    await expect(board.locator("[data-roadmap-item]").first()).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("foundations-status")).toHaveCount(0);

    // The repository is listed as an import source with what is true of it (the e2e stack has no Temporal worker, so
    // it is not read), never with invented counts.
    await page.goto(`/b/${bid}/d/product/sources`);
    const row = page.getByRole("row").filter({ hasText: "GitHub import: acme/ledgerly" });
    await expect(row).toBeVisible({ timeout: LONG });
    await expect(row.locator("[data-import-state]")).toHaveAttribute("data-import-state", "not_read");
    await expect(row).toContainText("import worker was not reachable");
    await expect(row).not.toContainText(/files read/);
    // Read now asks the import to read it again (still no worker here, so it stays not read, with the reason).
    await page.getByTestId("read-imports-now").click();
    await expect(row.locator("[data-import-state]")).toHaveAttribute("data-import-state", "not_read", { timeout: LONG });
    // Next's route announcer is an empty alert; only one with words in it is an error.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);

    await page.goto(`/b/${bid}/d/product/vision`);
    await expect(page.getByTestId("vision-record")).toContainText("existing source", { timeout: LONG });
  });
});
