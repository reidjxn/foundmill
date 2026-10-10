import { expect, test, type Page } from "@playwright/test";
import { LONG, openStudio, signIn } from "./helpers";

/**
 * /new, /new/ideate, /new/compare — Door A (BUILD §11.1; AC-11.1.2, AC-11.1.3, AC-11.1.4). MODEL_MODE=mock returns
 * deterministic concept cards; the deck persists on the api (idea.list) across runs, so every test reads the loaded
 * deck before it counts. Drafts stream (idea.draft over httpBatchStreamLink, audit P2): cards arrive one by one at the
 * top of the deck while the draft status says who is drafting. Stack and commands: e2e/README.md.
 */
const gridOf = (page: Page) => page.getByTestId("concept-grid");
const cardsOf = (page: Page) => gridOf(page).locator("[data-concept]");

/**
 * The deck is paged, newest first (idea.list, 48 a page): "Show older concepts" loads the next page. Counting tests load
 * every page first, so the deck the dev user has built up over many runs never caps what they count.
 */
async function loadWholeDeck(page: Page): Promise<void> {
  const more = page.getByTestId("deck-more");
  for (let i = 0; i < 50 && (await more.isVisible()); i++) {
    const loaded = await cardsOf(page).count();
    await more.click();
    await expect.poll(() => cardsOf(page).count(), { timeout: LONG }).toBeGreaterThan(loaded);
  }
  await expect(page.getByTestId("deck-count")).toHaveText(new RegExp(`^${await cardsOf(page).count()} concepts$`));
}

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

  test("the brief tells the truth about what the agents do", async ({ page }) => {
    // The hero only shows on an empty deck; its copy must never claim research grounding that does not run.
    await expect(page.getByTestId("prompt-box")).not.toContainText(/grounds each with competitors/);
  });

  test("AC-11.1.2: an empty brief drafts 6–12 cards, each with ten attributes and at least two citations", async ({ page }) => {
    const cards = cardsOf(page);
    const before = await cards.count();
    const generate = page.getByTestId("generate-button");
    // The generate control: the light slab at rest, its label saying what will happen.
    await expect(generate).toHaveAttribute("data-variant", "generate");
    await expect(generate).toContainText("Surprise me within my constraints");
    await generate.click();
    // The cards stream in at the top of the deck as each is saved; the status line names who drafted them.
    const status = page.getByTestId("draft-status");
    await expect(status).toBeVisible({ timeout: LONG });
    await expect(status).toHaveAttribute("data-status", "done", { timeout: LONG });
    await expect(page.getByTestId("draft-progress")).toHaveText(/^\d+ concepts drafted/);
    await expect(page.getByTestId("draft-elapsed")).toHaveText(/^\d+:\d\d$/);
    await expect(page.getByTestId("drafting-card")).toHaveCount(0);
    // The run panel reports the outcome in place; no toast lands over the cards.
    await expect(page.locator("[data-dugout-toasts] li")).toHaveCount(0);
    await expect.poll(() => cards.count(), { timeout: LONG }).toBeGreaterThanOrEqual(before + 6);
    const added = (await cards.count()) - before;
    expect(added).toBeLessThanOrEqual(12);
    expect(Number((await page.getByTestId("draft-progress").innerText()).match(/^(\d+)/)?.[1])).toBe(added);
    await expect(gridOf(page)).toHaveAttribute("data-count", String(before + added));
    const first = cards.first();
    await expect(first.getByRole("meter")).toHaveCount(10);
    const citations = first.getByText(/\d+ citations/);
    await expect(citations).toBeVisible();
    expect(Number((await citations.innerText()).match(/(\d+) citations/)?.[1])).toBeGreaterThanOrEqual(2);
    await first.getByRole("meter").first().hover();
  });

  test("⌘/Ctrl+Enter drafts from the brief", async ({ page }) => {
    const cards = cardsOf(page);
    const before = await cards.count();
    const brief = page.getByRole("textbox", { name: "Brief" });
    await brief.fill("bookkeeping for freelancers in the EU");
    await expect(page.getByTestId("generate-button")).toContainText("Draft concepts");
    await brief.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("draft-status")).toHaveAttribute("data-status", "done", { timeout: LONG });
    await expect.poll(() => cards.count(), { timeout: LONG }).toBeGreaterThanOrEqual(before + 6);
  });

  test("Stop ends a draft that is still running and says so", async ({ page }) => {
    // Hold the draft request so the draft is still running when Stop is pressed; nothing reaches the api.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/trpc/idea.draft**", async (route) => {
      await held;
      await route.abort().catch(() => undefined);
    });
    await page.getByTestId("generate-button").click();
    const status = page.getByTestId("draft-status");
    await expect(status).toHaveAttribute("data-status", "running");
    await expect(page.getByTestId("draft-progress")).toHaveText("Ideation agent is reading your brief");
    // Running: the dark slab with its label, the live run's step rail, and Stop beside the control.
    const generate = page.getByTestId("generate-button");
    await expect(generate).toHaveAttribute("data-running", "true");
    await expect(generate).toContainText("Drafting concepts");
    await expect(status.getByTestId("live-run-step").first()).toHaveAttribute("data-state", "current");
    const stop = page.locator("[data-generate-stop]");
    await expect(stop).toBeVisible();
    await expect(page.getByTestId("draft-elapsed")).toHaveText(/^0:0[1-9]$/, { timeout: 10_000 });
    await stop.click();
    await expect(status).toHaveAttribute("data-status", "stopped");
    await expect(page.getByTestId("draft-progress")).toHaveText("Stopped before any concept was finished");
    await expect(stop).toHaveCount(0);
    await expect(generate).not.toHaveAttribute("data-running", /.*/);
    await expect(generate).toBeEnabled();
    release();
  });

  test("cards stream in with the live run: steps, one segment per concept, and each card \"Just in\"; steering chips prefill the brief", async ({ page }) => {
    const cards = cardsOf(page);
    const before = await cards.count();
    await page.getByTestId("generate-button").click();
    const status = page.getByTestId("draft-status");
    await expect(status).toHaveAttribute("data-status", "done", { timeout: LONG });
    const steps = status.getByTestId("live-run-step");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(2)).toHaveAttribute("data-state", "done");
    await expect(status.getByTestId("live-run-bar")).toHaveAttribute("aria-label", /^(\d+) of \1 concepts landed$/);
    await expect(status.getByTestId("live-run-meter")).toContainText("Estimate");
    await expect.poll(() => cards.count(), { timeout: LONG }).toBeGreaterThanOrEqual(before + 6);
    await expect(gridOf(page).getByTestId("just-in").first()).toBeVisible();
    // Steer the next set: a chip adds its sentence to the brief once; nothing is drafted until Draft is pressed.
    const brief = page.getByRole("textbox", { name: "Brief" });
    await brief.fill("");
    await page.getByTestId("steering-chips").getByRole("button", { name: "B2B instead" }).click();
    await expect(brief).toHaveValue("Sell to businesses rather than consumers.");
    await page.getByTestId("steering-chips").getByRole("button", { name: "B2B instead" }).click();
    await expect(brief).toHaveValue("Sell to businesses rather than consumers.");
    await expect(page.getByTestId("generate-button")).toContainText("Draft concepts");
    await expect(status).toHaveAttribute("data-status", "done");
  });

  test("Ask on a concept: the Research agent's sheet, starters as buttons, quick replies after every answer, the version saved", async ({ page }) => {
    await needCards(page, 1);
    const card = cardsOf(page).first();
    await card.locator('[data-concept-action="ask"]').click();
    const sheet = page.getByTestId("ask-dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-variant", "sheet");
    await expect(sheet.getByTestId("desk-presence")).toContainText("Research agent");
    await expect(sheet.getByTestId("desk-presence")).toContainText("AI agent");
    const replies = sheet.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(replies.first()).toBeVisible({ timeout: LONG });
    expect(await replies.count()).toBeGreaterThanOrEqual(2);
    expect(await replies.count()).toBeLessThanOrEqual(4);
    const bubbles = sheet.getByTestId("agent-bubble");
    const before = await bubbles.count();
    await replies.filter({ hasText: "Who pays first?" }).click();
    await expect.poll(() => bubbles.count(), { timeout: LONG }).toBeGreaterThan(before);
    await expect(sheet.getByTestId("ask-version")).toContainText(/Saved as version \d+/);
    const next = sheet.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(next.first()).toBeVisible({ timeout: LONG });
    expect(await next.count()).toBeGreaterThanOrEqual(2);
    // The answer is shown once (the thread is the only place it appears).
    const answers = await bubbles.allInnerTexts();
    expect(new Set(answers).size).toBe(answers.length);
    // Typing is optional: Write, Enter sends, the field clears and closes.
    const count = await bubbles.count();
    await sheet.locator("[data-quick-reply=write]").click();
    const field = sheet.getByRole("textbox", { name: /^Reply to Research agent/ });
    await field.fill("How big is the market?");
    await field.press("Enter");
    await expect.poll(() => bubbles.count(), { timeout: LONG }).toBeGreaterThan(count);
    await expect(sheet.getByTestId("quick-reply-write")).toHaveCount(0);
    await expect(sheet.getByTestId("founder-bubble").last()).toHaveText(/How big is the market\?/);
  });

  test("AC-11.1.3: fork creates a new version, history is navigable, discard is reversible", async ({ page }) => {
    // Counting needs every page of the deck, and the shared dev deck grows with every run: allow for loading it all.
    test.slow();
    await needCards(page, 1);
    await loadWholeDeck(page);
    const grid = gridOf(page);
    const cards = cardsOf(page);
    const before = await cards.count();
    // A card still on its first version (the History button reads just "History"), so its history has exactly two
    // entries after the fork whatever earlier runs did to the rest of the deck.
    // The oldest such card (the deck lists newest first), so it is a drafted card and not a fork from an earlier run.
    const wrapper = grid.locator(":scope > div").filter({ has: page.locator("[data-testid=history-button]", { hasText: /^History$/ }) }).last();
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
    // The version row reads exactly "Forked"; the lineage line below it reads "Forked to <name>".
    await expect(history.getByText("Forked", { exact: true })).toBeVisible();
    await history.getByRole("button", { name: "Older" }).click();
    await expect(history.locator('[data-version][aria-current="true"]')).toHaveAttribute("data-version", "1");
    await expect(history.getByTestId("lineage")).toContainText("Forked to");
    // The dialog has two Close buttons (Dugout's corner icon and the footer's text button): the footer one is last.
    await history.getByRole("button", { name: "Close" }).last().click();
    await expect(history).toBeHidden();

    // Discard, then restore from the tray.
    const target = cards.last();
    const targetName = await target.getByRole("heading", { level: 3 }).innerText();
    // Discard sits in the card's "More actions" menu.
    await target.locator("[data-concept-more]").click();
    await page.locator('[role="menuitem"][data-concept-action="discard"]').click();
    await expect(cards).toHaveCount(before);
    // The outcome is said in the deck's header row with Undo beside it, not in a toast over the cards.
    await expect(page.getByTestId("studio-notice")).toContainText(`Discarded ${targetName}`);
    await expect(page.getByTestId("studio-notice-action")).toHaveText("Undo");
    await expect(page.locator("[data-dugout-toasts] li")).toHaveCount(0);
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
