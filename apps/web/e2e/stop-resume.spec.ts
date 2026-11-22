import { expect, test } from "@playwright/test";
import { LONG, UUID, ensureDeck, signIn } from "./helpers";

/**
 * Stop all agents and the way back (audit fixes BILL-03, api-services-02, SECX-2): on a business committed for this
 * test (so the seeded ones keep their agents' states), the kill switch turns into Resume agents with the reason, the
 * stop survives a reload, a model change whose retest the credits cannot finish is refused (WP-09 T9), and Resume agents
 * brings the team back. (Continue's refusal, campaigns kept off live and hires starting paused while stopped are covered
 * by the api suite, business-controls.test.ts.)
 */
test.describe("stop and resume", () => {
  test.setTimeout(240_000);

  test("Stop all agents → Resume agents in the same place; resume brings the kill switch back", async ({ page }) => {
    await signIn(page);
    await ensureDeck(page, 1);
    await page.getByTestId("commit-link").first().click();
    await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
    await page.getByLabel(/Business name/).fill(`Stop ${Date.now().toString(36)}`);
    await page.getByTestId("take-charge").click();
    await page.waitForURL(new RegExp(`/b/${UUID}/`), { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });

    await page.getByTestId("stop-all-trigger").click();
    const stopDialog = page.getByRole("dialog", { name: "Stop all agents?" });
    // The reassurance comes first (B6), then what stops and who brings it back.
    await expect(stopDialog).toContainText(/Nothing is deleted\. (\d+ running sessions? stops? now|Every running session stops now)\./);
    await expect(stopDialog).toContainText("nothing starts again until an owner or admin resumes the agents");
    await stopDialog.getByRole("button", { name: "Stop all agents" }).click();
    await expect(page.getByTestId("resume-agents-trigger")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("stop-all-trigger")).toHaveCount(0);
    // The stop holds across a reload: it is the business's state, not the page's.
    await page.reload();
    await expect(page.getByTestId("resume-agents-trigger")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });

    // A retest spends credits, and a new project's $5 cannot finish one (WP-09 T9): the change is refused, not queued.
    // (A retest held for the resume is covered by the api suite, business-controls.test.ts.)
    const businessPath = page.url().match(new RegExp(`/b/${UUID}`))![0];
    await page.goto(`${businessPath}/d/team/squad`);
    const agentLinks = page.locator("[data-testid=module-screen] a[href*='/agents/']").filter({ hasNotText: "Chief of Staff" });
    await expect(agentLinks.first(), "commit hires a team").toBeVisible({ timeout: LONG });
    await page.goto((await agentLinks.first().getAttribute("href"))!);
    await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await page.getByTestId("header-model-chip").click();
    const otherModel = page.getByTestId("model-dialog").locator("input[type=radio]:not(:checked):not(:disabled)").first();
    await expect(otherModel).toBeAttached({ timeout: LONG });
    await otherModel.click();
    await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
    await page.getByTestId("apply-scope-confirm").click();
    await expect(page.getByText(/This check costs about \$[\d.]+ \(Estimate\)/).first()).toBeVisible({ timeout: LONG });
    // The refusal leaves the Apply where? dialog open: cancel it so the Resume agents button can be pressed.
    await page.getByTestId("apply-scope-dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("apply-scope-dialog")).toBeHidden();

    await page.getByTestId("resume-agents-trigger").click();
    const resumeDialog = page.getByRole("dialog", { name: "Resume agents?" });
    await expect(resumeDialog).toContainText("because Stop all agents was pressed");
    await resumeDialog.getByRole("button", { name: "Resume agents" }).click();
    await expect(page.getByTestId("stop-all-trigger")).toBeVisible({ timeout: LONG });
    await expect(page.getByText("Agents resumed").first()).toBeVisible({ timeout: LONG });
  });
});
