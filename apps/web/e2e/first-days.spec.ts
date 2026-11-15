import { expect, test, type PlaywrightWorkerArgs } from "@playwright/test";
import { LONG, ROADMAP_SIGNOFF, SPEC_SIGNOFF, approveFromInbox, devApi, ensureDeck, inboxRow, openBoardQuestion, settled, signIn, startDistributionFromBoard, takeChargeToHome } from "./helpers";

/**
 * The dev founder's guidance switch (Settings › Preferences): the next-step strip, the checklist and the callout render
 * only while it is on. Also whether the first-Continue callout is still to come: it shows once per account
 * (account_preferences.tours_done), so a rerun, or a spec that pressed its "Got it", finds it done.
 */
async function guidanceOn(playwright: PlaywrightWorkerArgs["playwright"]): Promise<{ guided: boolean; firstContinueDone: boolean }> {
  const api = await devApi(playwright);
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { guidance: "on" | "off"; toursDone: Record<string, true> } } } };
  await api.dispose();
  const { guidance, toursDone } = body.result.data.json;
  return { guided: guidance === "on", firstContinueDone: toursDone["first-continue"] === true };
}

/**
 * The first days of a new business are about the product (founder, 2026-10-18): Take charge → Home shows the drafting →
 * two sign-off notes → the specification approved from its tab and the roadmap from the Inbox → "Building starts:" and
 * the Planner's first tasks on Development › Plan → the Board waits for the product until Start distribution posts the
 * Board's question and starts the engines. A second business takes the Request changes path. The stack runs
 * MODEL_MODE=mock without Temporal (apps/web/e2e/README.md), so the api drafts and plans in-process.
 */
