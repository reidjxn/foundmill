import { expect, test } from "@playwright/test";
import { LONG, departmentBase, openBusiness, settingsScreen, settled, setBuilderView } from "./helpers";

// Builder view on for this file (it opens the Code tab); global-setup.ts starts every run with it off. Restored afterwards.
let builderViewBefore = false;
test.beforeAll(async ({ playwright }) => {
  builderViewBefore = await setBuilderView(playwright, true);
});
test.afterAll(async ({ playwright }) => {
  await setBuilderView(playwright, builderViewBefore);
});

/**
 * Development › Code (0013 workspaces): the code agents wrote on code tasks, saved by the orchestrator when each
 * session ends. The local stack runs no orchestrator, so the seeded business has no saved code; the spec checks the
 * tab's place and its empty state. Saving and restoring are covered in apps/orchestrator (session-live, workspace-store)
 * and reading in apps/api (dev-code) and packages/modules (code.test.tsx).
 */
test.describe("development code tab", () => {
  test("sits after Pull requests and explains where saved code comes from", async ({ page }) => {
    await openBusiness(page);
    // The sidebar lists areas, not departments: the seeded Development department keeps the module's slug.
    await page.goto(`${departmentBase("development")}/code`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "development/code", { timeout: LONG });

    // Builder view on: the Product area's every tab inline (a long bar overflows into More, so read the hidden ones too).
    const tabs = await page.getByRole("tablist", { name: "Product tabs" }).locator("[role=tab]").allTextContents();
    const pr = tabs.findIndex((t) => /pull requests/i.test(t));
    expect(pr, "the Development tabs include Pull requests").toBeGreaterThanOrEqual(0);
    expect(tabs[pr + 1]).toMatch(/^code$/i);

    await expect(page.getByText("No saved code yet")).toBeVisible({ timeout: LONG });
    await expect(page.getByText(/the files it wrote are saved here/)).toBeVisible();
    // The footer defines "session" and "branch" where a founder first meets them (guidance on, the product default).
    await expect(page.getByTestId("module-screen").locator("[data-term='branch']").first()).toBeVisible();
    await page.getByRole("button", { name: "Go to Plan" }).click();
    await page.waitForURL(/\/d\/[^/]+\/plan/, { timeout: LONG });
  });

  test("setting up GitHub starts from Settings › Integrations when it is not connected", async ({ page }) => {
    await openBusiness(page);
    // The sidebar lists areas, not departments: the seeded Development department keeps the module's slug.
    await page.goto(`${departmentBase("development")}/code`);
    await settled(page);
    await page.getByRole("button", { name: "Set up GitHub" }).click();
    const dialog = page.getByRole("dialog", { name: "Push saved code to GitHub" });
    await expect(dialog.getByText(/private repository/)).toBeVisible();
    await expect(dialog.getByText(/not connected for this business yet/)).toBeVisible();
    await dialog.getByRole("button", { name: "Open Settings › Integrations" }).click();
    await page.waitForURL(/\/settings\/integrations/, { timeout: LONG });
    await expect(settingsScreen(page)).toHaveAttribute("data-tab", "integrations", { timeout: LONG });
  });
});

test.describe("finishing a GitHub App installation", () => {
  // What GitHub's callback forwards (app/integrations/github/callback): the installation, its one-time code and the
  // api-signed state. The page only offers to connect; the api and gateway check the state and the installer.
  test("asks the founder to confirm, and offers nothing without GitHub's code", async ({ page }) => {
    const base = `/b/${await openBusiness(page)}`;
    await page.goto(`${base}/settings/integrations?github_installation=48213377&github_state=e30.c2ln&github_code=c0de`);
    await settled(page);
    // Inside the screen in the shell: a streamed page parks a second copy outside it for a moment (helpers.ts).
    const pending = settingsScreen(page).getByTestId("github-installation");
    await expect(pending).toContainText("GitHub installation 48213377 is ready", { timeout: LONG });
    await expect(pending.getByRole("button", { name: "Connect installation" })).toBeVisible();

    await page.goto(`${base}/settings/integrations?github_installation=48213377&github_state=e30.c2ln`);
    await settled(page);
    await expect(settingsScreen(page).getByTestId("github-installation")).toContainText("GitHub did not confirm who installed installation 48213377", { timeout: LONG });
    await expect(settingsScreen(page).getByRole("button", { name: "Connect installation" })).toHaveCount(0);
  });
});

test.describe("choosing the repository from Settings (WP-07 T11)", () => {
  test("is reachable from Settings › Integrations with Builder view off", async ({ page, playwright }) => {
    await setBuilderView(playwright, false);
    try {
      const id = await openBusiness(page);
      await page.goto(`/b/${id}/settings/integrations`);
      await settled(page);
      const screen = settingsScreen(page);
      const row = screen.locator('[data-connector="github"]');
      await expect(row).toBeVisible({ timeout: LONG });
      if (await screen.getByTestId("github-repository").count() === 0) await row.getByRole("button", { name: "Connect" }).click();
      const panel = screen.getByTestId("github-repository");
      await expect(panel).toBeVisible({ timeout: LONG });
      await panel.getByLabel("Repository", { exact: true }).fill("acme/shop");
      await expect(panel.getByRole("button", { name: "Save repository" })).toBeEnabled();
      await expect(panel).toContainText("This repository has no commits yet");
    } finally {
      await setBuilderView(playwright, true);
    }
  });
});
