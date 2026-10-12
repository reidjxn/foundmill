import { expect, test } from "@playwright/test";
import { LONG, devApi, ensureDeck, logoPng, signIn } from "./helpers";

/**
 * /new/commit/[ideaId] — the Commit screen (BUILD §11.1; AC-11.1.6, AC-11.1.7). The test drafts a card in the
 * studio first when the deck is empty. Stack and commands: e2e/README.md.
 */
test.describe("commit", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
    await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  });

  test("AC-11.1.7: Assisted is the default business mode; Personal the default game mode", async ({ page }) => {
    await expect(page.getByTestId("commit-form")).toHaveAttribute("data-business-mode", "assisted");
    await expect(page.locator('[data-option="assisted"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-option="personal"]')).toHaveAttribute("data-selected", "true");
    // The choice is named in plain words ("Personal or live"), not the internal "game mode".
    await expect(page.getByRole("radiogroup", { name: "Personal or live" })).toBeVisible();
    await expect(page.getByLabel(/Spend cap per action/)).toHaveValue("250");
  });

  test("name suggestions, live domain availability and the trademark screen with its caveat", async ({ page }) => {
    await expect(page.getByTestId("domain-checks").locator("[data-domain]")).toHaveCount(5);
    await expect(page.getByTestId("trademark-screen").locator("[data-registry]")).toHaveCount(2);
    await expect(page.getByTestId("trademark-caveat")).toContainText("Screen, not legal clearance");
    await page.getByLabel(/Business name/).fill("Stripe Ledger");
    await expect(page.locator('[data-registry="USPTO"]')).toHaveAttribute("data-status", "conflict");
    await expect(page.locator('[data-domain="stripeledger.com"]')).toBeVisible();
    await page.locator("[data-suggestion]").first().click();
    await expect(page.getByLabel(/Business name/)).not.toHaveValue("Stripe Ledger");
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

  test("AC-11.1.6: Take charge creates the business and opens the Board item in the Inbox", async ({ page }) => {
    const name = `Playwright Business ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    await page.getByLabel(/Business mode/).getByLabel(/Assisted/).check();
    // The chosen logo travels with the commit and lands on the top bar.
    await page.getByTestId("logo-generate").click();
    await expect(page.getByTestId("logo-option")).toHaveCount(4, { timeout: LONG });
    await page.getByTestId("logo-option").first().click();
    await page.getByTestId("take-charge").click();
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]+\/inbox\/[0-9a-f-]+/, { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("kit-bar")).toContainText(name);
    await expect(page.getByTestId("kitbar-logo")).toHaveAttribute("data-logo", "image", { timeout: LONG });
    await expect(page.getByTestId("kitbar-logo").locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    // The Board item: a decision from the Chief of Staff with at least two options.
    const item = page.getByTestId("inbox-item");
    await expect(item).toBeVisible({ timeout: LONG });
    await expect(item).toHaveAttribute("data-type", "decision");
    await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
    // The sidebar carries the departments the commit created.
    expect(await page.locator("[data-testid=app-shell] nav a[href*='/d/']").count()).toBeGreaterThanOrEqual(1);
    // The spend cap per action chosen on Commit (the Assisted default, 250) is kept on the business, editable in Settings › Mode.
    const bid = /\/b\/([0-9a-f-]+)\//.exec(page.url())![1]!;
    await page.goto(`/b/${bid}/settings/mode`);
    await expect(page.getByTestId("spend-cap-form").getByLabel("Spend cap per action")).toHaveValue("250", { timeout: LONG });
    // A new business starts on the free plan with this month's included credits, in US dollars.
    await page.goto(`/b/${bid}/settings/billing`);
    await expect(page.getByTestId("credits-balance")).toContainText("$5.00", { timeout: LONG });
  });

  test("double-clicking Take charge sends one commit and creates one business", async ({ page, playwright }) => {
    const name = `Playwright Once ${Date.now().toString(36)}`;
    await page.getByLabel(/Business name/).fill(name);
    const commits: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("idea.commit")) commits.push(req.url());
    });
    await page.getByTestId("take-charge").dblclick();
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]+\/inbox\/[0-9a-f-]+/, { timeout: LONG });
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
