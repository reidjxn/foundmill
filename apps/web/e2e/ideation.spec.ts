import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { LONG, devApi, openStudio, signIn } from "./helpers";

/**
 * /new, /new/ideate, /new/compare — Door A (BUILD §11.1; AC-11.1.2, AC-11.1.3, AC-11.1.4). MODEL_MODE=mock returns
 * deterministic concept cards; the deck persists on the api (idea.list) across runs, so every test reads the loaded
 * deck before it counts. Drafts stream (idea.draft over httpBatchStreamLink, audit P2): cards arrive one by one at the
 * top of the deck while the draft status says who is drafting. Stack and commands: e2e/README.md.
 */
const gridOf = (page: Page) => page.getByTestId("concept-grid");
const cardsOf = (page: Page) => gridOf(page).locator("[data-concept]");

/** The dev founder's guidance switch (Settings › Preferences): explainers and term underlines render only while it is on; key caps only while it is off. */
async function guidanceOn(playwright: PlaywrightWorkerArgs["playwright"]): Promise<boolean> {
  const api = await devApi(playwright);
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { guidance: "on" | "off" } } } };
  await api.dispose();
  return body.result.data.json.guidance === "on";
}

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
  test("offers Door A and Door B, and recommends Door A to a first-time founder with the page (§7.4)", async ({ page, playwright }) => {
    await signIn(page);
    await page.goto("/new");
    await expect(page.getByTestId("doors")).toBeVisible();
    await expect(page.getByTestId("door-ideate")).toHaveAttribute("href", "/new/ideate");
    await expect(page.getByTestId("door-import")).toHaveAttribute("href", "/new/import");
    // The experience travels with the page (apps/web/app/new/page.tsx): the tag is in the server's HTML or not at all.
    const api = await devApi(playwright);
    const res = await api.get("/trpc/founder.profile.get");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { result: { data: { json: { profile: { experience: string | null } | null } } } };
    await api.dispose();
    const firstTime = body.result.data.json.profile?.experience === "first_time";
    await expect(page.locator('[data-door="ideate"][data-recommended]')).toHaveCount(firstTime ? 1 : 0);
    await expect(page.getByTestId("door-recommended")).toHaveCount(firstTime ? 1 : 0);
    await page.getByTestId("door-ideate").click();
    await expect(page).toHaveURL(/\/new\/ideate$/);
  });
});

