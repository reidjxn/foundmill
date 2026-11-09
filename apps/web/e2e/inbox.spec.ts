import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, ROADMAP_SIGNOFF, SPEC_SIGNOFF, UUID, approveBothSignoffs, approveFromInbox, dismissCoachmarks, ensureDeck, inboxRow, openBoardQuestion, openBusiness, signIn, startDistributionFromBoard, takeChargeToHome, setBuilderView } from "./helpers";

// Builder view on for this file (it opens an approval's Details); global-setup.ts starts every run with it off. Restored afterwards.
let builderViewBefore = false;
test.beforeAll(async ({ playwright }) => {
  builderViewBefore = await setBuilderView(playwright, true);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, builderViewBefore);
});

/**
 * Inbox (BUILD §11.3; AC-11.3.2 refresh, AC-11.3.3 Continue follows blocking items) on the seeded Northwind Skincare,
 * plus a fresh business for the decision that releases Continue (the seed's decisions would be used up by the first
 * run). Stack and commands: e2e/README.md.
 */
const rowsOf = (page: Page) => page.getByTestId("inbox-list").getByRole("option");
/** Ledgerly (seed): on vacation, with a spend its Paid Ads agent asked the founder to approve. */
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

async function openInbox(page: Page, tab?: string): Promise<void> {
  await openBusiness(page, `inbox${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByTestId("inbox-screen")).toBeVisible({ timeout: LONG });
  // The list renders its rows only once inbox.list has answered (the loading state is a separate element).
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
}

/** Commits the first drafted concept as a new business and lands on its Home (founder, 2026-10-18). */
async function commitFreshBusiness(page: Page, name: string): Promise<{ bid: string }> {
  await ensureDeck(page, 1);
  await page.getByTestId("commit-link").first().click();
  await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
  return takeChargeToHome(page, name);
}

test.describe("inbox", () => {
  test("renders the 380 px list, the tabs and the empty reading pane", async ({ page }) => {
    await openInbox(page);
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "all");
    const list = page.getByTestId("inbox-pane");
    await expect(list).toBeVisible();
    expect((await list.boundingBox())?.width).toBe(380);
    await expect(page.getByTestId("reading-pane-empty")).toBeVisible();
    await expect(page.getByTestId("reading-pane-empty")).toContainText("Pick a note on the left.");
    // Refresh says what it is (one quick note, not a cycle; UX plan B17).
    await expect(page.getByTestId("inbox-refresh")).toHaveAttribute("title", "Ask the team for one quick note (does not start a cycle)");
    for (const tab of ["Needs you", "Customers", "Updates", "Archive"]) await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
  });

  test("J/K select the next and previous rows; the URL carries the selection; the pane shows the note anatomy", async ({ page }) => {
    await openInbox(page);
    const rows = rowsOf(page);
    await expect(rows.nth(1), "the seed gives Northwind at least two inbox items").toBeVisible();
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/);
    const first = page.url();
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("j");
    await expect(page).not.toHaveURL(first);
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("k");
    await expect(page).toHaveURL(first);
    await expect(page.getByTestId("inbox-item-header")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("type-pill")).toBeVisible();
    // Every tag carries its legend (UX plan B21), and an open note that holds Continue says so in those words (B7).
    await expect(page.getByTestId("type-pill")).toHaveAttribute("data-tag-legend", /^.+: .+/);
    await expect(page.getByTestId("inbox-item-header")).not.toContainText(/Blocks Continue|Needs your call/);
    await expect(page.getByTestId("inbox-note")).toBeVisible();
    // The owner is walled from nothing: no figure or customer detail of the note is hidden (inbox.get item.redacted).
    await expect(page.getByTestId("redacted-notice")).toHaveCount(0);
    await expect(page.getByTestId("inbox-note")).not.toContainText("(amount hidden)");
  });

  test("AC-11.3.2: R adds exactly one new item; a second R inside the debounce only shows the wait", async ({ page }) => {
    await openInbox(page);
    const rows = rowsOf(page);
    const refreshCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/trpc\/inbox\.refresh/.test(req.url())) refreshCalls.push(req.url());
    });
    await expect(page.getByTestId("inbox-refresh")).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);
    await page.keyboard.press("r");
    // The 3 s debounce starts with the key press, before the api answers.
    await expect(page.getByTestId("inbox-refresh")).toHaveAttribute("data-wait-ms", /^\d+$/);
    await page.keyboard.press("r");
    // Radix toasts render their title twice (once for the live region): the visible one is enough. "One note at a
    // time: wait 3 s." (UX plan B17).
    await expect(page.getByText(/^One note at a time: wait \d+ s\.$/).first()).toBeVisible();
    // With new events it narrates them; with none it says so and offers the next call grounded in the current state.
    await expect(page.getByText(/^(One new note|Nothing new since your last note)$/).first()).toBeVisible({ timeout: LONG });
    await expect(rows).toHaveCount(before + 1, { timeout: LONG });
    // Never the old filler ("Decision needed: next step", "No fresh events for …").
    await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("inbox-title")).not.toContainText(/Decision needed: next step|No fresh events/);
    // The new note is selected and the second press never reached the api.
    await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/);
    expect(refreshCalls).toHaveLength(1);
    // The debounce clears on its own and the count stays at exactly one new item.
    await expect(page.getByTestId("inbox-refresh")).not.toHaveAttribute("data-wait-ms", /\d/, { timeout: 10_000 });
    await expect(rows).toHaveCount(before + 1);
  });

  test("the two sign-off notes wait in Needs you without holding Continue; 1 approves each (the second starts the build), Continue runs a cycle step, and 1 approves the first goal", async ({ page }) => {
    test.setTimeout(360_000);
    await signIn(page);
    const { bid } = await commitFreshBusiness(page, `Playwright Inbox ${Date.now().toString(36)}`);
    // The foundations draft in the background (mock models); their two sign-off notes wait in Needs you. Since Nov 7, 2026
    // a decision never holds Continue: the button stays Continue and the Inbox counts what needs the founder.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, SPEC_SIGNOFF)).toBeVisible({ timeout: LONG });
    await expect(inboxRow(page, ROADMAP_SIGNOFF)).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Needs you/ })).toContainText("2", { timeout: LONG });
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible({ timeout: LONG });
    await inboxRow(page, SPEC_SIGNOFF).click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    const bar = page.getByTestId("decision-bar");
    await expect(bar).toHaveAttribute("data-state", "open");
    expect(await bar.getByRole("group", { name: "Options" }).getByRole("button").count()).toBe(2);
    // The agent's desk offers "Go with: …" while the decision is open; the panel carries the notes (optional with Approve).
    const desk = page.getByTestId("agent-desk");
    await expect(desk.locator('[data-quick-reply="go_with"]')).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("signoff-panel")).toBeVisible();
    // The number keys decide the note from the page (the shell's main content), not from the list row that opened it.
    // Request changes without words asks for them instead of sending (the option stays open). On the account's first
    // Inbox visit the Inbox tour (then the first-decision callout) opens, and an open card holds the number keys (UX plan
    // §6.2, §7.9): close what shows, press, and try again if a card opened in between (a second 2 only asks again).
    await expect(async () => {
      await dismissCoachmarks(page);
      await page.getByTestId("shell-content").focus();
      await page.keyboard.press("2");
      await expect(page.getByTestId("signoff-panel")).toContainText("Say what should change", { timeout: 10_000 });
    }).toPass({ timeout: LONG * 2 });
    await expect(item).toHaveAttribute("data-state", /unread|read/);
    // The notes field took the focus so the founder can type; back on the page, 1 approves.
    await expect(page.getByTestId("signoff-notes")).toBeFocused();
    await expect(async () => {
      await dismissCoachmarks(page);
      await page.getByTestId("shell-content").focus();
      await page.keyboard.press("1");
      await expect(item).toHaveAttribute("data-state", "answered", { timeout: 10_000 });
    }).toPass({ timeout: LONG * 2 });
    const answered = page.getByTestId("answered-panel");
    await expect(answered).toBeVisible();
    // Decided from the DecisionBar: the desk keeps 2–4 replies but no longer offers "Go with: …" (no second decision).
    await expect(desk.locator('[data-quick-reply="go_with"]')).toHaveCount(0, { timeout: LONG });
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Needs you/ })).toContainText("1", { timeout: LONG });
    // The second approval starts the build: Development › Plan gets the Planner's first tasks.
    await approveFromInbox(page, bid, ROADMAP_SIGNOFF);
    await expect(inboxRow(page, /Building starts:/)).toBeVisible({ timeout: LONG });
    const idle = page.getByRole("button", { name: /^Continue$/ });
    await expect(idle).toBeVisible({ timeout: LONG });
    // One press of Continue → business.continue (an in-process cycle step without Temporal) → a toast says what happened.
    await idle.click();
    await expect(page.getByText(/Cycle started|One new note|Cycle resumed|already running/).first()).toBeVisible({ timeout: LONG });

    // After both sign-offs and a round of work the Chief of Staff proposes the first goal (founder, 2026-11-07): Home asks
    // `goal.ensure` once per visit, the proposal is a decision note in Needs you that never holds Continue, and one tap on
    // the recommended option (1) approves it.
    const goalRow = () => inboxRow(page, /Your first goal: get 10 paying customers by [A-Z][a-z]{2} \d{1,2}/);
    await expect(async () => {
      const ensured = page.waitForResponse((r) => /goal\.ensure/.test(r.url()), { timeout: 20_000 });
      await page.goto(`/b/${bid}/home`);
      await ensured;
      await page.goto(`/b/${bid}/inbox`);
      await expect(goalRow()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: LONG * 3 });
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible({ timeout: LONG });
    await goalRow().click();
    const goalNote = page.getByTestId("inbox-item");
    await expect(goalNote).toHaveAttribute("data-type", "decision", { timeout: LONG });
    // From whoever the business's Chief of Staff is (read from the page, never a fixed name).
    await expect(page.getByTestId("inbox-item-header").getByTestId("persona-link")).not.toHaveText("", { timeout: LONG });
    const goalBar = page.getByTestId("decision-bar");
    await expect(goalBar).toHaveAttribute("data-state", "open");
    await expect(goalBar.getByRole("group", { name: "Options" }).getByRole("button")).toHaveText([/Approve this goal/, /Change it/]);
    await expect(async () => {
      await dismissCoachmarks(page);
      await page.getByTestId("shell-content").focus();
      await page.keyboard.press("1");
      await expect(goalNote).toHaveAttribute("data-state", "answered", { timeout: 10_000 });
    }).toPass({ timeout: LONG * 2 });
    await expect(page.getByTestId("answered-panel")).toBeVisible({ timeout: LONG });
  });

  test("every note has the agent's desk; a quick reply (Alt+2) answers without using up the decision; T talks", async ({ page }) => {
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    // The persona line never repeats itself ("Chief of Staff Chief of Staff").
    const header = page.getByTestId("inbox-item-header");
    const persona = (await header.getByTestId("persona-link").innerText()).trim();
    const role = header.getByTestId("persona-role");
    if (await role.count()) expect((await role.innerText()).trim().toLowerCase()).not.toBe(persona.toLowerCase());

    const desk = page.getByTestId("agent-desk");
    await expect(desk).toBeVisible({ timeout: LONG });
    await expect(desk).toHaveAttribute("data-variant", "inline");
    // 2–4 numbered quick replies on Alt+1–4 (1–4 stay on the decision's options), plus the ghost Write.
    const replies = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(replies.first()).toBeVisible({ timeout: LONG });
    expect(await replies.count()).toBeGreaterThanOrEqual(2);
    expect(await replies.count()).toBeLessThanOrEqual(4);
    await expect(replies.first()).toHaveAttribute("aria-keyshortcuts", "Alt+1");
    const second = replies.nth(1);
    const secondId = await second.getAttribute("data-quick-reply");
    expect(secondId, "the second reply asks rather than decides").not.toBe("go_with");
    const agentBubbles = desk.getByTestId("agent-bubble");
    const before = await agentBubbles.count();
    // An open tour card or callout holds the keyboard shortcuts (the Inbox tour opens on the account's first visit, the
    // first-decision callout after it): close what shows, press, and try again if a card opened in between.
    await expect(async () => {
      await dismissCoachmarks(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Alt+2");
      await expect.poll(() => agentBubbles.count(), { timeout: 15_000 }).toBeGreaterThan(before);
    }).toPass({ timeout: LONG * 2 });
    // The question did not decide anything: the item and its DecisionBar are still open.
    // (Opening a note marks it read, so unread may turn read meanwhile; answered it is not.)
    await expect(item).toHaveAttribute("data-state", /^(unread|read)$/);
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("answered-panel")).toHaveCount(0);

    // The DecisionBar's "Ask <agent>" opens the desk's Write field instead of a free-text box.
    await expect(page.getByTestId("decision-free-text")).toHaveCount(0);
    await page.locator("[data-decision-ask]").click();
    await expect(desk.getByRole("textbox", { name: /^Reply to / })).toBeFocused();
    await page.keyboard.press("Escape");
    // Escape closes the field and hands focus back to the Write button in the next animation frame. Wait for that hand-back:
    // under load it can otherwise land after T has put focus on the thread, and take it off again.
    await expect(desk.locator('[data-quick-reply="write"]')).toBeFocused();
    // T brings the conversation into focus.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("t");
    await expect(desk.getByTestId("desk-thread")).toBeFocused();
  });

  test("a reply that does not get through keeps the founder's words; the agent says so in its own voice and Try again sends it", async ({ page }) => {
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    const desk = page.getByTestId("agent-desk");
    const replies = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write]):not([data-quick-reply=go_with])");
    await expect(replies.first()).toBeVisible({ timeout: LONG });
    const founderBubbles = desk.getByTestId("founder-bubble");
    const foundersBefore = await founderBubbles.count();

    // The api is unreachable for this one send.
    const offline = /\/trpc\/[^?]*agent\.conversation\.send/;
    await page.route(offline, (route) => route.abort("connectionrefused"));
    await replies.first().click();
    await expect(founderBubbles).toHaveCount(foundersBefore + 1, { timeout: LONG });
    await expect(desk.getByTestId("read-receipt").last()).toContainText("Not sent", { timeout: LONG });
    const words = (await founderBubbles.last().innerText()).replace(/^You:\s*/, "").trim();
    await expect(desk.getByTestId("agent-bubble").filter({ hasText: "couldn't confirm your message" }).last()).toBeVisible();
    const retry = desk.locator('[data-quick-reply="local-retry"]');
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAttribute("data-likeliest", "true");
    // Nothing was decided and nothing was resent on its own.
    // (Opening a note marks it read, so unread may turn read meanwhile; answered it is not.)
    await expect(item).toHaveAttribute("data-state", /^(unread|read)$/);
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");

    await page.unroute(offline);
    const agentBubbles = desk.getByTestId("agent-bubble");
    await retry.click();
    await expect(desk.getByTestId("agent-bubble").filter({ hasText: "couldn't confirm your message" })).toHaveCount(0, { timeout: LONG });
    await expect(desk.getByTestId("read-receipt").last()).not.toContainText("Not sent", { timeout: LONG });
    await expect.poll(() => agentBubbles.count(), { timeout: LONG }).toBeGreaterThan(0);
    await expect(founderBubbles.last()).toContainText(words);
    await expect(founderBubbles).toHaveCount(foundersBefore + 1);
    await expect(desk.locator('[data-quick-reply="local-retry"]')).toHaveCount(0);
    await expect(item).toHaveAttribute("data-state", /^(unread|read)$/);
  });

  test("a reply lost on its way back is not reported as unsent, and nothing is posted twice (audit RES-09)", async ({ page }) => {
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-type", "decision", { timeout: LONG });
    const desk = page.getByTestId("agent-desk");
    const replies = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write]):not([data-quick-reply=go_with])");
    await expect(replies.first()).toBeVisible({ timeout: LONG });
    const founderBubbles = desk.getByTestId("founder-bubble");
    const foundersBefore = await founderBubbles.count();

    // The api takes the message and answers it; the answer never reaches the browser.
    const lost = /\/trpc\/[^?]*agent\.conversation\.send/;
    await page.route(lost, async (route) => {
      try {
        await route.fetch();
        await route.abort("connectionreset");
      } catch {
        // The page moved on (or the route was released) while the api was still answering.
      }
    });
    await replies.first().click();
    // The desk asks the server and finds the message there: the exchange shows, with nothing to send again.
    await expect(founderBubbles).toHaveCount(foundersBefore + 1, { timeout: LONG });
    await expect(desk.getByTestId("read-receipt").last()).not.toContainText("Not sent", { timeout: LONG });
    await expect(desk.locator('[data-quick-reply="local-retry"]')).toHaveCount(0);
    await expect(desk.getByTestId("agent-bubble").filter({ hasText: "couldn't confirm your message" })).toHaveCount(0);
    await page.unroute(lost);
  });

  test("number keys in an agent's sheet opened over a decision answer the sheet, never the note underneath", async ({ page }) => {
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    // The command palette's Ask row opens the Chief of Staff's desk as a sheet over the note.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+k");
    await page.keyboard.type("ask chief");
    const ask = page.locator('[data-group="ask"] [role="option"]').filter({ hasText: /Ask / }).first();
    await expect(ask).toBeVisible({ timeout: LONG });
    await ask.click();
    const sheet = page.locator('[data-testid="agent-desk"][data-variant="sheet"]');
    await expect(sheet).toBeVisible({ timeout: LONG });
    const replies = sheet.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(replies.first()).toBeVisible({ timeout: LONG });
    const founders = sheet.getByTestId("founder-bubble");
    const before = await founders.count();
    await page.keyboard.press("1");
    await expect(founders).toHaveCount(before + 1, { timeout: LONG });
    // 1 went to the sheet's first reply: the note's DecisionBar did not take it, and nothing was decided.
    await expect(page.getByTestId("confirm-plan")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    // (Opening a note marks it read, so unread may turn read meanwhile; answered it is not.)
    await expect(item).toHaveAttribute("data-state", /^(unread|read)$/);
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("answered-panel")).toHaveCount(0);
  });

  test("the guided layer on a note: the status word and Your decision carry a tip, defined terms in the body are underlined, and the first decision shows its callout once (UX plan §7.9)", async ({ page }) => {
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    const bar = page.getByTestId("decision-bar");
    await expect(bar).toHaveAttribute("data-state", "open", { timeout: LONG });
    const options = bar.getByRole("group", { name: "Options" }).getByRole("button");
    // The pane marks the first option as the callout's anchor whatever the guidance switch says.
    await expect(options.first()).toHaveAttribute("data-coachmark", "first-decision-option");
    const note = page.getByTestId("inbox-note");
    await expect(note).toBeVisible();
    // The account's switch (Settings › Preferences): the bar's guided line is there only while guidance is on.
    const guided = (await bar.locator("[data-decision-guided-line]").count()) > 0;
    if (guided) {
      // Tutoring: the tips, the terms (the seeded note says "Estimate"), and the key caps stay hidden.
      await expect(page.getByTestId("inbox-item-header").getByRole("button", { name: "About Needs your answer" })).toBeVisible();
      await expect(bar.getByRole("button", { name: "About Your decision" })).toBeVisible();
      await expect(note.locator("[data-term]").first()).toBeVisible();
      expect(await note.locator("[data-term='estimate']").count()).toBe(1);
      await expect(bar.locator("[data-option-key]")).toHaveCount(0);
      // The one-step callout on the first option, once per account: Got it ends it and a reload never brings it back.
      const callout = page.locator('[data-coachmark][data-tour="first-decision"]');
      if (await callout.isVisible()) {
        await expect(callout).toContainText("Each option says what it costs and whether you can undo it");
        await expect(callout).toContainText("The recommended one is marked.");
        await callout.getByRole("button", { name: "Got it" }).click();
        await expect(callout).toBeHidden();
        await page.reload();
        await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open", { timeout: LONG });
        await expect(page.locator('[data-coachmark][data-tour="first-decision"]')).toHaveCount(0);
      }
    } else {
      // Guidance off: no tutoring at all, and the operator's key caps on the options.
      await expect(page.getByRole("button", { name: /^About / })).toHaveCount(0);
      await expect(note.locator("[data-term]")).toHaveCount(0);
      await expect(page.locator('[data-coachmark][data-tour="first-decision"]')).toHaveCount(0);
      expect(await bar.locator("[data-option-key]").count()).toBeGreaterThanOrEqual(2);
    }
    // Information stays whatever the switch: every option's consequence or cost line, and the Holds Continue tooltip.
    expect(await options.count()).toBeGreaterThanOrEqual(2);
  });

  test("a money decision reads in the business's own currency: pounds for Northwind, never euros", async ({ page }) => {
    // The options' costs used to read a glossary entry nothing writes, so every business saw "€37,200.00" here.
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    const bar = page.getByTestId("decision-bar");
    await expect(bar).toHaveAttribute("data-state", "open", { timeout: LONG });
    await expect(bar).toContainText("£37,200.00");
    await expect(bar).not.toContainText("€");
  });

  test("a \"Go with: …\" quick reply decides the note through the decide path", async ({ page }) => {
    await signIn(page);
    const { bid } = await commitFreshBusiness(page, `Playwright Desk ${Date.now().toString(36)}`);
    // The first open decision of a new business is the specification sign-off (founder, 2026-10-18).
    await page.goto(`/b/${bid}/inbox`);
    await inboxRow(page, SPEC_SIGNOFF).click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    const desk = page.getByTestId("agent-desk");
    await expect(desk).toBeVisible({ timeout: LONG });
    const goWith = desk.locator("[data-quick-reply=go_with]");
    await expect(goWith, "an open decision offers Go with: <recommended>").toBeVisible({ timeout: LONG });
    await expect(goWith).toContainText("Go with:");
    await goWith.click();
    const confirm = page.getByTestId("confirm-plan");
    const answered = page.getByTestId("answered-panel");
    await expect(confirm.or(answered).first()).toBeVisible({ timeout: LONG });
    if (await confirm.isVisible()) {
      await page.getByTestId("confirm-plan-go").click();
      await expect(confirm).toBeHidden({ timeout: LONG });
    }
    await expect(item).toHaveAttribute("data-state", "answered", { timeout: LONG });
    await expect(answered).toBeVisible();
    // The agent acknowledges in the thread.
    await expect(desk.getByTestId("agent-bubble").filter({ hasText: /Going with/ }).last()).toBeVisible({ timeout: LONG });
  });

  test("an agent's request names the agent, the call and the amount; Reject sends the founder's reason (audit FR-01)", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/inbox?tab=all`);
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    // The seed's pending approval has its decision item: "<agent> needs your OK: Foundmill › set budget".
    const request = rowsOf(page).filter({ hasText: /needs your OK: .+ › set budget/ }).first();
    await expect(request, "the seed gives Ledgerly an agent's request to approve").toBeVisible({ timeout: LONG });
    await request.click();
    const panel = page.getByTestId("approval-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    // The business thing first (UX plan B5): one sentence from the agent, the tool and its arguments.
    await expect(panel.getByTestId("approval-summary")).toHaveText(/^\S.+ wants to set the paid ads budget to £600\.00\.$/);
    await expect(panel.getByTestId("approval-agent")).toHaveAttribute("href", new RegExp(`/b/${LEDGERLY_BUSINESS_ID}/agents/${UUID}/overview$`));
    // The call's name and the raw arguments wait behind Details.
    await expect(panel.getByTestId("approval-action")).toBeHidden();
    await panel.getByTestId("approval-details").locator("summary").click();
    await expect(panel.getByTestId("approval-action")).toHaveText(/ › set budget$/);
    await expect(panel.getByTestId("approval-amount")).toHaveText("£600.00");
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision");
    // The seed's request is used up by the first run; a re-run without a fresh seed finds it answered.
    if ((await item.getAttribute("data-state")) !== "answered") {
      const bar = page.getByTestId("decision-bar");
      await expect(bar).toHaveAttribute("data-state", "open");
      const options = bar.getByRole("group", { name: "Options" }).getByRole("button");
      await expect(options.filter({ hasText: "Approve" })).toBeVisible();
      await panel.getByTestId("approval-reason").fill("Keep the budget until the close is done");
      const decided = page.waitForRequest((req) => req.method() === "POST" && /\/trpc\/[^?]*inbox\.decide/.test(req.url()));
      await options.filter({ hasText: "Reject" }).click();
      const body = (await decided).postData() ?? "";
      expect(body).toContain("reject_request");
      expect(body).toContain("Keep the budget until the close is done");
      await expect(page.getByText(/^You rejected .+ request to run .+ › set budget/).first()).toBeVisible({ timeout: LONG });
    }
    await expect(item).toHaveAttribute("data-state", "answered", { timeout: LONG });
    await expect(panel.getByTestId("approval-reason")).toHaveCount(0);
    await expect(panel).toContainText(/Rejected|Approved/);
    await expect(page.getByTestId("answered-panel")).toBeVisible();
  });

  test("a plan waiting for the go-ahead survives a reload: it stays in Needs you, its spend reads as waiting, and Review confirms it once", async ({ page }) => {
    await signIn(page);
    test.setTimeout(300_000);
    const { bid } = await commitFreshBusiness(page, `Playwright Go-ahead ${Date.now().toString(36)}`);
    // The Board's question arrives once the product is signed off and distribution started (founder, 2026-10-18).
    await approveBothSignoffs(page, bid);
    const { boardItemId: itemId } = await startDistributionFromBoard(page, bid);
    await openBoardQuestion(page, bid, itemId);
    const item = page.getByTestId("inbox-item");
    // An instruction typed to the agent decides the note; the spend is above the approval threshold, so it waits.
    await page.locator("[data-decision-ask]").click();
    const write = page.getByTestId("agent-desk").getByRole("textbox", { name: /^Reply to / });
    await expect(write).toBeFocused();
    await write.fill("Spend up to $500 on LinkedIn ads targeting fintech CFOs next week");
    await page.keyboard.press("Enter");
    const confirm = page.getByTestId("confirm-plan");
    await expect(confirm).toBeVisible({ timeout: LONG });
    // The spend asks whichever agent it lands on: one with an allowance asks above its threshold, one with none (the
    // Distribution lead, when the business has no paid-ads agent yet) says "Please set up my spend allowance".
    const askReason = confirm.getByTestId("confirm-plan-lines").locator('[data-outcome="ask"]').getByTestId("confirm-plan-reason");
    await expect(askReason).toHaveText(/\S/);
    // Under the footer: what Go ahead does (always), and where to undo it later (only while guidance is on).
    await expect(confirm.getByTestId("confirm-plan-consequence")).toContainText(/when you say go\./);
    await expect(confirm.getByTestId("confirm-plan-consequence")).toContainText(/\(Estimate\)|No cost/);
    if ((await page.getByTestId("decision-bar").locator("[data-decision-guided-line]").count()) > 0 || (await confirm.getByTestId("confirm-plan-reassurance").count()) > 0) {
      await expect(confirm.getByTestId("confirm-plan-reassurance")).toHaveText("You can stop or change this from the Inbox at any time.");
    }
    await confirm.getByRole("button", { name: "Not now" }).click();
    await expect(confirm).toBeHidden();

    // A reload (or another device): nothing the deciding page remembered. The note still asks for the go-ahead.
    await page.goto(`/b/${bid}/inbox/${itemId}?tab=respond`);
    const answered = page.getByTestId("answered-panel");
    await expect(answered).toBeVisible({ timeout: LONG });
    await expect(item).toHaveAttribute("data-state", "answered");
    await expect(page.getByTestId("type-pill")).toContainText("Needs your go-ahead");
    await expect(page.locator(`[data-inbox-row="${itemId}"]`)).toHaveAttribute("data-needs-answer", "true", { timeout: LONG });
    // The spend action reads as waiting, never as confirmed (audit VOL-X1); nothing to open yet.
    await expect(answered.getByTestId("ask-chip")).toHaveText(["Needs your go-ahead"]);
    await expect(answered.locator("[data-follow-up-link]")).toHaveCount(0);

    await answered.getByTestId("reopen-confirmation").click();
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("heading", { name: "Here is what will happen" })).toBeVisible();
    await expect(confirm.getByTestId("confirm-plan-lines").locator('[data-outcome="ask"]')).toHaveCount(1);
    // After a reload the reason is still there: it is stored with the action, not remembered by the page that decided.
    await expect(askReason).toHaveText(/\S/);
    await page.getByTestId("confirm-plan-go").click();
    await expect(confirm).toBeHidden({ timeout: LONG });
    await expect(answered.getByTestId("reopen-confirmation")).toHaveCount(0, { timeout: LONG });
    await expect(answered.getByTestId("ask-chip")).toHaveText(["Confirmed"], { timeout: LONG });
    await expect(page.getByTestId("type-pill")).not.toContainText("Needs your go-ahead");
    // A task is a task: the answered panel never sends "Open the plan" to the unrelated task list (audit FR-08).
    await expect(answered.getByRole("button", { name: "Open the plan" })).toHaveCount(0);
    // Confirmed, it leaves Needs you.
    await page.reload();
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "respond", { timeout: LONG });
    await expect(page.locator(`[data-inbox-row="${itemId}"]`)).toHaveCount(0, { timeout: LONG });
  });

  // The seeded Northwind decision with a spend option, a deadline five days after the seed and "Holds Continue" (its id
  // is new with every seed, so it is read from the list).
  async function northwindDecisionId(page: Page): Promise<string> {
    await openInbox(page, "respond");
    const row = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(row, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    const id = await row.getAttribute("data-inbox-row");
    expect(id).toBeTruthy();
    return id!;
  }

  test("the list and the reading pane scroll on their own; the page behind them never moves (audit OL-03)", async ({ page }) => {
    const decisionId = await northwindDecisionId(page);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox/${decisionId}`);
    await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
    const main = page.getByTestId("shell-content");
    const size = await main.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight + 1);
    const before = (await page.getByTestId("inbox-pane").boundingBox())!.y;
    await page.getByTestId("reading-pane").hover();
    await page.mouse.wheel(0, 600);
    expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
    expect((await page.getByTestId("inbox-pane").boundingBox())!.y).toBe(before);
  });

  test("a decision past its deadline stays open and keeps blocking Continue; the page does not claim the team moved on (audit VCML-X2)", async ({ page }) => {
    const decisionId = await northwindDecisionId(page);
    await page.clock.setFixedTime(new Date("2027-01-15T12:00:00Z"));
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox/${decisionId}`);
    await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
    const bar = page.getByTestId("decision-bar");
    await expect(bar.getByTestId("past-deadline")).toContainText("past its deadline");
    await expect(page.getByText("the team moved on")).toHaveCount(0);
    const options = bar.getByRole("group", { name: "Options" }).getByRole("button");
    expect(await options.count()).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < (await options.count()); i += 1) await expect(options.nth(i)).toBeEnabled();
    // A decision past its deadline still never holds Continue (Nov 7, 2026).
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible();
  });

  test("a double click on an option sends one decision and shows one outcome (audit RES-10)", async ({ page }) => {
    await signIn(page);
    const { bid } = await commitFreshBusiness(page, `Playwright Double ${Date.now().toString(36)}`);
    await page.goto(`/b/${bid}/inbox`);
    await inboxRow(page, SPEC_SIGNOFF).click();
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open", { timeout: LONG });
    let sent = 0;
    await page.route("**/trpc/**", async (route) => {
      sent += (route.request().url().match(/inbox\.decide/g) ?? []).length;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await page.getByTestId("decision-bar").getByRole("group", { name: "Options" }).getByRole("button").first().dblclick();
    await expect(page.getByTestId("confirm-plan").or(page.getByTestId("answered-panel")).first()).toBeVisible({ timeout: LONG });
    expect(sent).toBe(1);
    await expect(page.getByText("Could not record the decision")).toHaveCount(0);
  });

  test("status-strip captions never show a raw ISO month, and the founder's own note carries the founder's initials (audit OL-17, OL-28)", async ({ page }) => {
    await openInbox(page);
    const rows = rowsOf(page);
    const total = Math.min(await rows.count(), 12);
    for (let i = 0; i < total; i += 1) {
      await rows.nth(i).click();
      await expect(page.getByTestId("inbox-item-header")).toBeVisible({ timeout: LONG });
      const strip = page.getByTestId("status-strip");
      if (await strip.count()) await expect(strip).not.toContainText(/\b\d{4}-\d{2}\b/);
      if ((await page.getByTestId("inbox-item").getAttribute("data-type")) === "human_message") await expect(page.getByTestId("inbox-item-header")).not.toContainText(/\bYO\b/);
    }
  });

  test("a won customer opens its Customer Update", async ({ page }) => {
    await openInbox(page, "customers");
    const won = rowsOf(page).first();
    await expect(won, "the seed gives Northwind a won customer").toBeVisible();
    await won.click();
    await expect(page.getByTestId("customer-update")).toBeVisible({ timeout: LONG });
    const open = page.getByTestId("open-replay");
    await expect(open).toBeEnabled({ timeout: LONG });
    await open.click();
    await expect(page).toHaveURL(/\/journey\/[0-9a-f-]{36}/, { timeout: LONG });
    await expect(page.getByTestId("journey-screen")).toBeVisible({ timeout: LONG });
    expect(page.url()).toContain(`/b/${NORTHWIND_BUSINESS_ID}/journey/`);
  });
});
