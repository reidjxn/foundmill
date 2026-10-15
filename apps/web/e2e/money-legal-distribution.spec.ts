import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

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
    await expect(page.getByText("Management P&L, unaudited, cash basis")).toBeVisible();
    const period = page.getByRole("group", { name: "Period" });
    await period.getByRole("button", { name: "6 months" }).click();
    await expect(period.getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
    await expect(table).toContainText("£");
    // The line column takes the spare width, so Amount, % of revenue and Transactions sit together at the right.
    const box = await table.boundingBox();
    const amount = await table.getByRole("columnheader", { name: "Amount" }).boundingBox();
    const count = await table.getByRole("columnheader", { name: "Transactions" }).boundingBox();
    expect(box && amount && count, "the P&L headers are on screen").toBeTruthy();
    expect(count!.x - (amount!.x + amount!.width), "a gap opens between the figures").toBeLessThan(160);
    expect(count!.x + count!.width).toBeGreaterThan(box!.x + box!.width - 24);
  });

  test("finance: Payroll keeps the team's metered cost and its wage caps in US dollars, apart from staff payroll in pounds", async ({ page }) => {
    await openTab(page, "finance", "wage-bill");
    const strip = page.getByRole("region", { name: "Payroll summary" });
    await expect(strip.getByText("Team payroll")).toBeVisible();
    // Never added across currencies: the team in US dollars, staff in the business's pounds.
    await expect(strip).toContainText("$");
    await expect(strip).toContainText("£");
    const table = page.getByRole("grid", { name: "Team payroll" });
    await expect(table).toContainText("$");
    await expect(table).not.toContainText("£");
  });

  test("finance: payback divides by the whole paying base, never by the customers the channels just won", async ({ page }) => {
    await openTab(page, "finance", "overview");
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
    await expect(cash).toHaveValue(/^\d{1,3}(,\d{3})*(\.\d{2})?$/); // grouped at rest, with cents when it has them (#172)
    await expect(form.getByText("GBP").first()).toBeVisible();
    await page.getByRole("group", { name: "Scenario" }).getByRole("button", { name: /Upside/ }).click();
    await expect(page.getByRole("form", { name: "Upside drivers" })).toBeVisible();
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

  test("distribution: the model in use and the win count come from the whole history and agree with the replays", async ({ page }) => {
    await openTab(page, "distribution", "attribution");
    const model = page.getByRole("region", { name: "Model in use" });
    await expect(model).toBeVisible();
    const count = Number((await model.getByText(/^[\d,]+$/).first().innerText()).replace(/,/g, ""));
    // Past 200 labeled conversions the model is data-driven (the replays say so), and no "more … before" countdown.
    if (count >= 200) {
      await expect(model).toContainText("Data-driven (Markov removal effect)");
      await expect(model).not.toContainText("before the Markov removal-effect model takes over");
    } else {
      await expect(model).toContainText("Position-based 40/20/40");
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

  test("distribution: the Board counts as running only channels whose engine runs (audit GTM-01)", async ({ page }) => {
    await openTab(page, "distribution", "formation");
    // A channel on the board without its engine yet reads "starting", never "running".
    await expect(page.getByText(/^\d+ of 15 running( · \d+ starting)?$/)).toBeVisible({ timeout: LONG });
    await openTab(page, "distribution", "channels");
    const table = page.getByRole("grid", { name: "Channels" });
    const starting = table.getByRole("row").filter({ hasText: "Starting" });
    if ((await starting.count()) > 0) await expect(starting.first().getByTitle(/engine has not started yet/)).toBeVisible();
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
    await openTab(page, "legal", "policies");
    await expect(page.getByText(/private limited company, registration number \d+ \(United Kingdom\)/)).toBeVisible();
    // A UK company's policy cites the UK GDPR and is dated in words, never an ISO key.
    await expect(page.getByText(/UK General Data Protection Regulation \(UK GDPR\)/)).toBeVisible();
    await expect(page.getByText(/^Last updated [A-Z][a-z]+ \d{1,2}, \d{4}$/)).toBeVisible();
    await openTab(page, "legal", "incorporate");
    await expect(page.getByRole("radio", { name: /Document pack · Any other jurisdiction/ })).toBeVisible();
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
