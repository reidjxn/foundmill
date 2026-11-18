import { expect, test, type Page } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, NORTHWIND_BUSINESS_ID, dismissCoachmarks, ensureDeck, inboxRow, settled, signIn, takeChargeToToday } from "./helpers";

/**
 * Today, the business's front door (founder, 2026-11-07; DESIGN §9 "Today"): `/b/<id>` lands here; the goal with its
 * progress bar, what needs the founder (one tap where no plan compiler is needed, Open for the rest), the week in
 * sentences and the health figures that match Details. The headline is the week's real outcomes as one count, with no
 * cost figure anywhere on Today and no count line for a week with none (WP-14 T4). On a fresh business the goal waits for the Chief of Staff, who
 * proposes it after both sign-offs and a round of work; Change it rewrites it from the founder's words and one tap
 * approves it. Stack and commands: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;

/** A tile of a status strip by its label, as text (label, figure, caption). */
const tileText = async (page: Page, strip: string, label: RegExp): Promise<string> => ((await page.locator(strip).locator("[role=listitem]").filter({ hasText: label }).first().innerText()) ?? "").replace(/\s+/g, " ").trim();

/** The sections of Today that are on the page, by test id, in DOM order (WP-04 T7: Today's order). */
async function todayOrder(page: Page): Promise<string[]> {
  const ids = ["needs-you", "founder-task", "public-page-note", "first-week-timeline", "goal-panel", "week-plan", "since-last-visit", "streak-strip", "today-health"];
  return page.evaluate((list) => {
    const found = list.flatMap((id) => {
      const el = document.querySelector(`[data-testid="today-screen"] [data-testid="${id}"]`);
      return el ? [{ id, el }] : [];
    });
    found.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return found.map((f) => f.id);
  }, ids);
}

/** Reload Today until `check` passes: Today reads once per visit and the e2e stack has no stream to push changes. */
async function untilOnToday(page: Page, bid: string, check: () => Promise<void>, timeout = LONG * 3): Promise<void> {
  await expect(async () => {
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: 15_000 });
    await check();
  }).toPass({ timeout });
}

