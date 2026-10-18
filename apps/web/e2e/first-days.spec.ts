import { expect, test } from "@playwright/test";
import { LONG, ROADMAP_SIGNOFF, SPEC_SIGNOFF, approveFromInbox, ensureDeck, inboxRow, openBoardQuestion, settled, signIn, startDistributionFromBoard, takeChargeToHome } from "./helpers";

/**
 * The first days of a new business are about the product (founder, 2026-10-18): Take charge → Home shows the drafting →
 * two sign-off notes → the specification approved from its tab and the roadmap from the Inbox → "Building starts:" and
 * the Planner's first tasks on Development › Plan → the Board waits for the product until Start distribution posts the
 * Board's question and starts the engines. A second business takes the Request changes path. The stack runs
 * MODEL_MODE=mock without Temporal (apps/web/e2e/README.md), so the api drafts and plans in-process.
 */
test.describe("first days", () => {
  test.setTimeout(300_000);

  test("approving both sign-offs plans the first build; distribution waits for Start distribution, which posts the Board's question", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    const { bid } = await takeChargeToHome(page, `First Days ${Date.now().toString(36)}`);
    const status = page.getByTestId("foundations-status");
    await expect(status).toBeVisible({ timeout: LONG });
    await expect(status).toHaveAttribute("data-foundations-state", "ready", { timeout: LONG });

    // The specification, approved from its tab: the pill turns Signed off with the version the approval published.
    await page.goto(`/b/${bid}/d/product/specification`);
    const banner = page.getByTestId("signoff-banner");
    await expect(banner).toHaveAttribute("data-signoff-status", "pending", { timeout: LONG });
    await settled(page);
    await banner.getByTestId("signoff-approve").click();
    await expect(banner).toHaveAttribute("data-signoff-status", "approved", { timeout: LONG });
    await expect(banner.getByTestId("signoff-pill")).toContainText(/^Signed off .* · v\d+$/);
    // Development › Plan still waits for the roadmap.
    await page.goto(`/b/${bid}/d/development/plan`);
    await expect(page.getByTestId("plan-stage-banner")).toHaveAttribute("data-product-stage", "awaiting_signoff", { timeout: LONG });

    // The roadmap, approved from the Inbox: the second approval starts the build.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, SPEC_SIGNOFF)).toBeVisible({ timeout: LONG });
    await approveFromInbox(page, bid, ROADMAP_SIGNOFF);
    const building = inboxRow(page, /Building starts: \d+ tasks? planned/);
    await expect(building).toBeVisible({ timeout: LONG });
    await building.click();
    await expect(page.getByTestId("inbox-note")).toContainText("Distribution waits until you start it from Distribution › Board.", { timeout: LONG });

    // The Planner's first tasks, each tied to a roadmap item, on Development › Plan; the banner is gone.
    await page.goto(`/b/${bid}/d/development/plan`);
    const tasks = page.getByRole("grid", { name: "Tasks" });
    await expect(tasks).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("plan-stage-banner")).toHaveCount(0);
    await expect.poll(async () => tasks.getByRole("row").filter({ hasNot: page.getByRole("columnheader") }).count(), { timeout: LONG }).toBeGreaterThanOrEqual(3);

    // Distribution › Board: every starter waits for the product; the Channels table says so too.
    await page.goto(`/b/${bid}/d/distribution/channels`);
    const channels = page.getByRole("grid", { name: "Channels" });
    await expect(channels).toBeVisible({ timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: "Waiting for the product" })).toHaveCount(4, { timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: "Waiting for the product" }).first().getByTitle(/Start distribution/)).toBeVisible();
    await page.goto(`/b/${bid}/d/distribution/formation`);
    await expect(page.getByTestId("distribution-waiting")).toHaveAttribute("data-product-stage", "building", { timeout: LONG });
    await expect(page.getByText("4 of 15 on the board · waiting for the product")).toBeVisible();
    // Nothing waits for an answer before distribution starts: the Board's question is not asked yet.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, SPEC_SIGNOFF)).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("inbox-list").locator("[data-inbox-row][data-needs-answer='true']")).toHaveCount(0);

    // Start distribution: the Board's question (the archetype's own words) lands in the Inbox and the channels start.
    const { boardItemId } = await startDistributionFromBoard(page, bid);
    await expect(page.getByText(/^\d+ of 15 running( · \d+ starting)?$/)).toBeVisible({ timeout: LONG });
    await openBoardQuestion(page, bid, boardItemId);
    await expect(page.getByRole("button", { name: /^Respond to \d+ items?$/ })).toBeVisible({ timeout: LONG });
    await expect(inboxRow(page, "Distribution has started")).toBeVisible({ timeout: LONG });
    await page.goto(`/b/${bid}/d/distribution/channels`);
    await expect(channels).toBeVisible({ timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: "Waiting for the product" })).toHaveCount(0, { timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: /Starting|Running/ }).first()).toBeVisible();
    // The scoring task the start created is on the Plan.
    await page.goto(`/b/${bid}/d/development/plan`);
    await expect(page.getByRole("grid", { name: "Tasks" }).getByRole("row").filter({ hasText: "Score the 15 channels" })).toHaveCount(1, { timeout: LONG });
  });

  test("Request changes from the Specification tab needs the founder's words, sends the round back and gives the Product lead a revision task", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    const { bid } = await takeChargeToHome(page, `Changes Asked ${Date.now().toString(36)}`);
    await expect(page.getByTestId("foundations-status")).toHaveAttribute("data-foundations-state", "ready", { timeout: LONG });
    await page.goto(`/b/${bid}/d/product/specification`);
    const banner = page.getByTestId("signoff-banner");
    await expect(banner).toHaveAttribute("data-signoff-status", "pending", { timeout: LONG });
    await settled(page);
    await banner.getByTestId("signoff-request-changes").click();
    const dialog = page.getByRole("dialog", { name: "What should change?" });
    await expect(dialog).toBeVisible();
    // Nothing is sent without words.
    await expect(dialog.getByTestId("signoff-send-changes")).toBeDisabled();
    await dialog.getByTestId("signoff-notes").fill("Shorten the pricing section and name the two launch markets.");
    await dialog.getByTestId("signoff-send-changes").click();
    await expect(banner).toHaveAttribute("data-signoff-status", "changes_requested", { timeout: LONG });
    await expect(banner.getByTestId("signoff-pill")).toHaveText("Changes requested");
    await expect(banner).toContainText("Shorten the pricing section");
    // Approve stays available for when the revision reads right; the Product lead's revision task is on the Plan.
    await expect(banner.getByTestId("signoff-approve")).toBeVisible();
    await page.goto(`/b/${bid}/d/development/plan`);
    await expect(page.getByRole("grid", { name: "Tasks" }).getByRole("row").filter({ hasText: /Revise the specification:/ })).toHaveCount(1, { timeout: LONG });
    // The Inbox note was answered by the tab's decision and the follow-up says so.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, "Changes requested: the specification")).toBeVisible({ timeout: LONG });
    await inboxRow(page, SPEC_SIGNOFF).click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", "answered", { timeout: LONG });
    await expect(page.getByTestId("signoff-panel")).toContainText("Changes requested by you");
  });
});
