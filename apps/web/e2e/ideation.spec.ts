import { expect, test, type Page } from "@playwright/test";
import { LONG, openStudio, signIn } from "./helpers";

/**
 * /new, /new/ideate, /new/compare — Door A (BUILD §11.1; AC-11.1.2, AC-11.1.3, AC-11.1.4). MODEL_MODE=mock returns
 * deterministic concept cards; the deck persists on the api (idea.list) across runs, so every test reads the loaded
 * deck before it counts. Stack and commands: e2e/README.md.
 */
const gridOf = (page: Page) => page.getByTestId("concept-grid");
const cardsOf = (page: Page) => gridOf(page).locator("[data-concept]");

/** Drafts a deck when fewer than `minimum` cards are loaded. The grid is already attached (openStudio). */
async function needCards(page: Page, minimum: number): Promise<void> {
  const cards = cardsOf(page);
  if ((await cards.count()) < minimum) {
    await page.getByTestId("generate-button").click();
    await expect(cards.nth(minimum - 1)).toBeVisible({ timeout: LONG });
  }
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
    await openStudio(page);
  });

  test("AC-11.1.2: an empty brief drafts 6–12 cards, each with ten attributes and at least two citations", async ({ page }) => {
    const cards = cardsOf(page);
    const before = await cards.count();
    const generate = page.getByTestId("generate-button");
    await expect(generate).toHaveText(/Surprise me within my constraints/);
    await generate.click();
    // The new cards sort to the top of the deck (newest version first) once idea.generate answers.
    await expect.poll(() => cards.count(), { timeout: LONG }).toBeGreaterThanOrEqual(before + 6);
    const added = (await cards.count()) - before;
    expect(added).toBeLessThanOrEqual(12);
    await expect(gridOf(page)).toHaveAttribute("data-count", String(before + added));
    const first = cards.first();
    await expect(first.getByRole("meter")).toHaveCount(10);
    const citations = first.getByText(/\d+ citations/);
    await expect(citations).toBeVisible();
    expect(Number((await citations.innerText()).match(/(\d+) citations/)?.[1])).toBeGreaterThanOrEqual(2);
    await first.getByRole("meter").first().hover();
  });

  test("AC-11.1.3: fork creates a new version, history is navigable, discard is reversible", async ({ page }) => {
    await needCards(page, 1);
    const grid = gridOf(page);
    const cards = cardsOf(page);
    const before = await cards.count();
    // A card still on its first version (the History button reads just "History"), so its history has exactly two
    // entries after the fork whatever earlier runs did to the rest of the deck.
    const wrapper = grid.locator(":scope > div").filter({ has: page.locator("[data-testid=history-button]", { hasText: /^History$/ }) }).first();
    await expect(wrapper, "the deck has a card on version 1 (AC-11.1.2 drafts fresh ones)").toBeVisible();
    const card = wrapper.locator("[data-concept]");
    const id = (await card.getAttribute("data-concept"))!;
    const name = await card.getByRole("heading", { level: 3 }).innerText();
    // The deck keeps forks from earlier runs (the mock drafts the same names), so the variant's name is unique per run.
    const variant = `${name} variant ${Date.now().toString(36)}`;

    await card.locator('[data-concept-action="fork"]').click();
    const fork = page.getByTestId("fork-dialog");
    await expect(fork).toBeVisible();
    await fork.getByLabel(/Name/).fill(variant);
    await fork.getByRole("button", { name: "Create fork" }).click();
    await expect(fork).toBeHidden({ timeout: LONG });
    await expect(cards).toHaveCount(before + 1, { timeout: LONG });
    await expect(grid.locator("[data-concept]", { has: page.getByRole("heading", { level: 3, name: variant, exact: true }) })).toHaveCount(1);

    // The source carries a "forked" version in its history.
    const source = page.locator(`#concept-${id}`);
    await expect(source.getByTestId("history-button")).toHaveText(/History · v2/);
    await source.getByTestId("history-button").click();
    const history = page.getByTestId("history-dialog");
    await expect(history).toBeVisible();
    await expect(history.locator("[data-version]")).toHaveCount(2);
    await expect(history.getByText("Forked")).toBeVisible();
    await history.getByRole("button", { name: "Older" }).click();
    await expect(history.locator('[data-version][aria-current="true"]')).toHaveAttribute("data-version", "1");
    await expect(history.getByTestId("lineage")).toContainText("Forked to");
    await history.getByRole("button", { name: "Close" }).click();
    await expect(history).toBeHidden();

    // Discard, then restore from the tray.
    const target = cards.last();
    const targetName = await target.getByRole("heading", { level: 3 }).innerText();
    await target.locator('[data-concept-action="discard"]').click();
    await expect(cards).toHaveCount(before);
    await page.getByTestId("tray-toggle").click();
    await expect(page.getByTestId("discard-tray")).toContainText(targetName);
    await page.getByTestId("restore-button").first().click();
    await expect(cards).toHaveCount(before + 1);
  });

  test("AC-11.1.4: selecting 2, 3 and 4 cards compares them with a radar and a verdict; a fifth tick is refused", async ({ page }) => {
    await needCards(page, 5);
    for (const n of [2, 3, 4]) {
      await openStudio(page);
      const cards = cardsOf(page);
      for (let i = 0; i < n; i++) await cards.nth(i).getByRole("button", { name: /^Compare / }).click();
      await expect(page.getByTestId("compare-bar")).toContainText(`${n} of 4 selected`);
      await page.getByTestId("compare-button").click();
      await expect(page).toHaveURL(/\/new\/compare\?ids=/);
      const result = page.getByTestId("compare-result");
      await expect(result).toBeVisible({ timeout: LONG });
      await expect(result).toHaveAttribute("data-count", String(n));
      await expect(result.locator("[data-compare-row]")).toHaveCount(10);
      await expect(result.getByRole("img", { name: /^Attribute radar/ })).toBeVisible();
      await expect(page.getByTestId("ranking").locator("[data-rank]")).toHaveCount(n);
      await expect(page.getByTestId("commit-leader")).toBeVisible();
    }
    await openStudio(page);
    const cards = cardsOf(page);
    for (let i = 0; i < 5; i++) await cards.nth(i).getByRole("button", { name: /^Compare / }).click();
    await expect(page.getByTestId("compare-bar")).toContainText("4 of 4 selected");
    await expect(cards.nth(4).getByRole("button", { name: /^Compare / })).toHaveAttribute("aria-pressed", "false");
  });
});
