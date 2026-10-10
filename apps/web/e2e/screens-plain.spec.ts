import { expect, test } from "@playwright/test";
import { LONG, openBusiness, signIn } from "./helpers";

/**
 * The 2027 screen pass, in plain words (CLAUDE.md vocabulary; DESIGN §10 empty states): no stored identifier, old
 * default word or developer note reaches the founder on the CRM record, the Network, a live business's Home or the
 * sign-in page, and an empty screen offers one way on, not one per panel. Read-only: nothing here saves anything.
 * Settings has its own file (settings-plain.spec.ts). Stack and commands: e2e/README.md.
 */
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";
/** A stored key on screen: snake_case words ("customers_won", "private_limited_company"). */
const SNAKE = /\b[a-z]+_[a-z_]+\b/;

test.describe("screens in plain words", () => {
  test("CRM: a record's facts are words, never a stored source or a bare dash", async ({ page }) => {
    await openBusiness(page, "crm");
    const grid = page.getByRole("grid", { name: "CRM records" });
    await expect(grid.getByRole("row").nth(1)).toBeVisible({ timeout: LONG });
    // One filter control: the search's "Filter"; the table hides its own (a saved view's filters still show there).
    await expect(page.getByTestId("crm-search").getByRole("button", { name: "Filter", exact: true })).toBeVisible();
    await expect(page.getByTestId("crm-table-panel").getByRole("button", { name: "Filter", exact: true })).toHaveCount(0);
    // The agents' own records (filed under "squad" before the rename) are the hardest case: open one when listed.
    const agentRow = grid.getByRole("row").filter({ has: page.locator('[data-col="kind"]', { hasText: /^Agent$/ }) }).first();
    const row = (await agentRow.count()) ? agentRow : grid.getByRole("row").nth(1);
    const href = await row.locator("a[href*='/crm/'][href$='/overview']").first().getAttribute("href");
    expect(href, "the seed gives Northwind CRM records").toBeTruthy();
    await page.goto(href!);
    const facts = page.getByTestId("key-facts");
    await expect(facts).toBeVisible({ timeout: LONG });
    await expect(facts).not.toContainText(/\bsquad\b/i);
    await expect(facts).not.toContainText(SNAKE);
    // An empty fact says "None" (or why it is not needed), never a lone dash.
    const values = await facts.locator("dd").allInnerTexts();
    expect(values.filter((v) => /^[—–-]$/.test(v.trim()))).toEqual([]);
    // The owner sits in the header facts once; the Standing panel does not repeat it.
    await expect(page.getByTestId("standing").getByText("Owner", { exact: true })).toHaveCount(0);
  });

  test("Network: an empty network offers one way on, not one per panel", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.goto("/network");
    await expect(page.getByTestId("network-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("connections-panel")).toBeVisible({ timeout: LONG });
    // Requests and Sent requests never carry their own "Browse communities"; Connections does when it is empty.
    await expect(page.getByTestId("requests-panel").getByRole("button", { name: "Browse communities" })).toHaveCount(0);
    await expect(page.getByTestId("sent-requests-panel").getByRole("button", { name: "Browse communities" })).toHaveCount(0);
    expect(await page.getByRole("button", { name: "Browse communities" }).count()).toBeLessThanOrEqual(1);
    // The connections count is said once, in the strip; the panel adds it only when there are some.
    await expect(page.getByTestId("connections-panel")).not.toContainText(/\b0 connections\b/);
  });

  test("a live business's Home: the leaderboard tile names its board in words; the runway matches the top bar", async ({ page }) => {
    await signIn(page);
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
    const strip = page.getByRole("region", { name: "Status" });
    await expect(strip.getByText("Leaderboard position", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(strip).not.toContainText(SNAKE, { timeout: LONG });
    // The bar's runway chip and the tile say the same words when there is no figure.
    const barWords = page.getByTestId("kit-bar").locator("[data-runway-words]");
    if (await barWords.count()) await expect(strip.getByText((await barWords.innerText()).trim(), { exact: true })).toBeVisible({ timeout: LONG });
    // Quiet department cards say so briefly; the instruction to press Continue is not repeated in every "Next up".
    await expect(page.locator("[data-department]").filter({ hasText: "Continue plans the next cycle" })).toHaveCount(0);
  });

  test("sign-in: the atmosphere frame, plain words, the desktop notice", async ({ page }) => {
    await page.goto("/login");
    const panel = page.getByTestId("brand-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("main")).not.toContainText(/switched off|seeded/);
    await expect(page.getByText(/Desktop only/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  });

  test("Milestones: kinds line up in one column and money is in the business's currency", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page, "milestones");
    const timeline = page.getByTestId("milestones-timeline");
    await expect(timeline.locator("[data-timeline] li").first()).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy]").filter({ hasText: "€" })).toHaveCount(0);
    // The kind pill sits in a fixed column, so every title starts at the same x: no ragged column, whatever the word.
    const lefts = await timeline.locator("[data-timeline] li").evaluateAll((items) =>
      items
        .map((li) => li.querySelector<HTMLElement>("span.w-28 + span")?.getBoundingClientRect().left)
        .filter((x): x is number => typeof x === "number")
        .map((x) => Math.round(x)),
    );
    expect(lefts.length, "the seed gives Northwind releases and decisions").toBeGreaterThan(1);
    expect(new Set(lefts).size, `title columns at ${[...new Set(lefts)].join(", ")}`).toBe(1);
  });
});
