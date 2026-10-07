import { expect, test, type Page } from "@playwright/test";

/**
 * /new, /new/ideate, /new/compare — Door A (BUILD §11.1; AC-11.1.2, AC-11.1.3, AC-11.1.4). Needs apps/api in mock
 * mode (MODEL_MODE=mock returns deterministic concept cards) with DEV_AUTH_USER_ID set, and a completed founder
 * profile for that user (run onboarding.spec.ts first or seed one). Not run in the build container: no browser.
 */
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  if (/\/onboarding/.test(page.url())) test.skip(true, "founder profile missing; run onboarding.spec.ts first");
}

test.describe("doors", () => {
  test("offers Door A and Door B", async ({ page }) => {
    await signIn(page);
    await page.goto("/new");
    await expect(page.getByTestId("doors")).toBeVisible();
    await expect(page.getByTestId("door-ideate")).toHaveAttribute("href", "/new/ideate");
    await expect(page.getByTestId("door-import")).toHaveAttribute("href", "/new/import");
    await page.getByTestId("door-ideate").click();
    await expect(page).toHaveURL(/\/new\/ideate$/);
  });
});

test.describe("ideation studio", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/new/ideate");
    await expect(page.getByTestId("prompt-box")).toBeVisible();
  });

  test("AC-11.1.2: an empty brief drafts 6–12 cards, each with ten attributes and at least two citations", async ({ page }) => {
    await page.getByTestId("generate-button").click();
    await expect(page.getByTestId("generate-button")).toHaveText(/Surprise me within my constraints/);
    const grid = page.getByTestId("concept-grid");
    await expect(grid.locator("[data-concept]").first()).toBeVisible({ timeout: 30_000 });
    const count = await grid.locator("[data-concept]").count();
    expect(count).toBeGreaterThanOrEqual(6);
    const first = grid.locator("[data-concept]").first();
    await expect(first.getByRole("meter")).toHaveCount(10);
    await expect(first.getByText(/\d+ citations/)).toBeVisible();
    const citations = Number((await first.getByText(/\d+ citations/).innerText()).match(/(\d+) citations/)?.[1]);
    expect(citations).toBeGreaterThanOrEqual(2);
    await first.getByRole("meter").first().hover();
  });

  test("AC-11.1.3: fork creates a new version, history is navigable, discard is reversible", async ({ page }) => {
    const grid = page.getByTestId("concept-grid");
    if ((await grid.locator("[data-concept]").count()) === 0) {
      await page.getByTestId("generate-button").click();
      await expect(grid.locator("[data-concept]").first()).toBeVisible({ timeout: 30_000 });
    }
    const before = await grid.locator("[data-concept]").count();
    const card = grid.locator("[data-concept]").first();
    const name = await card.getByRole("heading", { level: 3 }).innerText();

    await card.locator('[data-concept-action="fork"]').click();
    const fork = page.getByTestId("fork-dialog");
    await expect(fork).toBeVisible();
    await fork.getByLabel(/Name/).fill(`${name} variant`);
    await fork.getByRole("button", { name: "Create fork" }).click();
    await expect(fork).toBeHidden();
    await expect(grid.locator("[data-concept]")).toHaveCount(before + 1);

    // The source carries a "forked" version in its history.
    const source = grid.locator("[data-concept]", { has: page.getByRole("heading", { level: 3, name, exact: true }) }).first();
    await source.locator("xpath=..").getByTestId("history-button").click();
    const history = page.getByTestId("history-dialog");
    await expect(history).toBeVisible();
    await expect(history.locator("[data-version]")).toHaveCount(2);
    await expect(history.getByText("Forked")).toBeVisible();
    await history.getByRole("button", { name: "Older" }).click();
    await expect(history.locator('[data-version][aria-current="true"]')).toHaveAttribute("data-version", "1");
    await expect(history.getByTestId("lineage")).toContainText("Forked to");
    await history.getByRole("button", { name: "Close" }).click();

    // Discard, then restore from the tray.
    const target = grid.locator("[data-concept]").last();
    const targetName = await target.getByRole("heading", { level: 3 }).innerText();
    await target.locator('[data-concept-action="discard"]').click();
    await expect(grid.locator("[data-concept]")).toHaveCount(before);
    await page.getByTestId("tray-toggle").click();
    await expect(page.getByTestId("discard-tray")).toContainText(targetName);
    await page.getByTestId("restore-button").first().click();
    await expect(grid.locator("[data-concept]")).toHaveCount(before + 1);
  });

  test("AC-11.1.4: selecting 2, 3 and 4 cards compares them with a radar and a verdict", async ({ page }) => {
    const grid = page.getByTestId("concept-grid");
    if ((await grid.locator("[data-concept]").count()) < 4) {
      await page.getByTestId("generate-button").click();
      await expect(grid.locator("[data-concept]").nth(3)).toBeVisible({ timeout: 30_000 });
    }
    for (const n of [2, 3, 4]) {
      await page.goto("/new/ideate");
      const cards = page.getByTestId("concept-grid").locator("[data-concept]");
      for (let i = 0; i < n; i++) await cards.nth(i).getByRole("button", { name: /^Compare / }).click();
      await expect(page.getByTestId("compare-bar")).toContainText(`${n} of 4 selected`);
      await page.getByTestId("compare-button").click();
      await expect(page).toHaveURL(/\/new\/compare\?ids=/);
      const result = page.getByTestId("compare-result");
      await expect(result).toBeVisible({ timeout: 30_000 });
      await expect(result).toHaveAttribute("data-count", String(n));
      await expect(result.locator("[data-compare-row]")).toHaveCount(10);
      await expect(result.getByRole("img", { name: /radar/i }).or(result.locator("svg").first())).toBeVisible();
      await expect(page.getByTestId("ranking").locator("[data-rank]")).toHaveCount(n);
      await expect(page.getByTestId("commit-leader")).toBeVisible();
    }
    // A fifth tick is refused.
    await page.goto("/new/ideate");
    const cards = page.getByTestId("concept-grid").locator("[data-concept]");
    for (let i = 0; i < 5; i++) await cards.nth(i).getByRole("button", { name: /^Compare / }).click();
    await expect(page.getByTestId("compare-bar")).toContainText("4 of 4 selected");
  });
});
