import { expect, test } from "@playwright/test";
import { LONG, UUID, ensureDeck, signIn } from "./helpers";

/**
 * Stop all agents and the way back (audit fixes BILL-03, api-services-02, SECX-2): on a business committed for this
 * test (so the seeded ones keep their agents' states), the kill switch turns into Resume agents with the reason, the
 * stop survives a reload, and Resume agents brings the team back. (Continue's refusal while stopped is covered by the
 * api suite, business-controls.test.ts.)
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
    await expect(stopDialog).toContainText("nothing starts again until an owner or admin resumes the agents");
    await stopDialog.getByRole("button", { name: "Stop all agents" }).click();
    await expect(page.getByTestId("resume-agents-trigger")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("stop-all-trigger")).toHaveCount(0);
    // The stop holds across a reload: it is the business's state, not the page's.
    await page.reload();
    await expect(page.getByTestId("resume-agents-trigger")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });

    await page.getByTestId("resume-agents-trigger").click();
    const resumeDialog = page.getByRole("dialog", { name: "Resume agents?" });
    await expect(resumeDialog).toContainText("because Stop all agents was pressed");
    await resumeDialog.getByRole("button", { name: "Resume agents" }).click();
    await expect(page.getByTestId("stop-all-trigger")).toBeVisible({ timeout: LONG });
    await expect(page.getByText("Agents resumed").first()).toBeVisible({ timeout: LONG });
  });
});
