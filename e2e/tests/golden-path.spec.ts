import { expect, test, type Page } from "@playwright/test";

/**
 * The golden path (BUILD §17.1, Gate 1) in mock mode against the PGlite-backed local stack (e2e/playwright.config.ts,
 * apps/web/e2e/README.md): sign in through the dev bypass as the seed owner → founder profile → Ideation Studio →
 * shortlist and compare → Commit ("Take charge") → Home with the welcome note while the foundations draft → the two
 * sign-off notes in the Inbox, approved by button → Continue → the first build on Development › Plan → Start
 * distribution from the Board → its question decided by free text (with the "Here is what will happen" confirmation)
 * → the seeded Customer Update → Product Changes → CRM search → NeedsLargerWindow. Test names carry the
 * acceptance-criteria ids they cover.
 *
 * The first describe is serial: every step builds on the business the Commit step creates. The second runs against
 * the seeded Northwind Skincare (fixed id, packages/db/src/seed/constants.ts) and each test signs in on its own.
 */

const NORTHWIND_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000001";
const LONG = 60_000;
const UUID = "[0-9a-f-]{36}";
/**
 * E2E_EXPECT_PROFILE_GATE=1: the database was seeded with SEED_OWNER_PROFILE=0, so the dev user has no founder profile
 * and AC-11.1.1's redirect branch must be taken (a pre-filled form would mean the seed flag was ignored). Without the
 * flag the branch is annotated, not required: a seed with the demo profile cannot show the gate.
 */
const EXPECT_PROFILE_GATE = /^(1|true|yes)$/i.test(process.env.E2E_EXPECT_PROFILE_GATE ?? "");

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/|\/onboarding|\/new/);
}

/** The Studio keeps the drafted deck on the server (idea.list); draft one only when it is empty. */
async function ensureDeck(page: Page, minimum = 2): Promise<void> {
  await page.goto("/new/ideate");
  await expect(page.getByTestId("prompt-box")).toBeVisible();
  const cards = page.getByTestId("concept-grid").locator("[data-concept]");
  if ((await cards.count()) < minimum) {
    await page.getByTestId("generate-button").click();
    await expect(cards.nth(minimum - 1)).toBeVisible({ timeout: LONG });
  }
}

/**
 * Commits the first drafted concept as a new business. Take charge lands on Today (founder, 2026-10-18: the first days
 * are about the product), where the vision, specification and roadmap draft in the background; the helper waits for
 * them so the two sign-off notes are in the Inbox when the test looks.
 */
async function commitFreshBusiness(page: Page, name: string): Promise<{ bid: string }> {
  await ensureDeck(page, 1);
  await page.getByTestId("commit-link").first().click();
  await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
  await expect(page.getByTestId("commit-form")).toBeVisible();
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
  const bid = page.url().match(new RegExp(`/b/(${UUID})/today`))![1]!;
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  // The foundations banner shows "ready" only when the drafting finishes during this visit, and a quick mock draft can
  // finish before Today's first read: wait for what the drafting leaves instead, the specification's sign-off note.
  await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
  await page.goto(`/b/${bid}/inbox`);
  await expect(page.getByTestId("inbox-list").getByRole("option").filter({ hasText: "Sign off the product specification" }).first()).toBeVisible({ timeout: LONG });
  return { bid };
}

const WELCOME_NOTE = "Your team is drafting the product foundations";
const SPEC_SIGNOFF = "Sign off the product specification";
const ROADMAP_SIGNOFF = "Sign off the product roadmap";

/** The Inbox row of a note by its subject. */
const inboxRow = (page: Page, subject: string | RegExp) => page.getByTestId("inbox-list").getByRole("option").filter({ hasText: subject }).first();

/** Opens a sign-off note from the Inbox list and approves it with its recommended option (the first button). */
async function approveFromInbox(page: Page, bid: string, subject: string): Promise<void> {
  await page.goto(`/b/${bid}/inbox`);
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
  const row = inboxRow(page, subject);
  await expect(row, `the Inbox lists "${subject}"`).toBeVisible({ timeout: LONG });
  await row.click();
  const item = page.getByTestId("inbox-item");
  await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
  await expect(page.getByTestId("signoff-panel")).toBeVisible({ timeout: LONG });
  const bar = page.getByTestId("decision-bar");
  await expect(bar).toHaveAttribute("data-state", "open");
  const options = bar.getByRole("group", { name: "Options" });
  const recommended = options.locator("button[data-recommended]").first();
  await ((await recommended.count()) ? recommended : options.getByRole("button").first()).click();
  await expect(item).toHaveAttribute("data-state", "answered", { timeout: LONG });
  await expect(page.getByTestId("answered-panel")).toBeVisible({ timeout: LONG });
}

