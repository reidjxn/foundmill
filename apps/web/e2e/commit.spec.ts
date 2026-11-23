import { expect, test, type Page } from "@playwright/test";
import { FIRST_NOTE, LONG, foundationsStatus, UUID, devApi, ensureDeck, inboxRow, logoPng, openSettings, signIn } from "./helpers";

/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7; WP-04 T2 "name and go"). The test
 * drafts a card in the studio first when the deck is empty. Stack and commands: e2e/README.md.
 */

/**
 * Opens "More options" (WP-04 T2): the name checks, the logo, How it runs with its five controls (Personal or live,
 * Archetype, Business mode, Spend cap, Autopilot) and the team wait behind it, closed for everyone.
 */
async function openMore(page: Page): Promise<void> {
  const more = page.getByTestId("commit-more");
  await expect(more).toBeVisible({ timeout: LONG });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("business-mode-panel")).toBeVisible();
}

/** The default view, at any width: the name prefilled, what happens next, one button, More options closed. */
async function expectNameAndGo(page: Page): Promise<void> {
  const form = page.getByTestId("commit-form");
  await expect(form).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
  await expect(page.getByLabel(/Business name/)).not.toHaveValue("");
  await expect(form.locator("input:not([type=hidden]), textarea, select")).toHaveCount(1);
  // One first-day story (WP-04 T7): the page first.
  await expect(page.getByTestId("what-happens-next")).toContainText("Your page is drafted first, from your own words. About a minute.");
  await expect(page.getByTestId("commit-credits-line").or(page.getByTestId("commit-credits-notice"))).toBeVisible();
  // The starting team in one line (WP-04 T4).
  await expect(page.getByTestId("starting-team-line")).toHaveText(/^Your starting team: Chief of Staff, Product Lead and Researcher\. \d+ more join as the work needs them\.$/, { timeout: LONG });
  await expect(form.getByRole("button", { name: "Start my project" })).toHaveCount(1);
  await expect(page.getByTestId("commit-more")).toHaveAttribute("aria-expanded", "false");
  for (const id of ["name-checks-panel", "logo-panel", "how-it-runs", "squad-preview"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(form).not.toContainText(/domain|trademark|spend cap|wage/i);
  // The page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe("commit: name and go at any width (WP-04 T2)", () => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    test(`at ${size.width} px: one field and one button; one press reaches Today`, async ({ page }) => {
      await signIn(page);
      await ensureDeck(page, 1);
      // The deck is a desktop page: open the card's Commit from there, then use it at this width.
      const href = await page.getByTestId("commit-link").first().getAttribute("href");
      expect(href).toMatch(/\/new\/commit\/[0-9a-f-]+/);
      await page.setViewportSize(size);
      const domainChecks: string[] = [];
      page.on("request", (req) => {
        if (req.url().includes("idea.domainCheck")) domainChecks.push(req.url());
      });
      await page.goto(href!);
      await expectNameAndGo(page);
      // No registry lookup for a founder who never opens More options.
      expect(domainChecks).toHaveLength(0);
      await page.getByLabel(/Business name/).fill(`Name and go ${size.width} ${Date.now().toString(36)}`);
      await page.getByTestId("take-charge").click();
      await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
      await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    });
  }
});

