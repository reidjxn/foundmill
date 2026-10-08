import { expect, test, type Page } from "@playwright/test";

/**
 * The golden path (BUILD §17.1, Gate 1) in mock mode against the PGlite-backed local stack (e2e/playwright.config.ts,
 * apps/web/e2e/README.md): sign in through the dev bypass as the seed owner → founder profile → Ideation Studio →
 * shortlist and compare → Commit ("Take charge") → the Board decision in the Inbox → Continue → decisions by button and
 * by free text (with the "Here is what will happen" confirmation) → Home → the seeded Customer Update → Product
 * Changes → CRM search → NeedsLargerWindow. Test names carry the acceptance-criteria ids they cover.
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

/** Commits the first drafted concept as a new business and returns the Board item's inbox URL parts. */
async function commitFreshBusiness(page: Page, name: string): Promise<{ bid: string; itemId: string }> {
  await ensureDeck(page, 1);
  await page.getByTestId("commit-link").first().click();
  await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
  await expect(page.getByTestId("commit-form")).toBeVisible();
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/inbox/${UUID}`), { timeout: LONG });
  const m = page.url().match(new RegExp(`/b/(${UUID})/inbox/(${UUID})`))!;
  await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
  return { bid: m[1]!, itemId: m[2]! };
}

/** Answers the current item through the free-text form; walks through the confirmation when the plan needs it. */
async function decideByFreeText(page: Page, text: string): Promise<{ confirmed: boolean }> {
  const bar = page.getByTestId("decision-bar");
  await expect(bar).toHaveAttribute("data-state", "open");
  await bar.getByLabel("Free-text instruction").fill(text);
  await bar.getByRole("button", { name: "Execute the instruction" }).click();
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
const respondButton = (page: Page) => page.getByRole("button", { name: /^Respond to \d+ items?$/ });

test.describe("golden path", () => {
  test.describe.configure({ mode: "serial" });

  let bid = "";
  let boardItemId = "";

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

  test("AC-11.1.6 AC-11.1.7: Commit defaults to Assisted; Take charge creates the business and opens the Board item", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page.getByTestId("commit-form")).toBeVisible();
    await expect(page.getByTestId("commit-form")).toHaveAttribute("data-business-mode", "assisted");
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    const name = `Playwright Club ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    await page.getByTestId("take-charge").click();
    await page.waitForURL(new RegExp(`/b/${UUID}/inbox/${UUID}`), { timeout: LONG });
    const m = page.url().match(new RegExp(`/b/(${UUID})/inbox/(${UUID})`))!;
    bid = m[1]!;
    boardItemId = m[2]!;
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("kit-bar")).toContainText(name);
    // The Board item: a decision from the Chief of Staff with at least two options.
    const item = page.getByTestId("inbox-item");
    await expect(item).toBeVisible({ timeout: LONG });
    await expect(item).toHaveAttribute("data-type", "decision");
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    expect(await page.getByTestId("decision-bar").getByRole("group", { name: "Options" }).getByRole("button").count()).toBeGreaterThanOrEqual(2);
    // The sidebar carries the departments the commit created.
    expect(await page.locator("[data-testid=app-shell] nav a[href*='/d/']").count()).toBeGreaterThanOrEqual(1);
  });

  test("AC-11.3.3: Continue reads Respond · N while the Board item waits; a button decision releases it and Continue runs a cycle step", async ({ page }) => {
    test.skip(!bid, "the Commit step did not produce a business");
    await signIn(page);
    await page.goto(`/b/${bid}/inbox/${boardItemId}`);
    const respond = respondButton(page);
    await expect(respond).toBeVisible({ timeout: LONG });
    await expect(respond).toHaveText(/Respond · \d+/);
    const countBefore = Number((await respond.innerText()).match(/\d+/)?.[0] ?? "0");
    expect(countBefore).toBeGreaterThanOrEqual(1);

    const options = page.getByTestId("decision-bar").getByRole("group", { name: "Options" });
    const recommended = options.locator("button[data-recommended]").first();
    await ((await recommended.count()) ? recommended : options.getByRole("button").first()).click();
    const confirm = page.getByTestId("confirm-plan");
    const answered = page.getByTestId("answered-panel");
    await expect(confirm.or(answered).first()).toBeVisible({ timeout: LONG });
    if (await confirm.isVisible()) {
      await expect(confirm.getByRole("heading", { name: "Here is what will happen" })).toBeVisible();
      await page.getByTestId("confirm-plan-go").click();
      await expect(confirm).toBeHidden({ timeout: LONG });
    }
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", "answered");
    await expect(answered).toBeVisible();
    if (countBefore <= 1) await expect(continueIdle(page)).toBeVisible({ timeout: LONG });
    else await expect(page.getByRole("button", { name: `Respond to ${countBefore - 1} item${countBefore - 1 === 1 ? "" : "s"}` })).toBeVisible({ timeout: LONG });

    // One press of Continue → business.continue (in-process cycle step without Temporal) → a toast says what happened.
    if (countBefore <= 1) {
      await continueIdle(page).click();
      await expect(page.getByText(/Cycle started|One new note|Cycle resumed|already running/).first()).toBeVisible({ timeout: LONG });
    }
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

test.describe("free-text decisions", () => {
  test("AC-11.3.4: 'spend up to €500 on LinkedIn ads…' compiles to enable_channel + set_budget + create_task and shows the confirmation", async ({ page }) => {
    await signIn(page);
    await commitFreshBusiness(page, `Playwright Ads ${Date.now().toString(36)}`);
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
    await commitFreshBusiness(page, `Playwright Gate ${Date.now().toString(36)}`);
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

  test("AC-11.5.2: Product Changes lists proposals; accepting a hunk records the decision", async ({ page }) => {
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
    // A proposal hunk is the region "Hunk N: <section · block>" (`section[data-hunk=<uuid>]`); the DiffView inside each
    // one has its own line hunks ("Hunk 1", `data-hunk=<line id>`), so the cards are addressed by their accessible name.
    const proposalHunks = detail.getByRole("region", { name: /^Hunk \d+: / });
    await expect(proposalHunks).toHaveCount(3, { timeout: LONG });
    // The first hunk still waiting for a decision (the first hunk on a fresh seed; the suite stays re-runnable until all three are decided).
    const hunk = proposalHunks.filter({ has: page.getByRole("button", { name: "Accept hunk" }) }).first();
    await expect(hunk, "every seeded hunk is already decided: re-seed (pnpm --filter @foundmill/db seed) to run AC-11.5.2 again").toBeVisible({ timeout: LONG });
    const hunkId = (await hunk.getAttribute("data-hunk"))!;
    expect(hunkId).toMatch(new RegExp(`^${UUID}$`));
    await expect(hunk.getByText("Pending").first()).toBeVisible();
    await hunk.getByRole("button", { name: "Accept hunk" }).click();
    // The decision is recorded: the hunk shows Accepted, its buttons are gone, and the progress line counts it.
    const decided = detail.locator(`section[data-hunk="${hunkId}"]`);
    await expect(decided).toContainText(/Accepted/, { timeout: LONG });
    await expect(decided.getByRole("button", { name: "Accept hunk" })).toHaveCount(0);
    await expect(page.getByText(/[1-3] of 3 hunks decided/)).toBeAttached({ timeout: LONG });
    // It survives a reload (the api wrote it; nothing was staged client-side only).
    await page.reload();
    await expect(page.locator(`section[data-hunk="${hunkId}"]`)).toContainText(/Accepted/, { timeout: LONG });
  });

  test("AC-11.12.1: CRM search finds a seeded person and a seeded organisation", async ({ page }) => {
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/crm`);
    await expect(page.getByTestId("crm-screen")).toBeVisible({ timeout: LONG });
    const input = page.getByTestId("crm-search-input");

    const t0 = Date.now();
    await input.fill("Hana Brandt");
    const typeahead = page.getByTestId("crm-typeahead");
    await expect(typeahead.getByRole("region", { name: "People" }).or(typeahead.locator("section[aria-label=People]"))).toContainText("Hana Brandt", { timeout: LONG });
    test.info().annotations.push({ type: "person-typeahead-ms", description: String(Date.now() - t0) });
    await input.press("Enter");
    await expect(page.getByTestId("crm-screen")).toHaveAttribute("data-mode", "search");
    await expect(page.getByTestId("crm-table-panel")).toContainText("Hana Brandt", { timeout: LONG });

    await page.getByRole("button", { name: "Clear all" }).click();
    const t1 = Date.now();
    await input.fill("Pennine");
    await expect(typeahead.locator("section[aria-label=Organisations]")).toContainText("Pennine Contract Cosmetics", { timeout: LONG });
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