test.describe("today", () => {
  test("`/b/<id>` lands on Today: the goal, Needs you, the week and the health figures; Details opens the dashboards and G H comes back", async ({ page }) => {
    await signIn(page);
    await page.goto(B);
    await page.waitForURL(new RegExp(`${B}/today$`), { timeout: LONG });
    const screen = page.getByTestId("today-screen");
    await expect(screen).toBeVisible({ timeout: LONG });
    await settled(page);
    await expect(page).toHaveTitle(/^(?:\(\d+\) )?Today · Northwind Skincare · /);
    // The sidebar's first item is Today, lit here (it keeps G H).
    const today = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Today", exact: true });
    await expect(today).toHaveAttribute("aria-current", "page");
    await expect(today).toHaveAttribute("aria-keyshortcuts", /G H/);

    // A long-running business is past its first week: no timeline (it shows only in a business's first days).
    await expect(page.getByTestId("first-week-timeline")).toHaveCount(0);
    // A sample business has no founder task (WP-04 T9): nothing of it is the reader's to publish or share.
    await expect(page.getByTestId("founder-task")).toHaveCount(0);

    // 1. Your goal: the seeded active goal, its progress bar and the pace sentence.
    const goal = page.getByTestId("goal-panel");
    await expect(goal.getByRole("heading", { name: "Your goal" })).toBeVisible();
    await expect(goal).toHaveAttribute("data-goal", "active", { timeout: LONG });
    await expect(goal.getByTestId("goal-sentence")).toHaveText(/paying customers by [A-Z][a-z]{2} \d{1,2}/);
    const bar = goal.getByRole("progressbar", { name: "Goal progress" });
    await expect(bar).toHaveAttribute("aria-valuenow", /^\d+$/);
    await expect(bar).toHaveAttribute("aria-valuetext", /^[\d,]+ of [\d,]+ paying customers$/);
    await expect(goal.getByTestId("goal-pace")).toHaveText(/so far|passed|Reached/);

    // 2. Needs you: at most three rows, each with Open; See all goes to the Inbox's Needs you tab.
    const needs = page.getByTestId("needs-you");
    await expect(needs.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(needs).toHaveAttribute("data-state", /ready|empty/, { timeout: LONG });
    expect(await needs.locator("[data-needs-you-row]").count()).toBeLessThanOrEqual(3);

    // 3. This week and next: three to five sentences.
    const week = page.getByTestId("week-plan");
    await expect(week.getByRole("heading", { name: "This week and next" })).toBeVisible();
    await expect(async () => {
      const n = await week.getByRole("listitem").count();
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }).toPass({ timeout: LONG });

    // 4. Health: Cash, Runway and Customers this week. No cost figure on Today (WP-14 T4): no spend tile, no spend line.
    const health = page.getByTestId("today-health");
    for (const label of [/^Cash/, /^Runway/, /^Customers this week/]) await expect(health.locator("[role=listitem]").filter({ hasText: label }).first()).toBeVisible({ timeout: LONG });
    await expect(health.locator("[role=listitem]")).toHaveCount(3);
    await expect(screen).not.toContainText(/Spent this week|AI usage this week|Channel spend|Team spend/);
    // A sample business's seeded history is an example, never a real outcome: no count line, and no zero as a score.
    await expect(page.getByTestId("week-outcomes-headline")).toHaveCount(0);
    await expect(screen).not.toContainText(/\b0 real outcomes/);
    await expect(health.locator("[role=listitem]").filter({ hasText: /^Runway/ }).first()).not.toContainText("…", { timeout: LONG });
    const runwayToday = await tileText(page, "[data-testid=today-health]", /^Runway/);

    // The order (WP-04 T7, D5): a project past its first day and its page, on a computer: the goal beside Needs you,
    // then the week, Since you were last here, the quiet streak and the health figures last.
    await expect(page.getByTestId("streak-strip")).toBeVisible({ timeout: LONG });
    const desktop = (await todayOrder(page)).filter((id) => id !== "since-last-visit");
    expect(desktop).toEqual(["goal-panel", "needs-you", "week-plan", "streak-strip", "today-health"]);
    // Explain this page, in the tab row: what Today is, what Needs you is, what Continue does.
    await dismissCoachmarks(page);
    await page.getByRole("button", { name: /Explain this page/ }).click();
    const explain = page.getByTestId("explain-page-panel");
    await expect(explain).toContainText("Today is your project's front door");
    await expect(explain).toContainText("Continue runs one round of work.");
    await page.keyboard.press("Escape");

    // At 390 px Needs you leads, and the streak and health still come last.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await todayOrder(page)).filter((id) => id !== "since-last-visit"), { timeout: LONG }).toEqual(["needs-you", "goal-panel", "week-plan", "streak-strip", "today-health"]);
    await expect(page.getByTestId("phone-title-row").getByRole("button", { name: /Explain this page/ })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("nav[aria-label=Primary]")).toBeVisible({ timeout: LONG });

    // See all in the Inbox.
    await needs.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(new RegExp(`${B}/inbox\\?tab=respond`), { timeout: LONG });

    // Details: the dashboards, with the same runway figure; G H comes back to Today.
    await page.goto(`${B}/today`);
    await settled(page);
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page).toHaveURL(new RegExp(`${B}/home`), { timeout: LONG });
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
    await expect(page).toHaveTitle(/^(?:\(\d+\) )?Details · Northwind Skincare · /);
    await expect(today).toHaveAttribute("aria-current", "page");
    const detailsStrip = "[data-widget=status_strip] [data-status-strip]";
    await expect(page.locator(detailsStrip).locator("[role=listitem]").filter({ hasText: /^Runway/ }).first()).toBeVisible({ timeout: LONG });
    await expect(async () => expect(await tileText(page, detailsStrip, /^Runway/)).toBe(runwayToday)).toPass({ timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    await page.getByTestId("shell-content").focus();
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(page).toHaveURL(new RegExp(`${B}/today$`), { timeout: LONG });
    await expect(screen).toBeVisible({ timeout: LONG });
  });

  test("WP-14 T5: while agents have work in hand, Today shows a quiet Working now strip with one line for each of them", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    // The sample business's seed has agents part-way through their work.
    const strip = page.getByTestId("working-now");
    await expect(strip).toBeVisible({ timeout: LONG });
    await expect(strip.getByRole("heading", { name: "Working now" })).toBeVisible();
    const lines = strip.locator("[data-working-now-line]");
    expect(await lines.count()).toBeGreaterThanOrEqual(1);
    // Each line is "<agent>: <what it is doing>", with no cost and no progress figure.
    for (const text of await lines.allInnerTexts()) expect(text).toMatch(/^[^:]+: \S.+$/);
    await expect(strip).not.toContainText(/\$|%|Estimate/);
    // At 390 px it is still there, with no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(strip).toBeVisible({ timeout: LONG });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("nav[aria-label=Primary]")).toBeVisible({ timeout: LONG });
    // The link opens the Working now tab.
    await dismissCoachmarks(page);
    await strip.getByRole("link", { name: "See the work" }).click();
    await expect(page).toHaveURL(/\/training-ground/, { timeout: LONG });
  });

  test("a fresh business: the goal waits, one tap approves both sign-offs, the Chief of Staff proposes, Change it rewrites it, one tap approves it", async ({ page }) => {
    test.setTimeout(420_000);
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    const { bid } = await takeChargeToToday(page, `Playwright Today ${Date.now().toString(36)}`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });

    // Your first week: Day 1 is under way, the rest are planned with Estimate dates, and what you will be asked is said.
    const timeline = page.getByTestId("first-week-timeline");
    await expect(timeline).toBeVisible({ timeout: LONG });
    // Day one (WP-04 T7, D5): no streak and no health figures yet. The page waits to be checked, so Needs you leads,
    // then the first week, then the goal, on a computer as on a phone.
    await expect(page.getByTestId("week-plan")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("streak-strip")).toHaveCount(0);
    await expect(page.getByTestId("today-health")).toHaveCount(0);
    // Nobody is working yet (WP-14 T5): the Working now strip is absent, not empty.
    await expect(page.getByTestId("working-now")).toHaveCount(0);
    // The headline (WP-14 T4): nothing real has happened outside the project yet, so no count line and no zero, only
    // what the team is working toward.
    const outcomes = page.getByTestId("week-outcomes");
    await expect(outcomes).toHaveAttribute("data-state", "toward", { timeout: LONG });
    await expect(outcomes).toHaveText("Working toward: your public page, live");
    await expect(page.getByTestId("week-outcomes-headline")).toHaveCount(0);
    await expect.poll(async () => (await todayOrder(page)).filter((id) => id !== "public-page-note"), { timeout: LONG }).toEqual(["needs-you", "founder-task", "first-week-timeline", "goal-panel", "week-plan"]);
    // Your one thing today (WP-04 T9), right after Needs you: the page first, and what happens next under a rule.
    const task = page.getByTestId("founder-task");
    await expect(task).toHaveAttribute("data-task", "publish_page");
    await expect(task.getByTestId("founder-task-title")).toHaveText("Check your page and publish it");
    await expect(task.getByRole("button", { name: "Check my page" })).toBeVisible();
    await expect(task.getByTestId("founder-task-tomorrow")).toHaveText(/^(Tomorrow morning: what your team found overnight, and one thing to do\.|Come back when you have heard from someone, or press Continue for a round of work\.)$/);
    // At 390 px it stays right under Needs you.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await todayOrder(page)).filter((id) => id !== "public-page-note").slice(0, 2), { timeout: LONG }).toEqual(["needs-you", "founder-task"]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("nav[aria-label=Primary]")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-you")).toContainText(/Your page is being drafted and will show here in about a minute|Check it and publish|Approve the plan/);
    await expect(timeline.locator("[data-first-week-step=day1]")).toHaveAttribute("data-state", "now");
    await expect(timeline.locator("[data-first-week-step=days2to3]")).toHaveAttribute("data-state", "next");
    await expect(timeline.locator("[data-first-week-step=days2to3] [data-first-week-when]")).toHaveText(/^[A-Z][a-z]{2} \d{1,2} – \d{1,2} \(Estimate\)$/);
    await expect(timeline.locator("[data-first-week-step=week1]")).toContainText("Ready to start selling?");
    await expect(timeline.locator("[data-first-week-step=day1]")).toContainText("approve your plan");

    // An empty area tab says what will fill it and when, not a bare "No leads".
    await page.goto(`/b/${bid}/d/distribution/leads`);
    await expect(page.getByText("No leads yet")).toBeVisible({ timeout: LONG });
    await expect(page.getByText(/once the team starts selling, after you answer “Ready to start selling\?”/)).toBeVisible();
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });

    // The goal waits for the Chief of Staff.
    const goal = page.getByTestId("goal-panel");
    await expect(goal).toHaveAttribute("data-goal", "waiting", { timeout: LONG });
    await expect(goal).toContainText("Your Chief of Staff proposes a goal after the first round of work.");

    // Needs you: the one plan note (WP-04 T5), answered in one tap (no plan compiler).
    const needs = page.getByTestId("needs-you");
    for (const label of ["Approve the plan"]) {
      await untilOnToday(page, bid, async () => {
        await expect(needs.getByRole("button", { name: label })).toBeVisible({ timeout: 10_000 });
      });
      await dismissCoachmarks(page);
      await needs.getByRole("button", { name: label }).click();
      await expect(page.getByText("Answered").first()).toBeVisible({ timeout: LONG });
      await expect(needs.getByRole("button", { name: label })).toHaveCount(0, { timeout: LONG });
    }

    // The plan approved: Day 1 still asks for the page (package 1.3). The Product lead's note waits in Needs you;
    // its one tap opens Product › Public page, where the founder publishes the team's draft.
    await untilOnToday(page, bid, async () => {
      await expect(timeline.locator("[data-first-week-step=day1]")).toContainText("You are asked to publish your page.", { timeout: 10_000 });
    });
    await expect(timeline.locator("[data-first-week-step=day1]")).toHaveAttribute("data-state", "now");
    await expect(page.getByTestId("public-page-note")).toHaveCount(0);
    await dismissCoachmarks(page);
    await needs.getByRole("button", { name: "Check it and publish" }).click();
    await page.waitForURL(new RegExp(`/b/${bid}/d/[^/]+/public-page$`), { timeout: LONG });
    await settled(page);
    await dismissCoachmarks(page);
    const editor = page.getByTestId("public-page-editor");
    await expect(editor).toBeVisible({ timeout: LONG });
    await editor.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByTestId("page-confirm-publish").click();
    await expect(page.getByTestId("page-state")).toHaveText(/Live since/, { timeout: LONG });
    await page.goto(`/b/${bid}/today`);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });

    // The page is live and both sign-offs answered: Day 1 is done with its real date and Days 2–3 is under way.
    await untilOnToday(page, bid, async () => {
      await expect(timeline.locator("[data-first-week-step=day1]")).toHaveAttribute("data-state", "done", { timeout: 10_000 });
    });
    await expect(timeline.locator("[data-first-week-step=day1] [data-first-week-when]")).toHaveText(/^Done [A-Z][a-z]{2} \d{1,2}$/);
    await expect(timeline.locator("[data-first-week-step=days2to3]")).toHaveAttribute("data-state", "now");
    // The founder published the page themselves: the week's first real outcome, and Today leads with the count.
    await expect(outcomes).toHaveAttribute("data-state", "count");
    await expect(page.getByTestId("week-outcomes-headline")).toHaveText("This week: 1 real outcome");
    await expect(page.getByTestId("week-outcomes-detail")).toHaveText("Your page went live");
    await expect(page.getByTestId("today-screen")).not.toContainText(/Spent this week|AI usage this week|Team spend/);
    // One a day (WP-04 T9): the page published today, so the panel says so and names the share for tomorrow.
    await expect(task.getByTestId("founder-task-done")).toHaveText("Done for today.");
    await expect(task.getByTestId("founder-task-next")).toHaveText("Tomorrow: Send your page to three people");
    await expect(task.getByRole("button")).toHaveCount(0);

    // A round of work after the roadmap's approval (one press of Continue: an in-process cycle step without Temporal).
    const idle = page.getByRole("button", { name: /^Continue$/ });
    await expect(idle).toBeVisible({ timeout: LONG });
    await dismissCoachmarks(page);
    await idle.click();
    await expect(page.getByText(/(cycle|round of work) \d* ?started|cannot run right now|(cycle|round of work) \d* ?resumed|already running/i).first()).toBeVisible({ timeout: LONG });

    // Today asks `goal.ensure` once per visit: the Chief of Staff's proposal, by its stored name (read from the page).
    await untilOnToday(page, bid, async () => {
      await expect(goal).toHaveAttribute("data-goal", "proposed", { timeout: 10_000 });
    });
    await expect(goal.getByTestId("goal-sentence")).toHaveText(/^Get the first 10 paying customers by [A-Z][a-z]{2} \d{1,2}$/);
    const proposedBy = (await goal.getByTestId("goal-proposed-by").innerText()).trim();
    const chief = /^Proposed by (.+), your Chief of Staff$/.exec(proposedBy)?.[1];
    expect(chief, proposedBy).toBeTruthy();
    // The same note waits in Needs you, from the same Chief of Staff, with its one tap.
    const goalRow = needs.locator("[data-needs-you-row]").filter({ hasText: /Your first goal/ });
    await expect(goalRow).toContainText(`From ${chief}`);
    await expect(goalRow.getByRole("button", { name: "Approve this goal" })).toBeVisible();

    // Change it: the founder's words, a revised proposal.
    await dismissCoachmarks(page);
    await goal.getByTestId("goal-change").click();
    const dialog = page.getByRole("dialog", { name: "What should change?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("goal-change-words")).toHaveAttribute("placeholder", "For example: 20 customers by the end of January");
    await dialog.getByTestId("goal-change-words").fill("20 customers by Jan 31");
    await dialog.getByTestId("goal-change-send").click();
    await expect(dialog).toHaveCount(0, { timeout: LONG });
    await expect(goal.getByTestId("goal-sentence")).toHaveText("Get the first 20 paying customers by Jan 31", { timeout: LONG });

    // Approve this goal: one tap; it is the active goal, it leaves Needs you, and its note in the Inbox is answered.
    await goal.getByTestId("goal-approve").click();
    await expect(goal).toHaveAttribute("data-goal", "active", { timeout: LONG });
    await expect(goal.getByRole("progressbar", { name: "Goal progress" })).toHaveAttribute("aria-valuenow", "0");
    await expect(goal.getByRole("progressbar", { name: "Goal progress" })).toHaveAttribute("aria-valuemax", "20");
    await expect(needs.locator("[data-needs-you-row]").filter({ hasText: /goal/i })).toHaveCount(0, { timeout: LONG });
    await page.goto(`/b/${bid}/inbox?tab=all`);
    const revised = inboxRow(page, /Your revised goal: get 20 paying customers by Jan 31/);
    await expect(revised).toBeVisible({ timeout: LONG });
    await revised.click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", "answered", { timeout: LONG });
  });
});