test.describe("commit", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  });

  test("More options holds the name checks, the logo, How it runs over its five controls, and the team (A3, §7.6)", async ({ page }) => {
    await expect(page.getByTestId("name-panel")).toBeVisible();
    await expect(page.getByTestId("logo-panel")).toHaveCount(0);
    await openMore(page);
    await expect(page.getByTestId("logo-panel")).toBeVisible();
    await expect(page.getByTestId("name-checks-panel")).toBeVisible();
    const summary = page.getByTestId("how-it-runs-summary");
    await expect(summary.locator("[data-summary]")).toHaveCount(5);
    await expect(summary.locator('[data-summary="game-mode"]')).toHaveText("Personal");
    await expect(summary.locator('[data-summary="business-mode"]')).toHaveText("Assisted");
    // The careful defaults (WP-14 T11; founder, 2026-11-22): a cap of 0, so every spend asks, and Autopilot off.
    await expect(summary.locator('[data-summary="spend-cap"]')).toHaveText("Asks you before any spend");
    await expect(summary.locator('[data-summary="autopilot"]')).toHaveText("Autopilot off");
    // Labeled lines, not bare chips (first-time founder report, Nov 8, 2026): each choice says what it is about.
    for (const label of ["Where it runs", "Who decides", "Kind of business", "On a schedule"]) await expect(summary).toContainText(label);
    // The team the archetype seeds, no background helper listed; the wage line is Builder view's only (WP-04 T2).
    const squad = page.getByTestId("squad-preview");
    await expect(page.getByTestId("squad-preview-counts")).toHaveText(/^\d+ agents? · \d+ departments? · \d+ channels? on/, { timeout: LONG });
    await expect(squad.getByRole("list", { name: "Team" }).getByText(/Source watcher|Secrets scanner|Utility/)).toHaveCount(0);
    // Three are shown; everyone else behind See everyone (WP-04 T4).
    await expect(squad.getByRole("list", { name: "Team" }).getByRole("listitem")).toHaveCount(3);
    await squad.getByRole("button", { name: "See everyone" }).click();
    await expect.poll(() => squad.getByRole("list", { name: "Team" }).getByRole("listitem").count()).toBeGreaterThan(3);
    await expect(page.getByRole("radiogroup", { name: "Personal or live" })).toBeVisible();
    await expect(page.getByTestId("archetype-panel")).toBeVisible();
    await expect(page.getByLabel(/Spend cap per action/)).toBeVisible();
    await expect(page.getByTestId("run-on-autopilot")).toBeVisible();
    // The defined words in the summary open their definition while guidance is on (a dotted Term).
    await expect(summary.locator('[data-summary="archetype"] [data-term="archetype"]')).toBeVisible();
    // Closing More options hides them again; the bottom button goes with it.
    await page.getByTestId("commit-more").click();
    await expect(page.getByTestId("commit-more")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("archetype-panel")).toHaveCount(0);
    await expect(page.getByTestId("take-charge-bottom")).toHaveCount(0);
  });

  test("AC-11.1.7: Assisted is the default business mode; Personal the default game mode", async ({ page }) => {
    await openMore(page);
    await expect(page.getByTestId("commit-form")).toHaveAttribute("data-business-mode", "assisted");
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-option="personal"]')).toHaveAttribute("data-selected", "true");
    // The choice is named in plain words ("Personal or live"), not the internal "game mode".
    await expect(page.getByRole("radiogroup", { name: "Personal or live" })).toBeVisible();
    await expect(page.getByLabel(/Spend cap per action/)).toHaveValue("0");
    // A LIVE start asks for the 18+ confirmation only until it is on record: a founder who has given it is not asked
    // again (the seed with a profile), one who has not is asked.
    await page.locator('[data-option="live"] button[role="radio"]').click();
    await expect(page.locator('[data-option="live"]')).toHaveAttribute("data-selected", "true");
    const adult = page.getByTestId("commit-adult");
    await expect(adult).toHaveCount(await adult.count());
    if (await adult.count()) await expect(adult).toBeVisible();
  });

  test("WP-14 T11: Commit opens on the careful option, says so, and a founder can change it there", async ({ page }) => {
    // Above the form, and no dollar figure in the credits line.
    await expect(page.getByText("Name your project. We've set everything else to the careful option, and you can change any of it later.")).toBeVisible();
    const credits = page.getByTestId("commit-credits-line");
    if (await credits.count()) await expect(credits).toHaveText("Your team starts with this month's included credits.");
    await openMore(page);
    // Each default: Assisted, Personal, a cap of 0, the overnight shift off, the initials mark (no logo chosen).
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-option="personal"]')).toHaveAttribute("data-selected", "true");
    const cap = page.getByLabel(/Spend cap per action/);
    await expect(cap).toHaveValue("0");
    const toggle = page.getByTestId("run-on-autopilot");
    const chip = page.getByTestId("how-it-runs-summary").locator('[data-summary="autopilot"]');
    await expect(page.getByTestId("autopilot-choice")).toContainText("Overnight shift");
    await expect(page.getByTestId("autopilot-choice")).toContainText("Off unless you turn it on.");
    await expect(page.getByTestId("autopilot-choice")).toContainText("about 2 AM your time");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(chip).toHaveText("Autopilot off");
    // Change two of them: the overnight shift on, and the cap.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(chip).toHaveText("Overnight shift on");
    await cap.fill("40");
    await expect(page.getByTestId("how-it-runs-summary").locator('[data-summary="spend-cap"]')).toHaveText(/^Asks you above \D{1,3}40\.00$/);
    // And back: off again is one press.
    await toggle.click();
    await expect(chip).toHaveText("Autopilot off");
  });

  test("name suggestions, live domain availability and the trademark screen with its caveat", async ({ page }) => {
    await openMore(page);
    await expect(page.getByTestId("domain-checks").locator("[data-domain]")).toHaveCount(5);
    await expect(page.getByTestId("trademark-screen").locator("[data-registry]")).toHaveCount(2);
    await expect(page.getByTestId("trademark-caveat")).toContainText("Screen, not legal clearance");
    // The screen is a heuristic over a list of well-known marks, and says so: an Estimate chip beside its label.
    await expect(page.getByTestId("trademark-provenance")).toContainText("Estimate");
    await page.getByLabel(/Business name/).fill("Stripe Ledger");
    await expect(page.locator('[data-registry="USPTO"]')).toHaveAttribute("data-status", "conflict");
    await expect(page.locator('[data-domain="stripeledger.com"]')).toBeVisible();
    await page.locator("[data-suggestion]").first().click();
    await expect(page.getByLabel(/Business name/)).not.toHaveValue("Stripe Ledger");
  });

  test("domain availability comes from the checker, says where each answer came from, and never invents a status (#458)", async ({ page }) => {
    await openMore(page);
    const domains = page.getByTestId("domain-checks");
    const name = page.getByLabel(/Business name/);
    // This stack runs mock mode: a fixed list of well-known names is taken, everything else is free, and the chip says Mock.
    await name.fill("Northwind");
    await expect(domains.locator('[data-domain="northwind.com"]')).toHaveAttribute("data-status", "taken", { timeout: LONG });
    await expect(domains.locator('[data-domain="northwind.com"]')).toHaveAttribute("data-provenance", "Mock");
    await expect(page.getByTestId("domain-provenance")).toHaveText("Mock");
    await name.fill("Quillfeather Works");
    await expect(domains.locator('[data-domain="quillfeatherworks.com"]')).toHaveAttribute("data-status", "available", { timeout: LONG });
    // A real registry answer is never dressed as an Estimate, and there is no premium status.
    await expect(domains).not.toContainText("Premium");
    await expect(page.getByTestId("domain-checked")).toContainText(/Checked \d{1,2}:\d{2} [AP]M/);
    await expect(page.getByTestId("domain-note")).toContainText("Availability is a snapshot; registering the domain happens at a registrar. We never buy domains for you.");
    // A name the checker cannot answer reads "Couldn't check" with a Retry, and committing stays possible.
    await name.fill("unknown-brand");
    const row = domains.locator('[data-domain="unknownbrand.com"]');
    await expect(row).toHaveAttribute("data-status", "unknown", { timeout: LONG });
    await expect(row).toContainText("Couldn't check");
    await expect(row.getByTestId("domain-retry")).toBeVisible();
    await expect(page.getByTestId("take-charge")).toBeEnabled();
    // The trademark screen is labeled as an estimate, not clearance, inside the one name-checks panel, acronyms expanded (A12).
    await expect(page.getByTestId("name-checks-panel")).toContainText("Check the name (domains and trademarks)");
    await expect(page.getByTestId("trademark-screen")).toContainText("USPTO, the US trademark office");
    await expect(page.getByTestId("trademark-caveat")).toContainText("Screen, not legal clearance");
  });

  test("says what happens next in the real order, with an example per mode and a change-it-later line (A4, §7.6)", async ({ page }) => {
    const next = page.getByTestId("what-happens-next");
    // The shared first-day lines (WP-04 T7), in order: the page, checking it, the plan, nothing without you.
    await expect(next.getByRole("listitem")).toHaveText([/^1\s*Your page is drafted first/, /^2\s*You check it and publish it/, /^3\s*Your plan arrives as one note to approve/, /^4\s*Nothing costs money or goes out in your name/]);
    await expect(next).not.toContainText(/specification|roadmap|two notes|sign them off/);
    await expect(next).not.toContainText("Board");
    await openMore(page);
    await expect(page.locator("[data-mode-example]")).toHaveCount(3);
    await expect(page.locator('[data-option="assisted"]')).toContainText("Example: drafts the pricing page and publishes it; asks before paying for a domain.");
    // The change-it-later lines are tutoring: there while guidance is on (Settings › Preferences), gone when it is off.
    const reassure = page.getByTestId("reassure-mode");
    if (await reassure.count()) {
      await expect(reassure).toContainText("You can change this later in Settings › What the team can do.");
      await expect(page.getByTestId("reassure-how-it-runs")).toContainText("Settings › Business and Settings › What the team can do");
    } else {
      await expect(page.getByTestId("reassure-how-it-runs")).toHaveCount(0);
    }
  });

  test("logo: the initials mark until one is chosen; generate four marks and pick one; the contrast check reads the primary", async ({ page }) => {
    await openMore(page);
    const preview = page.getByTestId("logo-preview").locator("[data-logo]");
    await expect(preview).toHaveAttribute("data-logo", "initials");
    // The fallback is a rounded square with letters, never a shield path.
    await expect(preview.locator("path")).toHaveCount(0);
    await page.getByTestId("logo-generate").click();
    const options = page.getByTestId("logo-option");
    await expect(options).toHaveCount(4, { timeout: LONG });
    for (let i = 0; i < 4; i++) await expect(options.nth(i).locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    await expect(page.getByTestId("logo-cost")).toContainText("US$");
    await expect(page.getByTestId("logo-options")).toContainText("Estimate");
    const picked = await options.nth(1).locator("img").getAttribute("src");
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(preview).toHaveAttribute("data-logo", "image");
    await expect(preview.locator("img")).toHaveAttribute("src", picked!);
    // The concept card under the logo shows the chosen logo too.
    await expect(page.locator("article[data-concept] img").first()).toHaveAttribute("src", picked!);
    // Generate again gives a different set.
    await page.getByTestId("logo-regenerate").click();
    await expect.poll(async () => options.nth(0).locator("img").getAttribute("src"), { timeout: LONG }).not.toBe(picked);
    await page.getByTestId("kit-primary-hex").fill("#ffff00");
    await expect(page.getByTestId("kit-contrast")).toContainText(/near-black/);
    await page.getByTestId("kit-primary-hex").fill("#1b4fd8");
    await expect(page.getByTestId("kit-contrast")).toHaveAttribute("data-passes", "true");
  });

  test("logo: upload a PNG, which the browser resizes and the server checks; brand colors are suggested from it", async ({ page }) => {
    await openMore(page);
    const preview = page.getByTestId("logo-preview").locator("[data-logo]");
    await page.getByTestId("logo-file").setInputFiles({ name: "acme.png", mimeType: "image/png", buffer: logoPng() });
    await expect(preview).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(preview.locator("img")).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
    await expect(page.getByTestId("logo-picker")).toHaveAttribute("data-logo-source", "upload");
    const suggestion = page.getByTestId("logo-colour-suggestion");
    await expect(suggestion).toBeVisible({ timeout: LONG });
    const suggested = await suggestion.locator("[data-colour]").first().getAttribute("data-colour");
    await page.getByTestId("logo-use-colours").click();
    await expect(page.getByTestId("kit-primary-hex")).toHaveValue(suggested!);
    // A file the server refuses says why and keeps the current logo.
    await page.getByTestId("logo-file").setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await expect(page.getByTestId("logo-error")).toBeVisible({ timeout: LONG });
    await expect(preview).toHaveAttribute("data-logo", "image");
  });

  test("AC-11.1.6: Start my project creates the business and lands on Today, where the foundations draft; the Inbox has the welcome note, nothing blocks Continue", async ({ page, playwright }) => {
    const name = `Playwright Business ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    await openMore(page);
    await page.getByLabel(/Business mode/).getByLabel(/Assisted/).check();
    // The chosen logo travels with the commit and lands on the top bar.
    await page.getByTestId("logo-generate").click();
    await expect(page.getByTestId("logo-option")).toHaveCount(4, { timeout: LONG });
    await page.getByTestId("logo-option").first().click();
    await page.getByTestId("take-charge").click();
    // The first days are about the product (founder, 2026-10-18): Take charge lands on Today (the front door since
    // Nov 7, 2026), not on a Board decision.
    await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kit-bar")).toContainText(name);
    await expect(page.getByTestId("kitbar-logo")).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(page.getByTestId("kitbar-logo").locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    // The sidebar carries the areas over the departments the commit created (each links to a department tab).
    expect(await page.locator("[data-testid=app-shell] nav a[href*='/d/']").count()).toBeGreaterThanOrEqual(1);
    const bid = /\/b\/([0-9a-f-]+)\//.exec(page.url())![1]!;
    // The foundations draft (the real signal is the api's own status, not Today's panel): Today's drafting panel
    // shows only when its first read catches the mock drafting in progress, which a quick mock can finish before
    // (it failed on a clean main that way, WP-04 T5's log). Both a panel seen drafting and one never shown prove the
    // same thing once the status reads ready; a failed drafting would read "failed" and fail here.
    const api = await devApi(playwright);
    try {
      await expect.poll(() => foundationsStatus(api, bid), { timeout: LONG, intervals: [250, 500, 1000] }).toBe("ready");
    } finally {
      await api.dispose();
    }
    // Whatever Today shows of them now is the ready state, never drafting or failed.
    const status = page.getByTestId("foundations-status");
    await expect(status.and(page.locator("[data-foundations-state=failed]"))).toHaveCount(0);
    if (await status.count()) await expect(status).toHaveAttribute("data-foundations-state", "ready", { timeout: LONG });
    // The Inbox has the Chief of Staff's welcome note (an Update), or its note of the day once an agent's update was
    // folded into it (WP-04 T8: it replaces the welcome); Continue is not "Respond" for it.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, FIRST_NOTE)).toBeVisible({ timeout: LONG });
    await inboxRow(page, FIRST_NOTE).click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-type", "update", { timeout: LONG });
    await expect(page.getByTestId("decision-bar")).toHaveCount(0);
    // The spend cap per action Commit starts on (0, founder 2026-11-22) is kept on the business, editable in Settings › What the team can do.
    const mode = await openSettings(page, "mode", bid);
    await expect(mode.getByTestId("spend-cap-form").getByRole("radio", { name: /^Ask me every time/ })).toBeChecked({ timeout: LONG });
    // A new project shares the owner's one team budget for the month (their plan's: Studio for the dev owner), in US dollars.
    const billing = await openSettings(page, "billing", bid);
    await expect(billing.getByTestId("credits-balance")).toContainText(/\$[\d.,]+ left of \$[\d.,]+/, { timeout: LONG });
  });

  test("double-clicking Start my project sends one commit and creates one business", async ({ page, playwright }) => {
    const name = `Playwright Once ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    const commits: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("idea.commit")) commits.push(req.url());
    });
    await page.getByTestId("take-charge").dblclick();
    await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
    // One call, never a batch of two (`idea.commit,idea.commit`).
    expect(commits).toHaveLength(1);
    expect(commits[0]).not.toContain("idea.commit,idea.commit");
    const api = await devApi(playwright);
    try {
      const res = await api.get("/trpc/founder.profile.get");
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as { result: { data: { json: { businesses: { name: string }[] } } } };
      expect(body.result.data.json.businesses.filter((b) => b.name === name)).toHaveLength(1);
    } finally {
      await api.dispose();
    }
  });
});
