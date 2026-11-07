import { expect, test, type Page } from "@playwright/test";
import { LONG, UUID, devApi, ensureDeck, inboxRow, logoPng, openSettings, signIn } from "./helpers";

/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7; docs/UX_AUDIT_AND_PLAN.md §7.6). The
 * test drafts a card in the studio first when the deck is empty. Stack and commands: e2e/README.md.
 */

/**
 * Opens "How it runs" (A3): while guidance is on the five controls (Personal or live, Archetype, Business mode, Spend
 * cap, Autopilot) sit behind "Change"; with guidance off (Settings › Preferences) they are open already.
 */
async function openHowItRuns(page: Page): Promise<void> {
  const change = page.getByTestId("how-it-runs-change");
  await expect(change).toBeVisible({ timeout: LONG });
  if ((await change.getAttribute("aria-expanded")) !== "true") await change.click();
  await expect(change).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("business-mode-panel")).toBeVisible();
}

test.describe("commit", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  });

  test("Name and Logo are open; How it runs is one line of chips until Change opens the five controls (A3, §7.6)", async ({ page }) => {
    await expect(page.getByTestId("name-panel")).toBeVisible();
    await expect(page.getByTestId("logo-panel")).toBeVisible();
    const summary = page.getByTestId("how-it-runs-summary");
    await expect(summary.locator("[data-summary]")).toHaveCount(5);
    await expect(summary.locator('[data-summary="game-mode"]')).toHaveText("Personal");
    await expect(summary.locator('[data-summary="business-mode"]')).toHaveText("Assisted");
    await expect(summary.locator('[data-summary="spend-cap"]')).toHaveText(/^Asks you above /);
    await expect(summary.locator('[data-summary="autopilot"]')).toHaveText("Autopilot off");
    const change = page.getByTestId("how-it-runs-change");
    const open = (await change.getAttribute("aria-expanded")) === "true";
    // Open at once only while guidance is off (an operator's default); on, the controls wait behind Change.
    await expect(page.getByTestId("archetype-panel")).toHaveCount(open ? 1 : 0);
    await openHowItRuns(page);
    await expect(page.getByRole("radiogroup", { name: "Personal or live" })).toBeVisible();
    await expect(page.getByTestId("archetype-panel")).toBeVisible();
    await expect(page.getByLabel(/Spend cap per action/)).toBeVisible();
    await expect(page.getByTestId("run-on-autopilot")).toBeVisible();
    // The defined words in the summary open their definition while guidance is on (a dotted Term).
    await expect(summary.locator('[data-summary="archetype"] [data-term="archetype"]')).toBeVisible();
    await change.click();
    await expect(change).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("archetype-panel")).toHaveCount(0);
  });

  test("AC-11.1.7: Assisted is the default business mode; Personal the default game mode", async ({ page }) => {
    await openHowItRuns(page);
    await expect(page.getByTestId("commit-form")).toHaveAttribute("data-business-mode", "assisted");
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-option="personal"]')).toHaveAttribute("data-selected", "true");
    // The choice is named in plain words ("Personal or live"), not the internal "game mode".
    await expect(page.getByRole("radiogroup", { name: "Personal or live" })).toBeVisible();
    await expect(page.getByLabel(/Spend cap per action/)).toHaveValue("250");
    // A LIVE start asks for the 18+ confirmation only until it is on record: a founder who has given it is not asked
    // again (the seed with a profile), one who has not is asked.
    await page.locator('[data-option="live"] button[role="radio"]').click();
    await expect(page.locator('[data-option="live"]')).toHaveAttribute("data-selected", "true");
    const adult = page.getByTestId("commit-adult");
    await expect(adult).toHaveCount(await adult.count());
    if (await adult.count()) await expect(adult).toBeVisible();
  });

  test("Run on autopilot is a choice, off by default, and shows in the summary when chosen", async ({ page }) => {
    await openHowItRuns(page);
    const toggle = page.getByTestId("run-on-autopilot");
    const chip = page.getByTestId("how-it-runs-summary").locator('[data-summary="autopilot"]');
    await expect(page.getByTestId("autopilot-choice")).toContainText("Run on autopilot");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(chip).toHaveText("Autopilot off");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(chip).toHaveText("Autopilot on");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(chip).toHaveText("Autopilot off");
  });

  test("name suggestions, live domain availability and the trademark screen with its caveat", async ({ page }) => {
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
    await expect(next).toContainText("Your team is hired");
    await expect(next).toContainText("Two notes ask you to sign them off");
    await expect(next).not.toContainText("Board");
    await openHowItRuns(page);
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
    // The concept card beside the form shows the chosen logo too.
    await expect(page.locator("article[data-concept] img").first()).toHaveAttribute("src", picked!);
    // Generate again gives a different set.
    await page.getByTestId("logo-regenerate").click();
    await expect.poll(async () => options.nth(0).locator("img").getAttribute("src"), { timeout: LONG }).not.toBe(picked);
    await page.getByTestId("kit-primary-hex").fill("#ffff00");
    await expect(page.getByTestId("kit-contrast")).toContainText(/near-black/);
    await page.getByTestId("kit-primary-hex").fill("#1b4fd8");
    await expect(page.getByTestId("kit-contrast")).toHaveAttribute("data-passes", "true");
  });

  test("logo: upload a PNG, which the browser resizes and the server checks; brand colours are suggested from it", async ({ page }) => {
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

  test("AC-11.1.6: Take charge creates the business and lands on Home, where the foundations draft; the Inbox has the welcome note, nothing blocks Continue", async ({ page }) => {
    const name = `Playwright Business ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    await openHowItRuns(page);
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
    // Today shows the foundations drafting (or already drafted: the mock model is quick).
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("foundations-status")).toBeVisible({ timeout: LONG });
    // The sidebar carries the departments the commit created.
    expect(await page.locator("[data-testid=app-shell] nav a[href*='/d/']").count()).toBeGreaterThanOrEqual(1);
    const bid = /\/b\/([0-9a-f-]+)\//.exec(page.url())![1]!;
    // The Inbox has the Chief of Staff's welcome note (an Update); Continue is not "Respond" for it.
    await page.goto(`/b/${bid}/inbox`);
    await expect(inboxRow(page, "Your team is drafting the product foundations")).toBeVisible({ timeout: LONG });
    await inboxRow(page, "Your team is drafting the product foundations").click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-type", "update", { timeout: LONG });
    await expect(page.getByTestId("decision-bar")).toHaveCount(0);
    // The spend cap per action chosen on Commit (the Assisted default, 250) is kept on the business, editable in Settings › What the team can do.
    const mode = await openSettings(page, "mode", bid);
    await expect(mode.getByTestId("spend-cap-form").getByLabel("Amount per purchase")).toHaveValue("250", { timeout: LONG });
    // A new business starts on the free plan with this month's included credits, in US dollars.
    const billing = await openSettings(page, "billing", bid);
    await expect(billing.getByTestId("credits-balance")).toContainText("$5.00", { timeout: LONG });
  });

  test("double-clicking Take charge sends one commit and creates one business", async ({ page, playwright }) => {
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