test.describe("ideation studio", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openStudio(page);
  });

  test("the brief tells the truth about what the agents do", async ({ page, playwright }) => {
    // The hero only shows on an empty deck; its copy must never claim research grounding that does not run.
    await expect(page.getByTestId("prompt-box")).not.toContainText(/grounds each with competitors/);
    // The kind-of-business select reads as a question, not as "archetype" (A7); the word beside it is the defined term.
    await expect(page.getByRole("combobox", { name: "Kind of business" })).toBeVisible();
    const label = page.getByTestId("archetype-hint-label");
    await expect(label).toHaveText("Kind of business");
    await expect(label.locator('[data-term="archetype"]')).toBeVisible();
    // Key caps are an operator's affordance (UX plan §5.9): the generate control's ⌘↵ shows only while guidance is off.
    const guided = await guidanceOn(playwright);
    await expect(page.getByTestId("generate-button").locator("kbd")).toHaveCount(guided ? 0 : 1);
    // Example briefs show only while the deck is empty (A7) and guidance is on: an ExampleToggle group (UX plan §6.2).
    const empty = (await page.getByTestId("concept-grid").locator("[data-concept]").count()) === 0;
    await expect(page.getByTestId("example-briefs")).toHaveCount(empty && guided ? 1 : 0);
    if (empty && guided) {
      const briefs = page.getByTestId("example-briefs");
      await expect(briefs.getByRole("group", { name: "Try an example brief" })).toBeVisible();
      const chip = briefs.getByRole("button", { name: "A subscription for refillable skincare" });
      const brief = page.getByRole("textbox", { name: "Brief" });
      const generate = page.getByTestId("generate-button");
      await chip.click();
      await expect(brief).toHaveValue("A subscription for refillable skincare");
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      // The brief wears the Example chip in a dashed frame, the control says it drafts from the example, and nothing is drafted by itself.
      await expect(page.getByTestId("brief-example").getByText("Example", { exact: true })).toBeVisible();
      await expect(generate).toContainText("Draft 6–12 ideas from this example");
      await expect(page.getByTestId("draft-status")).toHaveCount(0);
      // An edit, however small, makes the brief the founder's.
      await brief.fill("A subscription for refillable skincare, for gyms");
      await expect(page.getByTestId("brief-example")).toHaveCount(0);
      await expect(chip).toHaveAttribute("aria-pressed", "false");
      await expect(generate).toContainText("Draft concepts");
      // The chosen chip again clears what it filled.
      await chip.click();
      await expect(brief).toHaveValue("A subscription for refillable skincare");
      await chip.click();
      await expect(brief).toHaveValue("");
      await expect(page.getByTestId("brief-example")).toHaveCount(0);
      await expect(generate).toContainText("Draft 6–12 ideas for me");
      await expect(page.getByTestId("draft-status")).toHaveCount(0);
    }
  });

  test("the deck explains itself: the 'How to read a card' Explainer collapses on Got it and stays so per account; 'Pick 2–4 cards to compare them'", async ({ page, playwright }) => {
    await needCards(page, 1);
    const guided = await guidanceOn(playwright);
    const explainer = page.locator('[data-explainer="ideate-cards"]');
    const kbdTip = page.getByTestId("compare-kbd-tip");
    if (guided) {
      // The Explainer (UX plan §6.2): three labels and Got it while open; one line with a chevron once seen, and the
      // account remembers it (explainers_seen), so a reload keeps it collapsed.
      await expect(explainer).toBeVisible();
      await expect(explainer).toHaveAttribute("data-testid", "how-to-read-card");
      if ((await explainer.getAttribute("data-state")) === "open") {
        await expect(explainer).toContainText("What this screen is for");
        await expect(explainer).toContainText("Every bar runs 1–20 and higher is always the better side");
        await explainer.getByRole("button", { name: "Got it" }).click();
      }
      await expect(explainer).toHaveAttribute("data-state", "collapsed");
      await expect(explainer.getByRole("button", { name: "Show more about this screen" })).toBeVisible();
      await page.reload();
      await openStudio(page);
      await expect(explainer).toHaveAttribute("data-state", "collapsed", { timeout: LONG });
      // Key caps are for operators: the shortcuts tip is not there while guidance is on.
      await expect(kbdTip).toHaveCount(0);
    } else {
      await expect(explainer).toHaveCount(0);
      await expect(kbdTip.getByRole("button", { name: "About Keyboard shortcuts for comparing" })).toBeVisible();
    }
    await expect(page.getByTestId("compare-hint")).toContainText("Pick 2–4 cards to compare them");
    await expect(page.getByTestId("compare-hint")).not.toContainText("Tick");
  });

  test("AC-11.1.2: an empty brief drafts 6–12 cards, each with ten attributes and at least two citations", async ({ page }) => {
    const cards = cardsOf(page);
    const before = await cards.count();
    const generate = page.getByTestId("generate-button");
    // The generate control: the light slab at rest, its label saying what will happen.
    await expect(generate).toHaveAttribute("data-variant", "generate");
    await expect(generate).toContainText("Draft 6–12 ideas for me");
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
    // "More like this" drafts a variant; the founder never reads "fork" (A14).
    await expect(fork.getByRole("heading")).toContainText(/Draft a variant of/);
    await fork.getByLabel(/Name/).fill(variant);
    await fork.getByRole("button", { name: "Draft it" }).click();
    await expect(fork).toBeHidden({ timeout: LONG });
    await expect(cards).toHaveCount(before + 1, { timeout: LONG });
    await expect(grid.locator("[data-concept]", { has: page.getByRole("heading", { level: 3, name: variant, exact: true }) })).toHaveCount(1);

    // The source carries a "forked" version in its history; versions read in words.
    const source = page.locator(`#concept-${id}`);
    await expect(source.getByTestId("history-button")).toHaveText(/History · version 2/);
    await source.getByTestId("history-button").click();
    const history = page.getByTestId("history-dialog");
    await expect(history).toBeVisible();
    await expect(history.locator("[data-version]")).toHaveCount(2);
    await expect(history.locator("[data-version='2']")).toContainText("Version 2");
    // The version row reads exactly "Variant made" (never "Forked", the copy rule); the lineage line below it reads "Variant: <name>".
    await expect(history.getByText("Variant made", { exact: true })).toBeVisible();
    await history.getByRole("button", { name: "Older" }).click();
    await expect(history.locator('[data-version][aria-current="true"]')).toHaveAttribute("data-version", "1");
    await expect(history.getByTestId("lineage")).toContainText("Variant:");
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
    // Restore is real (idea.restore, audit FR-12): after a reload the card is still in the deck, and Commit opens its form
    // instead of an error panel that names a raw id.
    await page.reload();
    const restored = cards.filter({ hasText: targetName }).first();
    await expect(restored).toBeVisible({ timeout: LONG });
    await restored.locator("xpath=..").getByTestId("commit-link").click();
    await expect(page).toHaveURL(/\/new\/commit\//);
    await expect(page.getByLabel(/Business name/)).toBeVisible({ timeout: LONG });
    await expect(page.getByText(/not found/i)).toHaveCount(0);
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

test.describe("the founder's own words (first-time founder report, Nov 8, 2026)", () => {
  const WORDS = "Students at my university struggle to find short-notice part-time shifts, and local cafes and bars near campus struggle to fill last-minute gaps. A simple app that matches verified students to same-day shifts at independent venues around Manchester.";

  test("Use my idea as written: one card in the founder's words, rated, straight to Commit, where the card says whose words they are", async ({ page }) => {
    await signIn(page);
    await openStudio(page);
    const brief = page.getByRole("textbox", { name: "Brief" });
    // Nothing to use while the brief is empty; the button appears with the founder's words.
    await expect(page.getByTestId("use-my-idea")).toHaveCount(0);
    await brief.fill(WORDS);
    await page.getByTestId("use-my-idea").click();
    const dialog = page.getByTestId("write-dialog");
    await expect(dialog).toBeVisible();
    // The words are the pitch, untouched; the working name is suggested from them and can be changed.
    await expect(dialog.getByTestId("write-pitch")).toHaveValue(WORDS);
    await expect(dialog.getByTestId("write-title")).not.toHaveValue("");
    await dialog.getByTestId("write-title").fill("ShiftMate");
    await dialog.getByTestId("write-submit").click();
    await page.waitForURL(/\/new\/commit\/[0-9a-f-]+/, { timeout: LONG });
    await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
    // The card on Commit carries the founder's words and says so; the note under it says the team builds from them.
    const card = page.locator("[data-concept]").first();
    await expect(card).toContainText(WORDS);
    await expect(card.locator("[data-concept-your-words]")).toBeVisible();
    await expect(page.getByTestId("commit-words-note")).toContainText("The pitch is in your words");
    // The business name follows the working name.
    await expect(page.getByLabel(/Business name/)).toHaveValue("ShiftMate");
  });

  test("Edit on any card: the pitch changed in the founder's words becomes a new version that reads 'Your words'", async ({ page }) => {
    await signIn(page);
    await openStudio(page);
    await needCards(page, 1);
    const card = cardsOf(page).first();
    const name = (await card.getAttribute("aria-label"))!.replace(/: concept card$/, "");
    await card.getByRole("button", { name: `More actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.getByTestId("edit-dialog");
    await expect(dialog).toBeVisible();
    // Nothing changed yet: nothing to save.
    await expect(dialog.getByTestId("edit-submit")).toBeDisabled();
    const words = `Cafes near campus fill last-minute shifts with verified students (${Date.now().toString(36)}).`;
    await dialog.getByTestId("edit-pitch").fill(words);
    await dialog.getByTestId("edit-submit").click();
    await expect(dialog).toHaveCount(0, { timeout: LONG });
    await expect(page.getByTestId("studio-notice")).toContainText(/Your words lead the card now/, { timeout: LONG });
    const edited = gridOf(page).locator("[data-concept]").filter({ hasText: words }).first();
    await expect(edited).toBeVisible({ timeout: LONG });
    await expect(edited.locator("[data-concept-your-words]")).toBeVisible();
    await expect(edited.getByText(/^Version \d+$/)).toBeVisible();
  });
});