/** Both sign-offs approved: the second approval starts the build and the Product lead's follow-up says so. */
async function approveBothSignoffs(page: Page, bid: string): Promise<void> {
  await approveFromInbox(page, bid, SPEC_SIGNOFF);
  await approveFromInbox(page, bid, ROADMAP_SIGNOFF);
  await expect(inboxRow(page, /Building starts:/)).toBeVisible({ timeout: LONG });
}

/**
 * Start distribution from Distribution › Board (the seed owner owns the business): the Board's question lands in the
 * Inbox and opens here. Its id comes back from `business.startDistribution` (the question's subject is the archetype's
 * own words, so the note is opened by id, never by its text).
 */
async function startDistributionFromBoard(page: Page, bid: string): Promise<{ boardItemId: string }> {
  await page.goto(`/b/${bid}/d/distribution/formation`);
  const waiting = page.getByTestId("distribution-waiting");
  await expect(waiting).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId("start-distribution")).toBeEnabled({ timeout: LONG });
  await page.getByTestId("start-distribution").click();
  const answer = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("business.startDistribution"), { timeout: LONG });
  await page.getByTestId("start-distribution-confirm").click();
  type Answer = { result: { data: { json: { boardItemId: string | null } } } };
  const body = (await (await answer).json()) as Answer | Answer[];
  const boardItemId = (Array.isArray(body) ? body[0] : body)?.result.data.json.boardItemId;
  expect(boardItemId, "Start distribution posts the Board's question").toBeTruthy();
  await expect(waiting).toHaveCount(0, { timeout: LONG });
  // The Board's question: a decision from the Chief of Staff with at least two options, waiting for the founder.
  await page.goto(`/b/${bid}/inbox/${boardItemId}`);
  const item = page.getByTestId("inbox-item");
  await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
  await expect(item).toHaveAttribute("data-item-id", boardItemId!);
  await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open", { timeout: LONG });
  expect(await page.getByTestId("decision-bar").getByRole("group", { name: "Options" }).getByRole("button").count()).toBeGreaterThanOrEqual(2);
  return { boardItemId: boardItemId! };
}

/**
 * Answers the current item in the founder's own words: the DecisionBar's "Ask <agent>" opens the conversation's Write
 * field, and an instruction typed there decides the item (`agent.conversation.inboxReply`; a question would stay in the
 * conversation). Walks through the confirmation when the plan needs it.
 */
async function decideByFreeText(page: Page, text: string): Promise<{ confirmed: boolean }> {
  const bar = page.getByTestId("decision-bar");
  await expect(bar).toHaveAttribute("data-state", "open");
  await bar.locator("[data-decision-ask]").click();
  const field = page.getByTestId("agent-desk").getByRole("textbox", { name: /^Reply to / });
  await expect(field).toBeFocused({ timeout: LONG });
  await field.fill(text);
  await field.press("Enter");
  const confirm = page.getByTestId("confirm-plan");
  const answered = page.getByTestId("answered-panel");
  await expect(confirm.or(answered).first()).toBeVisible({ timeout: LONG });
  const confirmed = await confirm.isVisible();
  if (confirmed) {
    await expect(confirm.getByRole("heading", { name: "Here is what will happen" })).toBeVisible();
    await expect(confirm.getByTestId("confirm-plan-lines").locator("li").first()).toBeVisible();
    await page.getByTestId("confirm-plan-go").click();
    await expect(confirm).toBeHidden({ timeout: LONG });
  }
  await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", "answered");
  await expect(answered).toBeVisible();
  return { confirmed };
}

const continueIdle = (page: Page) => page.getByRole("button", { name: /^Continue$/ });
/** The sidebar Inbox link, whose badge counts what needs the founder (the Needs you tab). */
const inboxLink = (page: Page) => page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Inbox/ });

