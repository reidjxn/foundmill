import { expect, test } from "@playwright/test";
import { LONG, signIn } from "./helpers";

/**
 * /new/import — Door B (BUILD §11.1, AC-11.1.5). The import job runs on the API (`import.start` / `import.status`,
 * deterministic without a Temporal worker) and "Continue to Commit" calls `idea.generate` in mock mode. Stack and
 * commands: e2e/README.md.
 */
test.describe("import", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/new/import");
    await expect(page.getByTestId("import-sources")).toBeVisible({ timeout: LONG });
  });

  test("lists ten read-only sources and validates the repository", async ({ page }) => {
    await expect(page.locator("[data-source]")).toHaveCount(10);
    // One "Read only" chip per source (the bank source's description also says "Read only.", hence the exact match).
    await expect(page.locator("[data-source]").getByText("Read only", { exact: true })).toHaveCount(10);
    await expect(page.getByTestId("start-import")).toBeDisabled();
    await page.getByLabel("Import from GitHub").check();
    await page.getByTestId("start-import").click();
    await expect(page.getByRole("alert").filter({ hasText: /owner\/name/ }).first()).toBeVisible();
  });

  test("AC-11.1.5: a GitHub import never pushes and the Import report seeds the roadmap from open issues", async ({ page }) => {
    await page.getByLabel("Import from GitHub").check();
    await page.getByLabel("Repository").fill("acme/ledgerly");
    await page.getByLabel("Import from Stripe").check();
    await page.getByTestId("start-import").click();
    await expect(page.getByTestId("import-progress")).toBeVisible();
    await expect(page.locator('[data-source-progress="github"] [data-step-status="done"]')).toHaveCount(6, { timeout: LONG });
    const report = page.getByTestId("scouting-report");
    await expect(report).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("never-pushed")).toHaveText(/Nothing was pushed/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Import report: Ledgerly");
    expect(await page.getByTestId("roadmap-seeds").locator("li").count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("first-decisions").locator("[data-recommended]")).toHaveCount(1);
    await expect(report.getByText("Estimate").first()).toBeVisible();

    await page.getByTestId("continue-to-commit").click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+\?name=Ledgerly&from=import/, { timeout: LONG });
    await expect(page.getByLabel(/Business name/)).toHaveValue("Ledgerly");
  });
});
