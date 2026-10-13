import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, UUID, ensureDeck, openBusiness, signIn } from "./helpers";

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

/** Commits the first drafted concept as a new business and lands on its Board item (a decision from the Chief of Staff). */
async function commitFreshBusiness(page: Page, name: string): Promise<{ bid: string; itemId: string }> {
  await ensureDeck(page, 1);
  await page.getByTestId("commit-link").first().click();
  await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
  await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/inbox/${UUID}`), { timeout: LONG });
  const m = page.url().match(new RegExp(`/b/(${UUID})/inbox/(${UUID})`))!;
  await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
  return { bid: m[1]!, itemId: m[2]! };
}

test.describe("inbox", () => {
  test("renders the 380 px list, the tabs and the empty reading pane", async ({ page }) => {
    await openInbox(page);
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "all");
    const list = page.getByTestId("inbox-pane");
    await expect(list).toBeVisible();
    expect((await list.boundingBox())?.width).toBe(380);
    await expect(page.getByTestId("reading-pane-empty")).toBeVisible();
    for (const tab of ["Respond", "Customers", "Updates", "Archive"]) await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
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
    // Radix toasts render their title twice (once for the live region): the visible one is enough.
    await expect(page.getByText("One note at a time").first()).toBeVisible();
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

  test("AC-11.3.3: answering a blocking decision with 1 releases Continue, which then runs a cycle step", async ({ page }) => {
    await signIn(page);
    await commitFreshBusiness(page, `Playwright Inbox ${Date.now().toString(36)}`);
    const respond = page.getByRole("button", { name: /^Respond to \d+ items?$/ });
    await expect(respond).toBeVisible({ timeout: LONG });
    const countBefore = Number((await respond.innerText()).match(/\d+/)?.[0] ?? "0");
    expect(countBefore).toBeGreaterThanOrEqual(1);
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision");
    const bar = page.getByTestId("decision-bar");
    await expect(bar).toHaveAttribute("data-state", "open");
    expect(await bar.getByRole("group", { name: "Options" }).getByRole("button").count()).toBeGreaterThanOrEqual(2);
    // The agent's desk offers "Go with: …" while the decision is open.
    const desk = page.getByTestId("agent-desk");
    await expect(desk.locator('[data-quick-reply="go_with"]')).toBeVisible({ timeout: LONG });
    await page.keyboard.press("1");
    const confirm = page.getByTestId("confirm-plan");
    const answered = page.getByTestId("answered-panel");
    await expect(confirm.or(answered).first()).toBeVisible({ timeout: LONG });
    if (await confirm.isVisible()) {
      await expect(confirm.getByRole("heading", { name: "Here is what will happen" })).toBeVisible();
      await page.getByTestId("confirm-plan-go").click();
      await expect(confirm).toBeHidden({ timeout: LONG });
    }
    await expect(item).toHaveAttribute("data-state", "answered");
    await expect(answered).toBeVisible();
    // An action left to the founder never reads "Confirmed by you" while its plan still awaits confirmation (VOL-X1).
    if (await answered.getByText("Awaiting your confirmation").isVisible()) await expect(answered.getByText("Confirmed by you")).toHaveCount(0);
    // Decided from the DecisionBar: the desk keeps 2–4 replies but no longer offers "Go with: …" (no second decision).
    await expect(desk.locator('[data-quick-reply="go_with"]')).toHaveCount(0, { timeout: LONG });
    const left = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(left.first()).toBeVisible();
    expect(await left.count()).toBeGreaterThanOrEqual(2);
    if (countBefore > 1) {
      await expect(page.getByRole("button", { name: `Respond to ${countBefore - 1} item${countBefore - 1 === 1 ? "" : "s"}` })).toBeVisible({ timeout: LONG });
      return;
    }
    const idle = page.getByRole("button", { name: /^Continue$/ });
    await expect(idle).toBeVisible({ timeout: LONG });
    // One press of Continue → business.continue (an in-process cycle step without Temporal) → a toast says what happened.
    await idle.click();
    await expect(page.getByText(/Cycle started|One new note|Cycle resumed|already running/).first()).toBeVisible({ timeout: LONG });
  });

  test("every note has the agent's desk; a quick reply (Alt+2) answers without using up the decision; T talks", async ({ page }) => {
    await openInbox(page, "respond");
    const decision = rowsOf(page).filter({ hasText: "Approve batch 002" }).first();
    await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
    await decision.click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    const stateBefore = await item.getAttribute("data-state");
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
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Alt+2");
    await expect.poll(() => agentBubbles.count(), { timeout: LONG }).toBeGreaterThan(before);
    // The question did not decide anything: the item and its DecisionBar are still open.
    await expect(item).toHaveAttribute("data-state", stateBefore!);
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("answered-panel")).toHaveCount(0);

    // The DecisionBar's "Ask <agent>" opens the desk's Write field instead of a free-text box.
    await expect(page.getByTestId("decision-free-text")).toHaveCount(0);
    await page.locator("[data-decision-ask]").click();
    await expect(desk.getByRole("textbox", { name: /^Reply to / })).toBeFocused();
    await page.keyboard.press("Escape");
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
    const stateBefore = await item.getAttribute("data-state");
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
    await expect(item).toHaveAttribute("data-state", stateBefore!);
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
    await expect(item).toHaveAttribute("data-state", stateBefore!);
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
      await route.fetch();
      await route.abort("connectionreset");
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
    const stateBefore = await item.getAttribute("data-state");
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
    await expect(item).toHaveAttribute("data-state", stateBefore!);
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("answered-panel")).toHaveCount(0);
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
    await commitFreshBusiness(page, `Playwright Desk ${Date.now().toString(36)}`);
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision");
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
    // The seed's pending approval has its decision item: "<agent> asks to run Foundmill › set budget".
    const request = rowsOf(page).filter({ hasText: /asks to run .+ › set budget/ }).first();
    await expect(request, "the seed gives Ledgerly an agent's request to approve").toBeVisible({ timeout: LONG });
    await request.click();
    const panel = page.getByTestId("approval-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel.getByTestId("approval-agent")).toHaveAttribute("href", new RegExp(`/b/${LEDGERLY_BUSINESS_ID}/agents/${UUID}/overview$`));
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

  test("a plan waiting for the go-ahead survives a reload: it stays in Respond, its spend reads as waiting, and Review confirms it once", async ({ page }) => {
    await signIn(page);
    const { bid, itemId } = await commitFreshBusiness(page, `Playwright Go-ahead ${Date.now().toString(36)}`);
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision");
    // An instruction typed to the agent decides the note; the spend is above the approval threshold, so it waits.
    await page.locator("[data-decision-ask]").click();
    const write = page.getByTestId("agent-desk").getByRole("textbox", { name: /^Reply to / });
    await expect(write).toBeFocused();
    await write.fill("Spend up to $500 on LinkedIn ads targeting fintech CFOs next week");
    await page.keyboard.press("Enter");
    const confirm = page.getByTestId("confirm-plan");
    await expect(confirm).toBeVisible({ timeout: LONG });
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
    await page.getByTestId("confirm-plan-go").click();
    await expect(confirm).toBeHidden({ timeout: LONG });
    await expect(answered.getByTestId("reopen-confirmation")).toHaveCount(0, { timeout: LONG });
    await expect(answered.getByTestId("ask-chip")).toHaveText(["Confirmed"], { timeout: LONG });
    await expect(page.getByTestId("type-pill")).not.toContainText("Needs your go-ahead");
    // A task is a task: the answered panel never sends "Open the plan" to the unrelated task list (audit FR-08).
    await expect(answered.getByRole("button", { name: "Open the plan" })).toHaveCount(0);
    // Confirmed, it leaves Respond.
    await page.reload();
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "respond", { timeout: LONG });
    await expect(page.locator(`[data-inbox-row="${itemId}"]`)).toHaveCount(0, { timeout: LONG });
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