test.describe("golden path", () => {
  test.describe.configure({ mode: "serial" });

  let bid = "";

  test("AC-11.1.1: the dev bypass signs in; a founder without a profile is held at /onboarding until it is saved", async ({ page }) => {
    await signIn(page);
    // `/` sends a founder without a profile to /onboarding and everyone else to a business Home or /new.
    const gated = /\/onboarding/.test(page.url());
    test.info().annotations.push({ type: "profile", description: gated ? "missing: gate exercised, profile saved" : "present (the seed creates the demo founder's profile): pre-filled form saved, gate not reachable with this user" });
    if (EXPECT_PROFILE_GATE) expect(gated, "E2E_EXPECT_PROFILE_GATE is set: the seed ran with SEED_OWNER_PROFILE=0, so `/` must redirect the dev user to /onboarding").toBe(true);
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible();
    await expect(page.getByTestId("profile-submit")).toHaveText(gated ? /^Continue$/ : /Save and continue/);
    if (gated) {
      // The gate: /b/* and /new/* both bounce to /onboarding before the profile exists.
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/new/ideate");
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/onboarding");
      await page.getByLabel(/What the team calls you/).fill("Playwright Founder");
      await page.getByLabel("First-time founder").check();
      await page.getByLabel("Full time").check();
      await page.getByLabel(/Budget you can commit/).fill("25k");
      // The chip input and its suggestions list share the "Target markets" label prefix; the textbox is the field.
      const markets = page.getByRole("textbox", { name: "Target markets" });
      await markets.fill("Nordics");
      await markets.press("Enter");
      await page.getByRole("button", { name: "Remote only" }).click();
      await page.getByLabel("Medium").check();
      await page.getByTestId("profile-submit-bottom").click();
    } else {
      await page.getByTestId("profile-submit-bottom").click();
    }
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible();
    // With the profile saved, business routes open.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  });

  test("AC-11.1.2: Ideate drafts a deck; two cards are shortlisted and sent to Compare", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 2);
    const cards = page.getByTestId("concept-grid").locator("[data-concept]");
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    await expect(cards.first().getByRole("meter")).toHaveCount(10);
    for (let i = 0; i < 2; i++) {
      await cards.nth(i).locator("[data-concept-action=shortlist]").click();
      await expect(cards.nth(i).locator("[data-concept-action=shortlist]")).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByText(/2 shortlisted/)).toBeVisible();
    for (let i = 0; i < 2; i++) await cards.nth(i).getByRole("button", { name: /^Compare / }).click();
    await expect(page.getByTestId("compare-bar")).toContainText("2 of 4 selected");
    await page.getByTestId("compare-button").click();
    await expect(page).toHaveURL(/\/new\/compare\?ids=/);
  });

  test("AC-11.1.4: Compare renders the two shortlisted cards with a radar, a ranking and the leader's Commit", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 2);
    const cards = page.getByTestId("concept-grid").locator("[data-concept]");
    for (let i = 0; i < 2; i++) await cards.nth(i).getByRole("button", { name: /^Compare / }).click();
    await page.getByTestId("compare-button").click();
    const result = page.getByTestId("compare-result");
    await expect(result).toBeVisible({ timeout: LONG });
    await expect(result).toHaveAttribute("data-count", "2");
    await expect(result.locator("[data-compare-row]")).toHaveCount(10);
    await expect(page.getByTestId("ranking").locator("[data-rank]")).toHaveCount(2);
    await page.getByTestId("commit-leader").click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    await expect(page.getByTestId("commit-form")).toBeVisible();
  });

  test("AC-11.1.6 AC-11.1.7: Commit defaults to Assisted; Take charge creates the business and lands on Today with the welcome note", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page.getByTestId("commit-form")).toBeVisible();
    await expect(page.getByTestId("commit-form")).toHaveAttribute("data-business-mode", "assisted");
    // How it runs is one line of chips until Change opens the five controls (commit.spec.ts, UX plan §7.6).
    await page.getByTestId("how-it-runs-change").click();
    await expect(page.getByTestId("business-mode-panel")).toBeVisible();
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    const name = `Playwright Business ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    await page.getByTestId("take-charge").click();
    // The first days are about the product (founder, 2026-10-18): Take charge lands on Today (the front door since Nov 7, 2026), not on a Board decision.
    await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
    bid = page.url().match(new RegExp(`/b/(${UUID})/today`))![1]!;
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("kit-bar")).toContainText(name);
    // The foundations draft in the mock model in moments. The foundations banner shows only while a draft is in progress (or
    // when it turns ready during this visit), so the outcome is checked where it lands: the two sign-off notes below.
    // Today: the goal waits for the Chief of Staff (it is proposed after the sign-offs and a round of work).
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("goal-panel")).toHaveAttribute("data-goal", "waiting", { timeout: LONG });
    // The sidebar carries the departments the commit created.
    expect(await page.locator("[data-testid=app-shell] nav a[href*='/d/']").count()).toBeGreaterThanOrEqual(1);
    // The Inbox opens on the Chief of Staff's welcome note: an Update, with no decision to take.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, WELCOME_NOTE)).toBeVisible({ timeout: LONG });
    await inboxRow(page, WELCOME_NOTE).click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toBeVisible({ timeout: LONG });
    await expect(item).toHaveAttribute("data-type", "update");
    await expect(page.getByTestId("decision-bar")).toHaveCount(0);
  });

  test("the sign-off notes wait in Needs you without holding Continue; approving both starts the build and Continue runs a cycle step", async ({ page }) => {
    test.skip(!bid, "the Commit step did not produce a business");
    await signIn(page);
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, SPEC_SIGNOFF)).toBeVisible({ timeout: LONG });
    await expect(inboxRow(page, ROADMAP_SIGNOFF)).toBeVisible({ timeout: LONG });
    // Since Nov 7, 2026 a decision never holds Continue: the Inbox counts them and the button stays Continue.
    await expect(inboxLink(page)).toContainText("2", { timeout: LONG });
    await expect(continueIdle(page)).toBeVisible({ timeout: LONG });

    // The specification first: a sign-off note is a decision from the Product lead with Approve and Request changes.
    await inboxRow(page, SPEC_SIGNOFF).click();
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    const options = page.getByTestId("decision-bar").getByRole("group", { name: "Options" });
    await expect(options.getByRole("button")).toHaveCount(2);
    await expect(page.getByTestId("signoff-panel")).toHaveAttribute("data-signoff-kind", "spec");
    const recommended = options.locator("button[data-recommended]").first();
    await ((await recommended.count()) ? recommended : options.getByRole("button").first()).click();
    await expect(item).toHaveAttribute("data-state", "answered", { timeout: LONG });
    await expect(page.getByTestId("answered-panel")).toBeVisible();
    await expect(inboxLink(page)).toContainText("1", { timeout: LONG });

    // The roadmap: the second approval starts the build.
    await approveFromInbox(page, bid, ROADMAP_SIGNOFF);
    await expect(inboxRow(page, /Building starts:/)).toBeVisible({ timeout: LONG });
    await expect(continueIdle(page)).toBeVisible({ timeout: LONG });

    // One press of Continue → business.continue (in-process cycle step without Temporal) → a toast says what happened.
    await continueIdle(page).click();
    await expect(page.getByText(/cycle (\d+ )?started|cannot run right now|cycle (\d+ )?resumed|already running/i).first()).toBeVisible({ timeout: LONG });
  });

  test("First days: approving both sign-offs plans the first build; distribution waits for Start distribution", async ({ page }) => {
    test.skip(!bid, "the Commit step did not produce a business");
    await signIn(page);
    // The sign-offs read Signed off on the Product tabs; the specification's approval published a version.
    await page.goto(`/b/${bid}/d/product/specification`);
    const banner = page.getByTestId("signoff-banner");
    await expect(banner).toHaveAttribute("data-signoff-status", "approved", { timeout: LONG });
    await expect(banner.getByTestId("signoff-pill")).toContainText(/^Signed off .* · v\d+$/);
    // The Planner's first tasks, tied to roadmap items, on Development › Plan.
    await page.goto(`/b/${bid}/d/development/plan`);
    const tasks = page.getByRole("grid", { name: "Tasks" });
    await expect(tasks).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("plan-stage-banner")).toHaveCount(0);
    await expect.poll(async () => tasks.getByRole("row").filter({ hasNot: page.getByRole("columnheader") }).count(), { timeout: LONG }).toBeGreaterThanOrEqual(3);
    // Distribution waits for the product: the Board says so, the channels are not running, the Board's question is not asked.
    await page.goto(`/b/${bid}/d/distribution/formation`);
    await expect(page.getByTestId("distribution-waiting")).toHaveAttribute("data-product-stage", "building", { timeout: LONG });
    await expect(page.getByText(/^\d+ of 15 on the board · waiting for the product$/)).toBeVisible();
    await page.goto(`/b/${bid}/d/distribution/channels`);
    const channels = page.getByRole("grid", { name: "Channels" });
    await expect(channels).toBeVisible({ timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: "Waiting for the product" }).first()).toBeVisible({ timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: /Starting|Running/ })).toHaveCount(0);
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, WELCOME_NOTE)).toBeVisible({ timeout: LONG });
    // Nothing waits for an answer but the Chief of Staff's goal (proposed once the sign-offs and a round of work are done,
    // founder 2026-11-07): the Board's question is not asked before distribution starts.
    await expect(page.getByTestId("inbox-list").locator("[data-inbox-row][data-needs-answer='true']").filter({ hasNotText: /goal/i })).toHaveCount(0);
    // Start distribution: the Board's question is in the Inbox, the channels start, the Board no longer waits.
    const { boardItemId } = await startDistributionFromBoard(page, bid);
    await expect(page.locator(`[data-inbox-row="${boardItemId}"]`)).toHaveAttribute("data-needs-answer", "true", { timeout: LONG });
    // The Board question waits in Needs you; Continue stays Continue (Nov 7, 2026).
    await expect(continueIdle(page)).toBeVisible({ timeout: LONG });
    await expect(inboxRow(page, "Distribution has started")).toBeVisible({ timeout: LONG });
    await page.goto(`/b/${bid}/d/distribution/channels`);
    await expect(channels).toBeVisible({ timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: "Waiting for the product" })).toHaveCount(0, { timeout: LONG });
    await expect(channels.getByRole("row").filter({ hasText: /Starting|Running/ }).first()).toBeVisible({ timeout: LONG });
  });

  test("AC-11.2.1 AC-11.2.3: Home shows the department cards and the Journey Ribbon for the new business", async ({ page }) => {
    test.skip(!bid, "the Commit step did not produce a business");
    await signIn(page);
    await page.goto(`/b/${bid}/home`);
    const home = page.getByTestId("home-screen");
    await expect(home).toBeVisible({ timeout: LONG });
    // `[data-widget-id]` is the grid item; the WidgetFrame inside repeats `data-widget`.
    await expect(home.locator("[data-widget=journey_ribbon][data-widget-id]")).toBeVisible({ timeout: LONG });
    const cards = home.locator("[data-widget=department_card][data-widget-id]");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    // Each card is a department section with its squad.
    await expect(cards.first().locator("section[data-department]")).toBeVisible();
  });
});

/**
 * Free text decides the Board's question ("Where should the first customer come from?"), which Start distribution
 * posts once the product is signed off (founder, 2026-10-18): each test commits a business, approves both sign-offs
 * with their recommended option and starts distribution from the Board before answering in the founder's own words.
 */
test.describe("free-text decisions", () => {
  test.setTimeout(300_000);

  async function boardQuestionOf(page: Page, name: string): Promise<void> {
    const { bid } = await commitFreshBusiness(page, name);
    await approveBothSignoffs(page, bid);
    await startDistributionFromBoard(page, bid);
  }

  test("AC-11.3.4: 'spend up to €500 on LinkedIn ads…' compiles to enable_channel + set_budget + create_task and shows the confirmation", async ({ page }) => {
    await signIn(page);
    await boardQuestionOf(page, `Playwright Ads ${Date.now().toString(36)}`);
    const { confirmed } = await decideByFreeText(page, "spend up to €500 on LinkedIn ads targeting fintech CFOs next week");
    test.info().annotations.push({ type: "policy", description: confirmed ? "outside policy: confirmation shown and accepted" : "inside policy: executed without confirmation" });
    const actions = page.getByTestId("answered-panel").getByTestId("plan-actions");
    await expect(actions).toBeVisible();
    await expect(actions).toContainText(/Enable channel/);
    await expect(actions).toContainText(/Set budget/);
    await expect(actions).toContainText(/Create task/);
    await expect(actions).not.toContainText(/Founder action/);
  });

  test("AC-11.3.5: 'pay the supplier invoice' compiles to a founder action only, never an automated action", async ({ page }) => {
    await signIn(page);
    await boardQuestionOf(page, `Playwright Gate ${Date.now().toString(36)}`);
    await decideByFreeText(page, "pay the supplier invoice");
    const actions = page.getByTestId("answered-panel").getByTestId("plan-actions");
    await expect(actions).toBeVisible();
    await expect(actions).toContainText(/Founder action/);
    const lines = await actions.locator("li").allInnerTexts();
    for (const line of lines) expect(line).toMatch(/Founder action|Reply:/);
  });
});

test.describe("seeded business (Northwind Skincare)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("AC-11.2.1: the seeded Home renders the Ribbon over two years of data and the department cards", async ({ page }) => {
    const started = Date.now();
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    const home = page.getByTestId("home-screen");
    await expect(home.locator("[data-widget=journey_ribbon][data-widget-id]")).toBeVisible({ timeout: LONG });
    // The ribbon's accessible summary names the range, the departments and the milestones once the data is drawn.
    const ribbon = home.getByRole("group", { name: /^Journey Ribbon:/ });
    await expect(ribbon).toBeVisible({ timeout: LONG });
    test.info().annotations.push({ type: "ribbon-visible-ms", description: String(Date.now() - started) });
    await expect(ribbon).toHaveAccessibleName(/\d+ milestones/);
    expect(await home.locator("[data-widget=department_card][data-widget-id]").count()).toBeGreaterThanOrEqual(3);
  });

  test("AC-11.4.3: a seeded Customer Update renders the same debrief twice", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox?tab=customers`);
    const won = page.getByTestId("inbox-list").getByRole("option").first();
    await expect(won).toBeVisible({ timeout: LONG });
    await won.click();
    await expect(page.getByTestId("customer-update")).toBeVisible();
    const open = page.getByTestId("open-replay");
    await expect(open).toBeEnabled({ timeout: LONG });
    await open.click();
    await page.waitForURL(new RegExp(`/journey/${UUID}`));
    const stage = page.locator("[data-journey-stage]");
    await expect(stage).toBeVisible({ timeout: LONG });
    const hash = await stage.getAttribute("data-schedule-hash");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    const summary = await stage.getAttribute("aria-label");
    await page.reload();
    const again = page.locator("[data-journey-stage]");
    await expect(again).toHaveAttribute("data-schedule-hash", hash!, { timeout: LONG });
    if (summary) await expect(again).toHaveAttribute("aria-label", summary);
    await expect(page.getByTestId("journey-crm-link")).toBeVisible();
  });

  test("AC-11.5.2: Product Changes lists proposals; accepting a hunk writes it into the spec", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    const product = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /product/i }).first();
    await expect(product).toBeVisible({ timeout: LONG });
    const href = (await product.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/changes"));
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "product/changes", { timeout: LONG });
    // The seed gives Northwind one open proposal from the interview transcript with three hunks (packages/db/src/seed/northwind.ts).
    const table = page.getByRole("table", { name: "Change proposals" }).or(page.getByLabel("Change proposals")).first();
    await expect(table).toBeVisible({ timeout: LONG });
    await expect(table).toContainText(/Interview panel/, { timeout: LONG });
    // The screen selects the first open proposal; its detail renders one section per hunk.
    const detail = page.locator("[data-proposal]");
    await expect(detail).toBeVisible({ timeout: LONG });
    // A proposal hunk is the region "Change N: <section · block>" (`section[data-hunk=<uuid>]`); the DiffView inside each
    // one has its own line hunks (`data-hunk=<line id>`), so the cards are addressed by their accessible name.
    const proposalHunks = detail.getByRole("region", { name: /^Change \d+: / });
    await expect(proposalHunks).toHaveCount(3, { timeout: LONG });
    // The first hunk still waiting for a decision (the first hunk on a fresh seed; the suite stays re-runnable until all three are decided).
    const hunk = proposalHunks.filter({ has: page.getByRole("button", { name: "Accept change" }) }).first();
    await expect(hunk, "every seeded hunk is already decided: re-seed (pnpm --filter @foundmill/db seed) to run AC-11.5.2 again").toBeVisible({ timeout: LONG });
    const hunkId = (await hunk.getAttribute("data-hunk"))!;
    expect(hunkId).toMatch(new RegExp(`^${UUID}$`));
    await expect(hunk.getByText("Pending").first()).toBeVisible();
    // What each seeded hunk proposes (PROPOSAL_HUNKS in packages/db/src/seed/northwind.ts), by section.
    const name = (await hunk.getAttribute("aria-label")) ?? "";
    const proposed = /Pricing/.test(name) ? "refills £34 per quarter" : /Features/.test(name) ? "Reaction diary in the account" : "online dermatology clinics as a referral channel";
    const settles = (await proposalHunks.filter({ has: page.getByRole("button", { name: "Accept change" }) }).count()) === 1;
    await hunk.getByRole("button", { name: "Accept change" }).click();
    // The decision is recorded: the hunk shows Accepted, its buttons are gone, and the progress line counts it.
    const decided = detail.locator(`section[data-hunk="${hunkId}"]`);
    await expect(decided).toContainText(/Accepted/, { timeout: LONG });
    await expect(decided.getByRole("button", { name: "Accept change" })).toHaveCount(0);
    await expect(page.getByText(/[1-3] of 3 changes decided/).first()).toBeAttached({ timeout: LONG });
    // Deciding the last hunk settles the proposal and publishes the next version, shown in the result panel.
    if (settles) await expect(detail.getByText(/Version \d+/).first()).toBeVisible({ timeout: LONG });
    // It survives a reload (the api wrote it; nothing was staged client-side only).
    await page.reload();
    await expect(page.locator(`section[data-hunk="${hunkId}"]`)).toContainText(/Accepted/, { timeout: LONG });
    // The accepted text is now in the specification block itself (the hunk's title opens it).
    await page.locator(`section[data-hunk="${hunkId}"] header button`).first().click();
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "product/specification", { timeout: LONG });
    await expect(page.locator("[data-spec-editor]")).toContainText(proposed, { timeout: LONG });
  });

  test("AC-11.12.1: CRM search finds a seeded person and a seeded organisation", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/crm`);
    await expect(page.getByTestId("crm-screen")).toBeVisible({ timeout: LONG });
    const input = page.getByTestId("crm-search-input");

    const t0 = Date.now();
    await input.fill("Hana Brandt");
    const typeahead = page.getByTestId("crm-typeahead");
    await expect(typeahead.getByRole("group", { name: "People" })).toContainText("Hana Brandt", { timeout: LONG });
    test.info().annotations.push({ type: "person-typeahead-ms", description: String(Date.now() - t0) });
    await input.press("Enter");
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "search");
    await expect(page.getByTestId("crm-table-panel")).toContainText("Hana Brandt", { timeout: LONG });

    await page.getByRole("button", { name: "Clear all" }).click();
    const t1 = Date.now();
    await input.fill("Pennine");
    await expect(typeahead.getByRole("group", { name: "Organizations" })).toContainText("Pennine Contract Cosmetics", { timeout: LONG });
    test.info().annotations.push({ type: "organisation-typeahead-ms", description: String(Date.now() - t1) });
    await input.press("Enter");
    await expect(page.getByTestId("crm-table-panel")).toContainText("Pennine Contract Cosmetics", { timeout: LONG });
  });

  test("NeedsLargerWindow replaces the shell below 1280 px and the shell returns at 1440 px; the shell renders without React update loops", async ({ page }) => {
    const loops: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /Maximum update depth/.test(msg.text())) loops.push(msg.text());
    });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox`);
    await expect(page.getByTestId("inbox-list").getByRole("option").first()).toBeVisible({ timeout: LONG });
    await page.setViewportSize({ width: 1279, height: 900 });
    await expect(page.getByTestId("needs-larger-window")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
    // Regression guard: apps/web/components/shell/chrome.tsx once re-ran its effect after its own setChrome.
    expect(loops).toEqual([]);
  });
});
