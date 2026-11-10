import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, chooseTableView, devApi, openBusiness, openExplainer } from "./helpers";

/**
 * Distribution, Finance and Legal on the seeded Northwind Skincare (its Distribution department is named "Retail
 * Partnerships"; the route slug stays `distribution`). Every tab renders in plain words and the business's own
 * currency: no snake_case keys, registry codes or enum values reach the founder, Northwind's money reads in pounds, an
 * empty cap table says so once, and empty lists offer the way to fill them. Stack: e2e/README.md.
 */
const D = `/b/${NORTHWIND_BUSINESS_ID}/d`;
const TABS = {
  distribution: ["formation", "channels", "leads", "campaigns", "creative", "attribution"],
  finance: ["overview", "pnl", "cash", "runway", "wage-bill", "cap-table"],
  legal: ["entity", "incorporate", "compliance", "contracts", "ip", "policies", "regulatory"],
} as const;

/** Opens a department tab and waits until the module screen has loaded (no panel still on its skeleton). */
async function openTab(page: Page, dept: keyof typeof TABS, tab: string): Promise<void> {
  await page.goto(`${D}/${dept}/${tab}`);
  const screen = page.getByTestId("module-screen");
  await expect(screen).toBeVisible({ timeout: LONG });
  await expect(screen).toHaveAttribute("data-module", `${dept}/${tab}`);
  await expect(screen.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: LONG });
}

/** The dev founder's guidance switch (Settings › Preferences): examples to try render only while it is on. */
async function guidanceOn(playwright: PlaywrightWorkerArgs["playwright"]): Promise<boolean> {
  const api = await devApi(playwright);
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { guidance: "on" | "off" } } } };
  await api.dispose();
  return body.result.data.json.guidance === "on";
}

/** A stored key shown as-is: two or more lower-case words joined by underscores ("cost_of_goods", "private_limited_company"). */
const RAW_KEY = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

