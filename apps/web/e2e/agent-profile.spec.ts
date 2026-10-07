import { expect, test, type Page } from "@playwright/test";

/**
 * Agent profile (BUILD §11.10; AC-11.10.1 live version untouched until Promote, AC-11.10.5 ApplyScopeDialog on a
 * model change). Not run in the build container (no browser). Needs apps/api in mock mode with DEV_AUTH_USER_ID set
 * to a seeded owner; the seed hires a squad into every department.
 */
async function openFirstAgent(page: Page): Promise<string | null> {
  const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1];
  if (!bid) return null;
  await page.goto(`/b/${bid}/d/team/squad`);
  const link = page.locator("[data-testid=tab-bar] ~ * a[href*='/agents/']").first().or(page.locator("a[href*='/agents/']").first());
  if ((await link.count()) === 0) return null;
  const href = await link.getAttribute("href");
  if (!href) return null;
  await page.goto(href);
  return bid;
}

test.describe("agent profile", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  });

  test("header, six tabs and the overview panels", async ({ page }) => {
    const bid = await openFirstAgent(page);
    test.skip(!bid, "no seeded squad for the dev user");
    await expect(page.getByTestId("agent-profile")).toBeVisible();
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("header-model-chip")).toBeVisible();
    for (const tab of ["Overview", "Training", "Autonomy", "Tools", "History", "Logs"]) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    await expect(page.getByTestId("what-i-do")).toBeVisible();
    await expect(page.getByTestId("skills-panel")).toBeVisible();
    await expect(page.getByTestId("position-map")).toBeVisible();
    await expect(page.getByTestId("contract-panel")).toBeVisible();
  });

  test("model chip → picker → ApplyScopeDialog (AC-11.10.5)", async ({ page }) => {
    const bid = await openFirstAgent(page);
    test.skip(!bid, "no seeded squad for the dev user");
    await page.getByTestId("header-model-chip").click();
    const dialog = page.getByTestId("model-dialog");
    await expect(dialog).toBeVisible();
    const locked = await page.getByTestId("model-locked-notice").count();
    test.skip(locked > 0, "this agent's route is locked");
    const unchecked = dialog.locator("input[type=radio]:not(:checked):not(:disabled)").first();
    test.skip((await unchecked.count()) === 0, "no other model allowed");
    await unchecked.check();
    await expect(page.getByTestId("apply-scope-dialog").or(page.getByTestId("cos-downgrade-warning"))).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("training: editing saves a draft, the live version stays (AC-11.10.1)", async ({ page }) => {
    const bid = await openFirstAgent(page);
    test.skip(!bid, "no seeded squad for the dev user");
    await page.getByRole("tab", { name: "Training" }).click();
    await expect(page.getByTestId("agent-training")).toBeVisible();
    const liveChip = page.getByText(/^Live v\d+$/);
    const before = (await liveChip.count()) ? await liveChip.textContent() : null;
    await page.getByRole("button", { name: "Add goal" }).click();
    const inputs = page.locator("[data-instructions-editor] input, [data-instructions-editor] textarea");
    await inputs.last().fill("Reply to every customer within one working day");
    await page.getByTestId("save-draft").click();
    await expect(page.getByTestId("training-notice")).toContainText(/Draft v\d+ saved/);
    if (before) await expect(liveChip).toHaveText(before);
    await page.getByTestId("train").click();
    await expect(page.getByTestId("train-dialog")).toBeVisible();
    await expect(page.getByTestId("train-dialog")).toContainText("Estimate");
    await page.keyboard.press("Escape");
  });

  test("autonomy and tools panels render with their save paths", async ({ page }) => {
    const bid = await openFirstAgent(page);
    test.skip(!bid, "no seeded squad for the dev user");
    await page.getByRole("tab", { name: "Autonomy" }).click();
    await expect(page.getByTestId("agent-autonomy")).toBeVisible();
    await page.getByLabel("Ask more often").check();
    await page.getByTestId("save-autonomy").click();
    await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByTestId("tool-grants")).toBeVisible();
    await expect(page.getByTestId("permissions-panel")).toBeVisible();
  });

  test("history and logs", async ({ page }) => {
    const bid = await openFirstAgent(page);
    test.skip(!bid, "no seeded squad for the dev user");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("history-timeline")).toBeVisible();
    await page.getByRole("tab", { name: "Logs" }).click();
    await expect(page.getByTestId("agent-logs")).toBeVisible();
  });
});
