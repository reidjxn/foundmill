import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness } from "./helpers";

/**
 * Agent profile (BUILD §11.10; AC-11.10.1 live version untouched until Promote, AC-11.10.5 ApplyScopeDialog on a
 * model change) on the seeded Northwind squad. Stack and commands: e2e/README.md.
 */

/** Opens the first squad member who is not the Chief of Staff (whose model is locked to the top route). */
async function openSquadAgent(page: Page): Promise<string> {
  await openBusiness(page, "d/team/squad");
  const links = page.locator("[data-testid=module-screen] a[href*='/agents/']").filter({ hasNotText: "Chief of Staff" });
  await expect(links.first(), "the seed hires a squad into Northwind's Team department").toBeVisible({ timeout: LONG });
  const href = (await links.first().getAttribute("href"))!;
  await page.goto(href);
  await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });
  return href.match(/\/agents\/([0-9a-f-]{36})/)![1]!;
}

test.describe("agent profile", () => {
  test("header, six tabs and the overview panels", async ({ page }) => {
    const agentId = await openSquadAgent(page);
    await expect(page.getByTestId("agent-profile")).toHaveAttribute("data-agent-id", agentId);
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("header-model-chip")).toBeVisible();
    for (const tab of ["Overview", "Training", "Autonomy", "Tools", "History", "Logs"]) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    await expect(page.getByTestId("what-i-do")).toBeVisible();
    await expect(page.getByTestId("skills-panel")).toBeVisible();
    await expect(page.getByTestId("position-map")).toBeVisible();
    await expect(page.getByTestId("contract-panel")).toBeVisible();
  });

  test("model chip → picker → ApplyScopeDialog (AC-11.10.5)", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByTestId("header-model-chip").click();
    const dialog = page.getByTestId("model-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("model-locked-notice")).toHaveCount(0);
    const other = dialog.locator("input[type=radio]:not(:checked):not(:disabled)").first();
    await expect(other, "a squad agent's route allows more than one model").toBeAttached({ timeout: LONG });
    // Picking another model opens the scope dialog before anything is applied, so the radio itself does not flip.
    await other.click();
    await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("apply-scope-dialog")).toBeHidden();
  });

  test("training: editing saves a draft, the live version stays (AC-11.10.1)", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByRole("tab", { name: "Training" }).click();
    await expect(page.getByTestId("agent-training")).toBeVisible({ timeout: LONG });
    await expect(page).toHaveURL(/\/training$/);
    const liveChip = page.getByText(/^Live v\d+$/);
    const before = (await liveChip.count()) ? await liveChip.first().textContent() : null;
    const goals = page.locator("[data-instructions-editor]").getByRole("region", { name: "Goals" });
    const goalsBefore = await goals.getByRole("textbox", { name: /^Item \d+$/ }).count();
    await goals.getByRole("button", { name: "Add goal" }).click();
    const goalInputs = goals.getByRole("textbox", { name: /^Item \d+$/ });
    await expect(goalInputs).toHaveCount(goalsBefore + 1);
    await goalInputs.last().fill(`Reply to every customer within one working day (${Date.now().toString(36)})`);
    await page.getByTestId("save-draft").click();
    await expect(page.getByTestId("training-notice")).toContainText(/Draft v\d+ saved/, { timeout: LONG });
    if (before) await expect(liveChip.first()).toHaveText(before);
    await page.getByTestId("train").click();
    await expect(page.getByTestId("train-dialog")).toBeVisible();
    await expect(page.getByTestId("train-dialog")).toContainText("Estimate");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("train-dialog")).toBeHidden();
  });

  test("autonomy and tools panels render with their save paths", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByRole("tab", { name: "Autonomy" }).click();
    await expect(page.getByTestId("agent-autonomy")).toBeVisible({ timeout: LONG });
    await page.getByLabel("Ask more often").check();
    // The seed gives some agents an approval threshold above a zero spend cap, which the form refuses to save; the
    // threshold field is part of the save path, so put it inside the cap first.
    await page.getByRole("textbox", { name: "Ask above" }).fill("0");
    await expect(page.getByTestId("autonomy-error")).toHaveCount(0);
    await expect(page.getByTestId("save-autonomy")).toBeEnabled();
    await page.getByTestId("save-autonomy").click();
    await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("apply-scope-dialog")).toBeHidden();
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByTestId("agent-tools")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("tool-grants")).toBeVisible();
    await expect(page.getByTestId("permissions-panel")).toBeVisible();
  });

  test("history and logs", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("history-timeline")).toBeVisible({ timeout: LONG });
    await page.getByRole("tab", { name: "Logs" }).click();
    await expect(page.getByTestId("agent-logs")).toBeVisible({ timeout: LONG });
    expect(page.url()).toContain(`/b/${NORTHWIND_BUSINESS_ID}/agents/`);
  });
});