test.describe("distribution, finance and legal read in plain words", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  for (const [dept, tabs] of Object.entries(TABS) as [keyof typeof TABS, readonly string[]][]) {
    test(`${dept}: every tab renders without raw keys or another currency`, async ({ page }) => {
      test.setTimeout(6 * 60_000);
      for (const tab of tabs) {
        await openTab(page, dept, tab);
        const text = await page.getByTestId("module-screen").innerText();
        expect(text, `${dept}/${tab} shows a raw key`).not.toMatch(RAW_KEY);
        expect(text, `${dept}/${tab} shows euros on a business that keeps its books in pounds`).not.toContain("€");
        expect(text, `${dept}/${tab} uses a football word`).not.toMatch(/\b(squad|club|kit)\b/i);
      }
    });
  }

  test("finance: P&L lines are chart-of-accounts words, the period is a segmented control, money is in pounds", async ({ page }) => {
    await openTab(page, "finance", "pnl");
    const table = page.getByRole("grid", { name: "Profit and loss" });
    await expect(table.getByText("Cost of sales", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("cost_of_goods")).toHaveCount(0);
    // The API's "cash basis" label reads in plain words (UX plan §7.14).
    await expect(page.getByText("Management view, unaudited, cash basis: counted when the cash moves")).toBeVisible();
    const period = page.getByRole("group", { name: "Period" });
    await period.getByRole("button", { name: "6 months" }).click();
    await expect(period.getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
    await expect(table).toContainText("£");
    // Transactions is in the full view; Simple (UX plan principle 10) keeps every line with the amount and its share only.
    await chooseTableView(page, "Management P&L");
    // The line column takes the spare width, so Amount, % of revenue and Transactions sit together at the right, just
    // before the row's visible "…" (UX plan D6), which closes the row.
    const box = await table.boundingBox();
    const amount = await table.getByRole("columnheader", { name: "Amount" }).boundingBox();
    const count = await table.getByRole("columnheader", { name: "Transactions" }).boundingBox();
    const actions = await table.locator('[role="columnheader"][data-col="__actions"]').boundingBox();
    expect(box && amount && count && actions, "the P&L headers are on screen").toBeTruthy();
    expect(count!.x - (amount!.x + amount!.width), "a gap opens between the figures").toBeLessThan(160);
    expect(Math.abs(actions!.x - (count!.x + count!.width)), "Transactions sits against the row actions").toBeLessThan(2);
    expect(actions!.x + actions!.width).toBeGreaterThan(box!.x + box!.width - 24);
  });

  test("finance: Payroll keeps the team's metered cost and its wage caps in US dollars, apart from staff payroll in pounds", async ({ page }) => {
    await openTab(page, "finance", "wage-bill");
    const strip = page.getByRole("region", { name: "Payroll summary" });
    // Metered in US dollars: the tile says what the figure is (UX plan §7.14, C21), never "payroll" in another currency.
    await expect(strip.getByText("AI usage cost (USD)")).toBeVisible();
    // Never added across currencies: the team in US dollars, staff in the business's pounds.
    await expect(strip).toContainText("$");
    await expect(strip).toContainText("£");
    const table = page.getByRole("grid", { name: "Team payroll" });
    await expect(table).toContainText("$");
    await expect(table).not.toContainText("£");
  });

  test("finance: the Overview carries the department's intro, a defined word on each tile label and a plain line under each figure (UX plan §7.14)", async ({ page }) => {
    await openTab(page, "finance", "overview");
    const metrics = page.getByRole("region", { name: "Finance metrics" });
    await expect(metrics.locator("[data-metric-tile]").first()).toBeVisible({ timeout: LONG });
    // Guidance on (the product default): the page's one "Explain this page" button, no banner in the metrics region.
    await expect(metrics.locator("[data-explainer]")).toHaveCount(0);
    const explainer = await openExplainer(page, "finance/overview");
    await expect(explainer).toContainText("Where the money is and how long it lasts.");
    await expect(explainer).toContainText("The line under the numbers says which are estimates: worked out, not measured.");
    await page.keyboard.press("Escape");
    // Three numbers first, the rest behind More numbers, and "Estimate" once in words (Nov 7, 2026).
    await expect(page.getByTestId("finance-headline").locator("[data-metric]")).toHaveCount(3);
    await expect(page.getByTestId("finance-estimate-note")).toContainText(/^Estimate: /);
    // The Money area's opening line carries the plain sentence (Nov 9, 2026); the screen does not repeat it. The runway
    // tile's label is a defined word with its plain line under the figure.
    await expect(page.getByTestId("area-line")).toContainText(/You have .+/);
    await expect(page.getByTestId("finance-summary")).toHaveCount(0);
    const runway = page.locator("[data-metric='runway']");
    await expect(runway.locator("[data-term='runway']")).toBeVisible();
    await expect(runway.locator("[data-plain-line]")).toContainText("How many months your cash lasts at today's spending.");
    expect(await metrics.locator("[data-plain-line]").count()).toBe(10);
    // Hovering the defined word opens its definition card, with somewhere to go.
    await runway.locator("[data-term='runway']").hover();
    await expect(page.locator("[data-definition-card]")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-definition-card] [data-definition-learn]")).toHaveAttribute("href", /\/finance\/runway$/);
  });

  test("finance: payback divides by the whole paying base, never by the customers the channels just won", async ({ page }) => {
    await openTab(page, "finance", "overview");
    // Payback and acquisition cost sit behind More numbers (Nov 7, 2026).
    await page.getByTestId("finance-more").getByText("More numbers").click();
    const caption = async (metric: string) => (await page.locator(`[data-metric="${metric}"] [data-metric-caption]`).innerText()).trim();
    const payback = await caption("payback");
    // "<n> paying customers": the base at the end of the revenue window, not the customers the channels just won.
    // With too little in the window to compute it, the tile says what it waits for, in words; never a made-up figure.
    if (/^Appears with/.test(payback)) {
      expect(payback).toContain("paying customers");
      return;
    }
    expect(payback).toMatch(/^[\d,]+ paying customers?$/);
    const base = Number(payback.replace(/[^\d]/g, ""));
    const won = Number(((await caption("acquisitionCost")).match(/^([\d,]+) customers?/)?.[1] ?? "0").replace(/,/g, ""));
    expect(base, "the payback base is larger than the customers acquired in the channel window").toBeGreaterThan(won);
  });

  test("finance: an empty cap table says so once and has nothing to export", async ({ page }) => {
    await openTab(page, "finance", "cap-table");
    await expect(page.getByText("No cap table yet")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Open Legal" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Delaware stock ledger" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Aktiebok" })).toBeDisabled();
    // The other panels keep their place with one quiet line each: no second empty state, form or zero-count footer.
    const screen = page.getByTestId("module-screen");
    await expect(screen.locator('[role="status"]')).toHaveCount(1);
    await expect(page.getByRole("form", { name: "Round inputs" })).toHaveCount(0);
    await expect(page.getByText("Model a priced round here once the first shares are recorded.")).toBeVisible();
    await expect(screen.getByText(/^0 (holders|issuances)\b/)).toHaveCount(0);
  });

  test("finance: the Cash panel's caret menu pins Cash and runway to Home, and unpins it (audit #394)", async ({ page }) => {
    await openTab(page, "finance", "overview");
    const cash = page.getByRole("region", { name: "Cash", exact: true });
    await cash.getByRole("button", { name: "Panel menu" }).click();
    const item = page.getByRole("menuitem", { name: /^(Pin to Home|Unpin from Home)$/ });
    await expect(item).toBeVisible();
    // Start unpinned whatever an earlier run left.
    if ((await item.innerText()).includes("Unpin")) {
      await item.click();
      await cash.getByRole("button", { name: "Panel menu" }).click();
    }
    await page.getByRole("menuitem", { name: "Pin to Home" }).click();
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    // (Both the frame and the widget inside it carry the name.)
    await expect(page.locator("[data-widget=cash_runway]").first()).toBeVisible({ timeout: LONG });
    await openTab(page, "finance", "overview");
    await page.getByRole("region", { name: "Cash", exact: true }).getByRole("button", { name: "Panel menu" }).click();
    await page.getByRole("menuitem", { name: "Unpin from Home" }).click();
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-widget=cash_runway]")).toHaveCount(0);
  });

  test("finance: the empty cap table's Open Legal goes to the department that holds Legal (audit #192)", async ({ page }) => {
    await openTab(page, "finance", "cap-table");
    await page.getByRole("button", { name: "Open Legal" }).click();
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "legal/entity", { timeout: LONG });
    await expect(page.getByText(/No such department/)).toHaveCount(0);
  });

  test("finance: runway drivers are money fields in the business's currency", async ({ page }) => {
    await openTab(page, "finance", "runway");
    const form = page.getByRole("form", { name: "Base drivers" });
    const cash = form.getByLabel("Starting cash");
    // Grouped at rest, with cents when it has them (#172). The seed dates its ledger from today, so the demo business can
    // be overdrawn on some days ("-1,924.20" on 2026-10-20): a minus sign is part of the format.
    await expect(cash).toHaveValue(/^-?\d{1,3}(,\d{3})*(\.\d{2})?$/);
    await expect(form.getByText("GBP").first()).toBeVisible();
    await page.getByRole("group", { name: "Scenario" }).getByRole("button", { name: /Upside/ }).click();
    await expect(page.getByRole("form", { name: "Upside drivers" })).toBeVisible();
  });

  test("finance: Runway's example drivers fill the form read-only, hold Save and Reset, and are never saved (UX plan Phase 3)", async ({ page, playwright }) => {
    await openTab(page, "finance", "runway");
    const toggle = page.getByTestId("runway-example-toggle");
    if (!(await guidanceOn(playwright))) {
      // Guidance off: examples to try are tutoring, so the toggle is not there; the real drafts stay as they are.
      await expect(toggle).toHaveCount(0);
      return;
    }
    const form = page.getByRole("form", { name: "Base drivers" });
    const cashBefore = await form.getByLabel("Starting cash").inputValue();
    await toggle.getByRole("button", { name: "Show me an example" }).click();
    const example = page.getByTestId("runway-example");
    await expect(example).toBeVisible();
    await expect(example.getByText("Example", { exact: true }).first()).toBeVisible();
    const expected: [string, RegExp][] = [
      ["Starting cash", /^30,000(\.00)?$/],
      ["Monthly revenue", /^4,000(\.00)?$/],
      ["Revenue growth", /^5$/],
      ["Monthly costs", /^7,500(\.00)?$/],
      ["Cost growth", /^1$/],
      ["Horizon", /^24$/],
    ];
    for (const [label, value] of expected) {
      const field = example.getByLabel(label, { exact: true });
      await expect(field, label).toHaveValue(value);
      await expect(field, label).toHaveAttribute("readonly", "");
    }
    await expect(form.getByRole("button", { name: "Save Base forecast" })).toBeDisabled();
    await expect(form.getByRole("button", { name: "Reset" })).toBeDisabled();
    await expect(page.locator("[data-driver-runway]")).toHaveText(/^Example runway with these drivers:/);
    // Hiding it gives the founder's own drafts back, untouched.
    await page.getByTestId("runway-example-toggle").getByRole("button", { name: "Hide the example" }).click();
    await expect(example).toHaveCount(0);
    await expect(form.getByLabel("Starting cash")).toHaveValue(cashBefore);
    await expect(page.locator("[data-driver-runway]")).toHaveText(/^Base runway with these drivers:/);
  });

  test("finance: every projected figure on Runway carries a Forecast label", async ({ page }) => {
    await openTab(page, "finance", "runway");
    const warnings = page.getByRole("region", { name: /Runway warnings/ });
    // The panel itself, and the cash-out and cash-at-horizon figures, are projections from the drivers.
    await expect(warnings.getByText("Forecast", { exact: true }).first()).toBeVisible();
    const cash = page.getByRole("list", { name: "Runway by scenario" }).getByText(/^Cash, /).first();
    await expect(cash.locator("..").getByText("Forecast", { exact: true })).toBeVisible();
    // The driver summary under the form says so too.
    await expect(page.locator("[data-driver-runway]").getByText("Forecast", { exact: true })).toBeVisible();
  });

  test("distribution: the Channels table carries a built-in Simple view (Channel, Fit, Status, Cost per customer) and the general view stays one click away (UX plan §7.10)", async ({ page }) => {
    await openTab(page, "distribution", "channels");
    const table = page.getByRole("grid", { name: "Channels" });
    await expect(table.getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
    // The open view is saved per person (audit #204), so the test picks Simple itself rather than trusting the default.
    await chooseTableView(page, "Simple");
    // The heads' words as written: column heads render in data caps (docs/DESIGN.md, t-data), so innerText is upper case.
    const heads = (await table.getByRole("columnheader").allTextContents()).map((t) => t.trim()).filter(Boolean);
    expect(heads.slice(0, 4)).toEqual(["Channel", "Fit", "Status", "Cost per customer"]);
    // A defined head (Fit, Cost per customer) is in the same caps as the plain ones, not left in sentence case.
    await expect(table.locator("[data-header-term='fit'] [data-term='fit']")).toHaveCSS("text-transform", "uppercase");
    await expect(table.getByRole("row").filter({ hasText: "Acquisition" })).toHaveCount(0);
    // The panel's help tip (guidance on, the product default) and the footer's defined words.
    await expect(page.getByRole("button", { name: "About Channels" })).toBeVisible();
    await expect(page.locator("[data-term='acquisition_cost']").first()).toBeVisible();
    // Back to the general view: Family returns, and the choice is what later tests expect.
    await chooseTableView(page, "All channels");
    await expect(table.getByRole("columnheader", { name: /Family/ })).toBeVisible();
  });

  test("distribution: channel names are never squeezed by the recommendation mark and £0 is not an estimate", async ({ page }) => {
    await openTab(page, "distribution", "channels");
    const table = page.getByRole("grid", { name: "Channels" });
    // The Strategist's pick is the Board's thumbs-up mark beside the name, named "Recommended" for assistive tech.
    const first = table.getByRole("row").filter({ hasText: "Recommended" }).first();
    await expect(first).toBeVisible();
    await expect(first.getByTitle("Recommended by the Distribution Strategist")).toBeVisible();
    const name = first.locator("[data-channel-name]");
    const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, "the recommended channel's name is cut").toBe(false);
    await expect(table.getByText("No spend").first()).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "£0.00 Estimate" })).toHaveCount(0);
  });

  test("distribution: a channel's profile card agrees with the Channels table (No spend, one Offline tracking chip)", async ({ page }) => {
    await openTab(page, "distribution", "channels");
    const table = page.getByRole("grid", { name: "Channels" });
    const spendless = table.getByRole("row").filter({ hasText: "No spend" }).first();
    await expect(spendless).toBeVisible();
    await spendless.locator("[data-channel-name]").dblclick();
    const drawer = page.locator("[data-channel-drawer]");
    await expect(drawer).toBeVisible({ timeout: LONG });
    // "Cost per customer (Estimate)" reads "No spend" like the table, never "£0.00".
    await expect(drawer).toContainText(/Cost per customer \(Estimate\)\s*No spend/);
    await expect(drawer).not.toContainText("£0.00 Estimate");
    // The chip is the card's own, shown once; offline-tracked channels say so as the table does.
    expect(await drawer.getByText("Offline tracking", { exact: true }).count()).toBeLessThanOrEqual(1);
  });

  test("distribution: campaigns can be created and edited, and ending one asks first", async ({ page }) => {
    await openTab(page, "distribution", "campaigns");
    await page.getByRole("button", { name: "New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New campaign" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(dialog.getByText("Give the campaign a name.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Ending is final: the verb opens a confirmation, and keeping the campaign changes nothing.
    const table = page.getByRole("grid", { name: "Campaigns" });
    const row = table.getByRole("row").nth(1);
    await expect(row).toBeVisible({ timeout: LONG });
    await row.click({ button: "right" });
    const end = page.getByRole("menuitem", { name: "End campaign…" });
    if (await end.isEnabled()) {
      await end.click();
      const confirm = page.getByRole("dialog", { name: /^End / });
      await expect(confirm).toContainText("Ending is final");
      await confirm.getByRole("button", { name: "Keep it running" }).click();
      await expect(confirm).toBeHidden();
    } else {
      await page.keyboard.press("Escape");
    }
  });

  test("distribution: how credit is shared reads in plain words, the model sits under Technical detail, and the win count comes from the whole history", async ({ page }) => {
    await openTab(page, "distribution", "attribution");
    const model = page.getByRole("region", { name: "How credit is shared" });
    await expect(model).toBeVisible();
    await expect(page.getByRole("region", { name: "Model in use" })).toHaveCount(0);
    const count = Number((await model.getByText(/^[\d,]+$/).first().innerText()).replace(/,/g, ""));
    // The headline is a sentence, never an algorithm's name; the name waits behind the disclosure.
    const headline = page.getByTestId("credit-headline");
    await expect(headline).not.toContainText(/Markov|Position-based/);
    const technical = page.getByTestId("credit-technical");
    await technical.locator("summary").click();
    // Past 200 labeled conversions the model is data-driven (the replays say so), and no "more to go" countdown.
    if (count >= 200) {
      await expect(headline).toContainText("Each touch gets the credit it earned");
      await expect(technical).toContainText("Data-driven (Markov removal effect)");
      await expect(technical).not.toContainText("more to go");
    } else {
      await expect(headline).toContainText("Early touches get 40 %, the last touch 40 %, the middle 20 %.");
      await expect(technical).toContainText("Position-based 40/20/40");
    }
  });

  test("distribution: the touch funnel never reads 0 % or more than 100 % for a step", async ({ page }) => {
    await openTab(page, "distribution", "attribution");
    const funnel = page.getByRole("region", { name: "Touch funnel" });
    await expect(funnel.locator("[data-funnel-stage]").first()).toBeVisible({ timeout: LONG });
    const rates = await funnel.locator("[data-funnel-stage] text").allTextContents();
    for (const rate of rates.filter((t) => t.includes("%"))) {
      for (const pct of rate.match(/[\d.]+(?=%)/g) ?? []) {
        expect(Number(pct), `funnel rate "${rate}"`).toBeGreaterThan(0);
        expect(Number(pct), `funnel rate "${rate}"`).toBeLessThanOrEqual(100);
      }
    }
  });

  test("distribution: the Board counts as running only channels whose engine runs (audit GTM-01); the demo sells, so nothing waits for the product", async ({ page }) => {
    await openTab(page, "distribution", "formation");
    // A channel on the board without its engine yet reads "starting", never "running".
    await expect(page.getByText(/^\d+ of 15 running( · \d+ starting)?$/)).toBeVisible({ timeout: LONG });
    // What fit is, once, under the title; the re-score button in plain words (UX plan §7.13, C9).
    await expect(page.getByTestId("board-caption")).toContainText("Fit 1–20: how well a channel suits this business");
    await expect(page.getByRole("button", { name: /^(Score again|Get recommendation)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-score" })).toHaveCount(0);
    // Guidance on (the product default): the department's intro inside the Board's body, Fit as a defined word in the
    // caption, the panel's one-sentence help tip, and the key's defined word under the board (UX plan §7.10, §7.13).
    const board = page.getByRole("region", { name: "Board" }).first();
    await expect(await openExplainer(page, "distribution/board")).toContainText("How customers will find you.");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("board-caption").locator("[data-term='fit']")).toBeVisible();
    await expect(board.getByRole("button", { name: "About Board" })).toBeVisible();
    await expect(page.locator("[data-board-key] [data-term='fit']")).toBeVisible();
    // Northwind started distribution in its first weeks (the seed): no Start distribution banner.
    await expect(page.getByTestId("distribution-waiting")).toHaveCount(0);
    await openTab(page, "distribution", "channels");
    const table = page.getByRole("grid", { name: "Channels" });
    const starting = table.getByRole("row").filter({ hasText: "Starting" });
    if ((await starting.count()) > 0) await expect(starting.first().getByTitle(/engine has not started yet/)).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Waiting for the product" })).toHaveCount(0);
  });

  test("distribution: drafted creative shows its copy on the card", async ({ page }) => {
    await openTab(page, "distribution", "creative");
    if (await page.getByText("No creative yet").isVisible()) return;
    const card = page.locator("article[data-asset]").first();
    await expect(card).toBeVisible({ timeout: LONG });
    // An engine's draft carries its body (a mock draft says so in its first line).
    const body = card.getByTestId("asset-body");
    if ((await body.count()) > 0) await expect(body).not.toBeEmpty();
  });

  test("distribution: empty Leads and Creative each offer the way to fill them", async ({ page }) => {
    await openTab(page, "distribution", "leads");
    if (await page.getByText("No leads yet").isVisible()) {
      await page.getByRole("button", { name: "Open Lead generation" }).click();
      await expect(page).toHaveURL(/\/d\/distribution\/formation\?channel=lead_generation$/, { timeout: LONG });
      await expect(page.getByRole("complementary", { name: "Lead generation" })).toBeVisible({ timeout: LONG });
    }
    await openTab(page, "distribution", "creative");
    if (await page.getByText("No creative yet").isVisible()) {
      await page.getByRole("button", { name: "Open campaigns" }).click();
      await expect(page).toHaveURL(/\/d\/distribution\/campaigns$/, { timeout: LONG });
    }
  });

  test("legal: the entity and the generated privacy policy read in words, the document route is not called a kit", async ({ page }) => {
    await openTab(page, "legal", "entity");
    const facts = page.getByRole("region", { name: "Legal entity" });
    await expect(facts.getByText("Private limited company")).toBeVisible();
    await expect(facts.getByText("United Kingdom", { exact: true })).toBeVisible();
    // Guidance on (the product default): the department's intro sits in the entity panel's body, above the facts, and
    // Jurisdiction is a defined word (UX plan §7.10, §7.16).
    const explainer = await openExplainer(page, "legal/entity");
    await expect(explainer).toContainText("The company itself: where it is registered, what it must file, what it has signed.");
    await expect(explainer).toContainText("Information, not legal advice.");
    await page.keyboard.press("Escape");
    await expect(facts.locator("[data-term='jurisdiction']").first()).toBeVisible();
    await openTab(page, "legal", "policies");
    await expect(page.getByText(/private limited company, registration number \d+ \(United Kingdom\)/)).toBeVisible();
    // A UK company's policy cites the UK GDPR and is dated in words, never an ISO key.
    await expect(page.getByText(/UK General Data Protection Regulation \(UK GDPR\)/)).toBeVisible();
    await expect(page.getByText(/^Last updated [A-Z][a-z]+ \d{1,2}, \d{4}$/)).toBeVisible();
    await openTab(page, "legal", "incorporate");
    await expect(page.getByRole("radio", { name: /Document pack · Any other country or state/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Kit\b/ })).toHaveCount(0);
  });

  test("legal: compliance switches between list and calendar with a segmented control", async ({ page }) => {
    await openTab(page, "legal", "compliance");
    const view = page.getByRole("group", { name: "View" });
    await view.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByRole("list", { name: "Twelve-month calendar" })).toBeVisible();
    await view.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("grid", { name: "Deadlines" })).toBeVisible();
  });
});

/**
 * At 1280, the narrowest desktop, every table on these screens fits its panel: no column hidden past the panel's edge
 * behind a sideways scroll (the column widths follow the table's real width, see useFittedColumns).
 */
test.describe("distribution, finance and legal tables fit at 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("no table scrolls sideways on its default view", async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await openBusiness(page);
    const routes: Array<[keyof typeof TABS, string]> = [
      ["distribution", "channels"],
      ["distribution", "leads"],
      ["distribution", "campaigns"],
      ["distribution", "attribution"],
      ["finance", "pnl"],
      ["finance", "cash"],
      ["finance", "wage-bill"],
      ["legal", "entity"],
      ["legal", "compliance"],
      ["legal", "contracts"],
    ];
    for (const [dept, tab] of routes) {
      await openTab(page, dept, tab);
      // Channels keeps whatever view an earlier test left open (the general view is wider than 1280 px); this test
      // measures the default, the Simple view that opens while guidance is on.
      if (dept === "distribution" && tab === "channels") await chooseTableView(page, "Simple");
      const grids = page.getByTestId("module-screen").getByRole("grid");
      await expect(grids.first()).toBeVisible({ timeout: LONG });
      // Column widths settle after the first layout pass (they follow the measured width).
      await page.waitForTimeout(500);
      const overflow = await grids.evaluateAll((els) =>
        els.map((g) => {
          const body = g.closest("[data-density]") ?? g.parentElement!;
          return { name: g.getAttribute("aria-label"), over: body.scrollWidth - body.clientWidth };
        }),
      );
      for (const o of overflow) expect(o.over, `${dept}/${tab}: "${o.name}" scrolls sideways by ${o.over}px`).toBeLessThanOrEqual(1);
    }
  });
});