test.describe("first days", () => {
  test.setTimeout(300_000);

  test("approving both sign-offs plans the first build; distribution waits for Start distribution, which posts the Board's question", async ({ page, playwright }) => {
    const { guided, firstContinueDone } = await guidanceOn(playwright);
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    const { bid } = await takeChargeToHome(page, `First Days ${Date.now().toString(36)}`);
    const status = page.getByTestId("foundations-status");
    await expect(status).toBeVisible({ timeout: LONG });
    await expect(status).toHaveAttribute("data-foundations-state", "ready", { timeout: LONG });
    // Day one lives with the dashboards (Details); Today's tab bar leads there (founder, 2026-11-07).
    await page.getByRole("tab", { name: "Details" }).click();
    await page.waitForURL(new RegExp(`/b/${bid}/home`), { timeout: LONG });

    // The guided layer on day one (UX plan §7.8): three numbered next steps in the Day one panel above the ghosted
    // milestones, "Your first week" with nothing done yet, and the callout under Continue (which waits while the first
    // cycle is still processing or a dialog is open).
    const dayOne = page.getByTestId("day-one");
    await expect(dayOne).toBeVisible({ timeout: LONG });
    if (guided) {
      const next = dayOne.locator("[data-next-step]");
      await expect(next).toHaveAttribute("data-rows", "3", { timeout: LONG });
      await expect(next.locator("[data-next-step-row='read-draft']")).toContainText("Read what the team drafted");
      await expect(next.locator("[data-next-step-row='read-draft']").getByRole("link", { name: /^Go:/ })).toHaveAttribute("href", new RegExp(`/b/${bid}/d/product/vision$`));
      await expect(next.locator("[data-next-step-row='answer-notes']")).toContainText(/Answer the (\d+ )?notes? in the Inbox/);
      await expect(next.locator("[data-next-step-row='press-continue']")).toBeVisible();
      const checklist = page.locator("[data-first-week-checklist]");
      await expect(checklist).toBeVisible({ timeout: LONG });
      await expect(checklist).toContainText("0 of 7 done");
      // The page comes first (package 1.3); no item asks for a bank or Stripe.
      await expect(checklist.locator("[data-first-week-item]").first()).toHaveAttribute("data-first-week-item", "publish_page");
      await expect(checklist.locator("[data-first-week-item='publish_page']").getByRole("link", { name: /^Go:/ })).toHaveAttribute("href", new RegExp(`/b/${bid}/d/product/public-page$`));
      await expect(checklist).not.toContainText("Connect a bank");
      await expect(checklist.locator("[data-first-week-item='sign_off_specification']").getByRole("link", { name: /^Go:/ })).toHaveAttribute("href", new RegExp(`/b/${bid}/d/product/specification$`));
      await expect(checklist.locator("[data-first-week-item='run_cycle']").getByRole("button", { name: "Go: Let the team work" })).toBeVisible();
      const continueButton = page.locator("[data-continue-state]").first();
      const callout = page.locator("[data-coachmark][data-tour='first-continue']");
      if (firstContinueDone) {
        await expect(callout).toHaveCount(0);
      } else if ((await continueButton.getAttribute("data-continue-state")) !== "processing") {
        await expect(callout).toBeVisible({ timeout: LONG });
        await expect(callout).toContainText("This is how you move forward");
        await expect(page.locator("[data-coachmark='continue'][data-coachmark-active]")).toHaveCount(1);
        await callout.getByRole("button", { name: "Got it" }).click();
        await expect(callout).toHaveCount(0);
      }
    } else {
      await expect(dayOne.locator("[data-next-step]")).toHaveCount(0);
      await expect(page.locator("[data-first-week-checklist]")).toHaveCount(0);
      await expect(page.locator("[data-coachmark]")).toHaveCount(0);
    }

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
    await expect(page.getByTestId("inbox-note")).toContainText("Distribution waits until you start it from Customers › Board.", { timeout: LONG });

    // Both sign-offs tick off on the first-week checklist. So does "Read a note from an agent": the sign-off and
    // "Building starts:" notes opened above are agents' notes. The second sign-off also starts the first cycle the way
    // Continue does, which the in-process stack finishes at once ("Run a cycle"; with Temporal it may still be running),
    // so the count is read from the ticked rows. Nothing has started distribution or published the page yet.
    if (guided) {
      await page.goto(`/b/${bid}/home`);
      const checklist = page.locator("[data-first-week-checklist]");
      await expect(checklist).toBeVisible({ timeout: LONG });
      await expect(checklist.locator("[data-first-week-item='sign_off_specification'][data-done]")).toHaveCount(1, { timeout: LONG });
      await expect(checklist.locator("[data-first-week-item='sign_off_roadmap'][data-done]")).toHaveCount(1, { timeout: LONG });
      await expect(checklist.locator("[data-first-week-item='read_note'][data-done]")).toHaveCount(1, { timeout: LONG });
      await expect(checklist.locator("[data-first-week-item='start_distribution'][data-done]")).toHaveCount(0);
      await expect(checklist.locator("[data-first-week-item='publish_page'][data-done]")).toHaveCount(0);
      const ticked = await checklist.locator("[data-first-week-item][data-done]").count();
      await expect(checklist).toContainText(`${ticked} of 7 done`);
    }

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
    // The Chief of Staff's goal proposal (Nov 7, 2026) may already wait in Needs you, and so does the Product lead's
    // "Your project's page is ready" (package 1.3); neither is a distribution question.
    await expect(page.getByTestId("inbox-list").locator("[data-inbox-row][data-needs-answer='true']").filter({ hasNotText: /goal/i }).filter({ hasNotText: /page is ready/i })).toHaveCount(0);

    // Start distribution: the Board's question (the archetype's own words) lands in the Inbox and the channels start.
    const { boardItemId } = await startDistributionFromBoard(page, bid);
    await expect(page.getByText(/^\d+ of 15 running( · \d+ starting)?$/)).toBeVisible({ timeout: LONG });
    await openBoardQuestion(page, bid, boardItemId);
    // The Board's question waits in Needs you; it never holds Continue (Nov 7, 2026).
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible({ timeout: LONG });
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
    // The Specification tab's sign-off banner waits for the drafting itself (Home's ready panel shows only when the visit
    // saw the drafting, which a fast mock draft can finish before Home's first read).
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
    await expect(page.getByRole("grid", { name: "Tasks" }).getByRole("row").filter({ hasText: /Revise the specification from your notes/ })).toHaveCount(1, { timeout: LONG });
    // The Inbox note was answered by the tab's decision and the follow-up says so.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, "Changes requested: the specification")).toBeVisible({ timeout: LONG });
    await inboxRow(page, SPEC_SIGNOFF).click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", "answered", { timeout: LONG });
    await expect(page.getByTestId("signoff-panel")).toContainText("Changes requested by you");
  });
});
