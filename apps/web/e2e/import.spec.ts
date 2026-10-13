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
    // Sources the import cannot read yet say so before the founder picks them.
    await expect(page.getByTestId("no-import-reader")).toHaveCount(3);
    // One "Read only" chip per source (the bank source's description also says "Read only.", hence the exact match).
    await expect(page.locator("[data-source]").getByText("Read only", { exact: true })).toHaveCount(10);
    await expect(page.getByTestId("start-import")).toBeDisabled();
    await page.getByLabel("Import from GitHub").check();
    await page.getByTestId("start-import").click();
    await expect(page.getByRole("alert").filter({ hasText: /owner\/name/ }).first()).toBeVisible();
  });

  test("AC-11.1.5: a GitHub import never pushes, and the Import report claims nothing it has not read", async ({ page }) => {
    await page.getByLabel("Import from GitHub").check();
    await page.getByLabel("Repository").fill("acme/ledgerly");
    await page.getByLabel("Import from Stripe").check();
    await page.getByTestId("start-import").click();
    // Two checks of 120 ms: the progress may pass too quickly to see, so the spec waits for the report.
    const report = page.getByTestId("scouting-report");
    await expect(report).toBeVisible({ timeout: LONG });
    // Before the business exists the job checks the repository name; the read itself waits for Take charge.
    await expect(page.locator('[data-source-progress="github"] [data-step-status="done"]')).toHaveCount(1);
    await expect(page.locator('[data-source-progress="github"] [data-step-status="planned"]')).toHaveCount(1);
    await expect(page.getByTestId("never-pushed")).toHaveText(/Nothing was pushed/);
    await expect(page.getByTestId("report-read-state")).toHaveText(/Nothing read yet/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Import report: Ledgerly");
    // No invented counts or issues: the roadmap seeds are empty and every strength is worded "Once …".
    await expect(page.getByTestId("roadmap-seeds").locator("li")).toHaveCount(0);
    await expect(report).not.toContainText(/\d+ (files read|customers|open issues)/);
    await expect(page.getByTestId("first-decisions").locator("[data-recommended]")).toHaveCount(1);
    await expect(report.getByText("Estimate").first()).toBeVisible();

    await page.getByTestId("continue-to-commit").click();
    await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+\?name=Ledgerly&from=import&archetype=b2b_saas&job=/, { timeout: LONG });
    await expect(page.getByLabel(/Business name/)).toHaveValue("Ledgerly");
    // Import's own trail (no Ideate or Compare), and the report's archetype is the one preselected.
    await expect(page.locator("[data-step-item]")).toHaveCount(4);
    await expect(page.locator('[data-step-item="ideate"]')).toHaveCount(0);
    await expect(page.locator('[data-option="b2b_saas"]')).toHaveAttribute("data-selected", "true");
  });

  test("the finished import survives a reload and the Back link from Commit (audit IAE-12)", async ({ page }) => {
    await page.getByLabel("Import from Stripe").check();
    await page.getByTestId("start-import").click();
    await expect(page.getByTestId("scouting-report")).toBeVisible({ timeout: LONG });
    await expect(page).toHaveURL(/\/new\/import\?job=/);
    await page.reload();
    await expect(page.getByTestId("scouting-report")).toBeVisible({ timeout: LONG });
    await page.getByTestId("continue-to-commit").dblclick();
    await expect(page).toHaveURL(/\/new\/commit\//, { timeout: LONG });
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page.getByTestId("scouting-report")).toBeVisible({ timeout: LONG });
  });

  test("a window under 1280 px asks for a larger one instead of an overflowing top bar (audit PAS-5)", async ({ page }) => {
    await page.setViewportSize({ width: 1279, height: 800 });
    await expect(page.getByTestId("needs-larger-window")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("import-sources")).toBeVisible();
  });
});
