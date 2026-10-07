import { expect, test } from "@playwright/test";

/**
 * /new/import — Door B (BUILD §11.1, AC-11.1.5). The import job runs on the API (`import.start` / `import.status`,
 * deterministic without a Temporal worker) and "Continue to Commit" calls `idea.generate` in mock mode. Stack and
 * commands: e2e/README.md.
 */
test.describe("import", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
    if (/\/onboarding/.test(page.url())) test.skip(true, "founder profile missing; run onboarding.spec.ts first");
    await page.goto("/new/import");
    await expect(page.getByTestId("import-sources")).toBeVisible();
  });

  test("lists ten read-only sources and validates the repository", async ({ page }) => {
    await expect(page.locator("[data-source]")).toHaveCount(10);
    await expect(page.getByText("Read only")).toHaveCount(10);
    await expect(page.getByTestId("start-import")).toBeDisabled();
    await page.getByLabel("Import from GitHub").check();
    await page.getByTestId("start-import").click();
    await expect(page.getByRole("alert").first()).toContainText(/owner\/name/);
  });

  test("AC-11.1.5: a GitHub import never pushes and the Scouting report seeds the roadmap from open issues", async ({ page }) => {
    await page.getByLabel("Import from GitHub").check();
    await page.getByLabel("Repository").fill("acme/ledgerly");
    await page.getByLabel("Import from Stripe").check();
    await page.getByTestId("start-import").click();
    await expect(page.getByTestId("import-progress")).toBeVisible();
    await expect(page.locator('[data-source-progress="github"] [data-step-status="done"]')).toHaveCount(6, { timeout: 30_000 });
    const report = page.getByTestId("scouting-report");
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("never-pushed")).toHaveText(/Nothing was pushed/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Scouting report: Ledgerly");
    expect(await page.getByTestId("roadmap-seeds").locator("li").count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("first-decisions").locator("[data-recommended]")).toHaveCount(1);
    await expect(report.getByText("Estimate").first()).toBeVisible();

    await page.getByTestId("continue-to-commit").click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+\?name=Ledgerly&from=import/, { timeout: 30_000 });
    await expect(page.getByLabel(/Business name/)).toHaveValue("Ledgerly");
  });
});
