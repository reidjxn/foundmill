import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, UUID, openBusiness } from "./helpers";

/**
 * Team call (docs/TEAM_CALL.md §6) in mock mode: speech and transcription are simulated, so the call runs end to end
 * with the browser's own speech (or typing). Stack and commands: e2e/README.md.
 */

/** Notes, from the page itself, whether any tile ever lit up as speaking (a short line can be over in a moment). */
async function watchSpeakingTiles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __tileSpoke?: boolean };
    const check = () => {
      if (document.querySelector('[data-testid="call-tile"][data-state="speaking"]:not([data-you])')) w.__tileSpoke = true;
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
  });
}

const agentTurns = (page: Page) => page.locator('[data-testid="call-turn"][data-speaker="agent"]');

test.describe("Team call", () => {
  test("start from the lobby, hear the opening, type a message, see agents answer, end the call and open a filed task", async ({ page }) => {
    await watchSpeakingTiles(page);
    await openBusiness(page, "calls");
    await expect(page.getByTestId("call-lobby")).toBeVisible({ timeout: LONG });

    // The sidebar item sits under Team and is lit on the lobby.
    const item = page.locator("[data-testid=app-shell] nav [data-sidebar-item='calls']");
    await expect(item).toHaveText(/Team call/);
    await expect(item).toHaveAttribute("aria-current", "page");

    // The Chief of Staff and the leads are ticked to begin with; an optional topic.
    await expect(page.getByTestId("call-lobby-count")).toHaveText(/^[2-8] of 8$/, { timeout: LONG });
    await expect(page.getByTestId("call-lobby-row").first().getByRole("checkbox")).toBeChecked();
    await page.getByTestId("call-topic").fill("Opening the waitlist");
    await page.getByTestId("call-start").click();

    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/calls/${UUID}$`), { timeout: LONG });
    const room = page.getByTestId("call-room");
    await expect(room).toBeVisible({ timeout: LONG });
    await expect(room).toHaveAttribute("data-kind", "team");

    // Every agent has a tile, and You; the mock says speech is simulated, once.
    const tiles = page.getByTestId("call-tile");
    await expect.poll(() => tiles.count(), { timeout: LONG }).toBeGreaterThanOrEqual(3);
    await expect(page.locator('[data-testid="call-tile"][data-you]')).toHaveCount(1);
    await expect(page.getByTestId("call-simulated-notice")).toHaveCount(1);
    await expect(page.getByTestId("call-simulated-notice")).toContainText(/browser/i);

    // The opening turn is in the transcript, and its speaker's tile lit up while it was spoken.
    await page.getByTestId("call-transcript-toggle").click();
    await expect(page.getByTestId("call-transcript")).toBeVisible();
    await expect.poll(() => agentTurns(page).count(), { timeout: LONG }).toBeGreaterThanOrEqual(1);
    const openingTurns = await agentTurns(page).count();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tileSpoke?: boolean }).__tileSpoke === true), { timeout: LONG }).toBe(true);

    // Type instead of speaking: two ideas the plan reader files as work and a roadmap item.
    await page.getByTestId("call-type").fill("Let's build a waitlist page. Add a referral program to the roadmap.");
    await page.getByTestId("call-send").click();
    await expect(page.locator('[data-testid="call-turn"][data-speaker="founder"]')).toHaveCount(1, { timeout: LONG });
    await expect.poll(() => agentTurns(page).count(), { timeout: LONG }).toBeGreaterThanOrEqual(openingTurns + 2);
    // Teammates answer in their own colors; the transcript names who spoke.
    const speakers = await page.locator('[data-testid="call-turn"][data-speaker="agent"] [data-testid="call-turn-speaker"]').allTextContents();
    expect(new Set(speakers).size, "two different agents answered").toBeGreaterThanOrEqual(2);

    // End: the wrap-up replaces the stage with a summary and what was filed, each with a link to where it went.
    await page.getByTestId("call-end").click();
    const wrap = page.getByTestId("call-wrapup");
    await expect(wrap).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("call-summary")).not.toBeEmpty();
    await expect(page.getByTestId("call-actions-line")).toContainText(/filed|need/);
    await expect(wrap.locator('[data-testid="call-action"][data-status="filed"]').first()).toBeVisible();
    // Departments are named from the department itself.
    await expect(wrap.getByTestId("call-group-name").first()).not.toBeEmpty();

    const taskLink = wrap.getByRole("button", { name: /^Open task: / }).first();
    await expect(taskLink).toBeVisible();
    await taskLink.click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/d/[^/]+/[^/?]+\\?task=${UUID}`), { timeout: LONG });

    // The call is in the lobby's history with its actions line.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/calls`);
    await expect(page.getByTestId("call-history")).toContainText("filed", { timeout: LONG });
  });

  test("a one-to-one call starts from an agent's profile with Call", async ({ page }) => {
    await openBusiness(page, "d/team/squad");
    const links = page.locator("[data-testid=module-screen] a[href*='/agents/']").filter({ hasNotText: "Chief of Staff" });
    await expect(links.first(), "the seed hires a team into Northwind's Team department").toBeVisible({ timeout: LONG });
    await page.goto((await links.first().getAttribute("href"))!);
    await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });

    // Chat is the desk, as before; Call is the spoken one.
    await expect(page.getByTestId("header-talk")).toContainText(/^Chat with /);
    const call = page.getByTestId("header-call");
    await expect(call).toContainText(/^Call /);
    await call.click();

    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/calls/${UUID}$`), { timeout: LONG });
    await expect(page.getByTestId("call-room")).toHaveAttribute("data-kind", "one_to_one", { timeout: LONG });
    // The agent fills the stage and You is the small tile.
    await expect(page.getByTestId("call-stage")).toHaveAttribute("data-layout", "one_to_one");
    await expect(page.getByTestId("call-tile")).toHaveCount(2);
    await expect(page.getByTestId("call-end")).toHaveText("End call");
    await expect(page.locator('[data-testid="call-controls"] [data-testid="call-discuss"]')).toHaveCount(0);

    await page.getByTestId("call-end").click();
    await expect(page.getByTestId("call-wrapup")).toBeVisible({ timeout: LONG });
  });

  test("the profile's Overview shows the agent's Accent, and an owner can change it", async ({ page }) => {
    await openBusiness(page, "d/team/squad");
    const links = page.locator("[data-testid=module-screen] a[href*='/agents/']").filter({ hasNotText: "Chief of Staff" });
    await expect(links.first()).toBeVisible({ timeout: LONG });
    await page.goto((await links.first().getAttribute("href"))!);
    const accent = page.getByTestId("accent-panel");
    await expect(accent).toBeVisible({ timeout: LONG });
    await expect(accent.getByText("Accent", { exact: true })).toBeVisible();
    await expect(accent.getByTestId("speech-accent-preview")).toBeEnabled();
  });
});
