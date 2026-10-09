import { expect, test } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * Development › Code (0013 workspaces): the code agents wrote on code tasks, saved by the orchestrator when each
 * session ends. The local stack runs no orchestrator, so the seeded business has no saved code; the spec checks the
 * tab's place and its empty state. Saving and restoring are covered in apps/orchestrator (session-live, workspace-store)
 * and reading in apps/api (dev-code) and packages/modules (code.test.tsx).
 */
test.describe("development code tab", () => {
  test("sits after Pull requests and explains where saved code comes from", async ({ page }) => {
    await openBusiness(page);
    const development = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /development/i }).first();
    await expect(development, "the seed gives Northwind a Development department").toBeVisible({ timeout: LONG });
    const href = (await development.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/code"));
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/code", { timeout: LONG });

    const tabs = await page.getByRole("tab").allTextContents();
    const pr = tabs.findIndex((t) => /pull requests/i.test(t));
    expect(pr, "the Development tabs include Pull requests").toBeGreaterThanOrEqual(0);
    expect(tabs[pr + 1]).toMatch(/^code$/i);

    await expect(page.getByText("No saved code yet")).toBeVisible({ timeout: LONG });
    await expect(page.getByText(/the files it wrote are saved here/)).toBeVisible();
    await page.getByRole("button", { name: "Go to Plan" }).click();
    await page.waitForURL(/\/d\/[^/]+\/plan/, { timeout: LONG });
  });

  test("setting up GitHub starts from Settings › Integrations when it is not connected", async ({ page }) => {
    await openBusiness(page);
    const development = page.locator("[data-testid=app-shell] nav a[href*='/d/']").filter({ hasText: /development/i }).first();
    await expect(development).toBeVisible({ timeout: LONG });
    const href = (await development.getAttribute("href"))!;
    await page.goto(href.replace(/\/d\/([^/]+)\/.*$/, "/d/$1/code"));
    await page.getByRole("button", { name: "Set up GitHub" }).click();
    const dialog = page.getByRole("dialog", { name: "Push saved code to GitHub" });
    await expect(dialog.getByText(/private repository/)).toBeVisible();
    await expect(dialog.getByText(/not connected for this business yet/)).toBeVisible();
    await dialog.getByRole("button", { name: "Open Settings › Integrations" }).click();
    await page.waitForURL(/\/settings\/integrations/, { timeout: LONG });
    await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-tab", "integrations", { timeout: LONG });
  });
});

test.describe("finishing a GitHub App installation", () => {
  // What GitHub's callback forwards (app/integrations/github/callback): the installation, its one-time code and the
  // api-signed state. The page only offers to connect; the api and gateway check the state and the installer.
  test("asks the founder to confirm, and offers nothing without GitHub's code", async ({ page }) => {
    const base = `/b/${await openBusiness(page)}`;
    await page.goto(`${base}/settings/integrations?github_installation=48213377&github_state=e30.c2ln&github_code=c0de`);
    const pending = page.getByTestId("github-installation");
    await expect(pending).toContainText("GitHub installation 48213377 is ready", { timeout: LONG });
    await expect(pending.getByRole("button", { name: "Connect installation" })).toBeVisible();

    await page.goto(`${base}/settings/integrations?github_installation=48213377&github_state=e30.c2ln`);
    await expect(page.getByTestId("github-installation")).toContainText("GitHub did not confirm who installed installation 48213377", { timeout: LONG });
    await expect(page.getByRole("button", { name: "Connect installation" })).toHaveCount(0);
  });
});
