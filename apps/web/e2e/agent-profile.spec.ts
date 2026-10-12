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
  await expect(links.first(), "the seed hires a team into Northwind's Team department").toBeVisible({ timeout: LONG });
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
    await expect(other, "a team agent's route allows more than one model").toBeAttached({ timeout: LONG });
    // Picking another model opens the scope dialog before anything is applied, so the radio itself does not flip.
    await other.click();
    await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("apply-scope-dialog")).toBeHidden();
  });

  test("a model change queues a retest the founder can cancel; it never sits queued with no way out (AC-11.10.5)", async ({ page }) => {
    await openSquadAgent(page);
    const progress = page.getByTestId("training-progress");
    /** The e2e stack runs no Temporal, so a retest stays queued until the founder cancels it from the Training tab. */
    const cancelQueuedRuns = async () => {
      await expect(progress).toBeVisible({ timeout: LONG });
      for (let i = 0; i < 5 && (await progress.count()) > 0; i++) {
        const runId = await progress.getAttribute("data-run-id");
        await progress.getByTestId("cancel-training").click();
        await expect(page.locator(`[data-testid=training-progress][data-run-id="${runId}"]`)).toHaveCount(0, { timeout: LONG });
      }
      await expect(progress).toHaveCount(0);
      await expect(page.getByTestId("training-notice")).toContainText("Training canceled. The live version is unchanged.");
    };
    const applyModel = async (pick: "other" | string) => {
      await page.getByTestId("header-model-chip").click();
      const dialog = page.getByTestId("model-dialog");
      await expect(dialog).toBeVisible();
      const radio = pick === "other" ? dialog.locator("input[type=radio]:not(:checked):not(:disabled)").first() : dialog.locator(`input[type=radio][value="${pick}"]`);
      await expect(radio).toBeAttached({ timeout: LONG });
      await radio.click();
      await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
      await page.getByTestId("apply-scope-confirm").click();
      await expect(page.getByTestId("apply-scope-dialog")).toBeHidden({ timeout: LONG });
      await expect(page.getByText(/1 retest queued/).first()).toBeVisible({ timeout: LONG });
    };

    await page.getByTestId("header-model-chip").click();
    const original = await page.getByTestId("model-dialog").locator("input[type=radio]:checked").getAttribute("value", { timeout: LONG });
    await page.keyboard.press("Escape");
    expect(original, "the picker marks the agent's current model").toBeTruthy();

    await applyModel("other");
    await page.getByRole("tab", { name: "Training" }).click();
    await expect(page.getByTestId("agent-training")).toBeVisible({ timeout: LONG });
    await cancelQueuedRuns();
    await expect(page.getByTestId("agent-training")).not.toHaveAttribute("data-phase", "active");

    // Put the seeded model back; its retest is canceled the same way.
    await applyModel(original!);
    await cancelQueuedRuns();
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
    // Money fields keep exactly what is typed, keystroke by keystroke (audit WEB-03: "25" used to become "2.01").
    const cap = page.getByRole("textbox", { name: "Spend cap per action" });
    for (const amount of ["25", "150.50"]) {
      await cap.click();
      await cap.press("ControlOrMeta+a");
      await cap.press("Backspace");
      await cap.pressSequentially(amount);
      await expect(cap).toHaveValue(amount);
    }
    // At rest the amount is grouped for reading; focus shows the typed text again.
    await cap.click();
    await cap.press("ControlOrMeta+a");
    await cap.pressSequentially("1250");
    await page.getByRole("textbox", { name: "Ask above" }).click();
    await expect(cap).toHaveValue("1,250");
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

  test("founder copy: each header chip once, no build references, tool ids or raw errors on any tab", async ({ page }) => {
    await openSquadAgent(page);
    const header = page.getByTestId("profile-header");
    await expect(header).toBeVisible({ timeout: LONG });
    // No "Click to change" label (the model chip is the control) and the wage period in words, not "2026-10".
    await expect(header).not.toContainText(/Click to change|Wage · \d{4}-\d{2}/);
    const chipTexts = (await header.locator("[data-chip], [data-tone]").allInnerTexts()).map((t) => t.trim().toLowerCase()).filter(Boolean);
    expect(new Set(chipTexts).size, `duplicate header chips: ${chipTexts.join(", ")}`).toBe(chipTexts.length);
    // "What I do" speaks to the founder: no structured tail, no tool ids, no build references.
    const about = page.getByTestId("what-i-do");
    await expect(about).toBeVisible();
    await expect(about).not.toContainText(/Inputs:|Outputs:|BUILD §|\b[a-z]+_[a-z_]+\b/);
    // Autonomy opens without a red error in its default state, and its saves say what they save.
    await page.getByRole("tab", { name: "Autonomy" }).click();
    await expect(page.getByTestId("agent-autonomy")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("save-autonomy")).toHaveText(/Save autonomy/);
    await expect(page.getByTestId("save-negotiation")).toHaveText(/Save negotiation/);
    // Tools by name in words, never "HARD GATE (BUILD §2.2)".
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByTestId("tool-grants")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("tool-grants")).not.toContainText(/BUILD §|HARD GATE/);
    // Logs: an empty replay explains itself in words, never a client error message.
    await page.getByRole("tab", { name: "Logs" }).click();
    await expect(page.getByTestId("agent-logs")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("agent-logs")).not.toContainText(/enableOfflineQueue|writeable|ECONNREFUSED/);
  });

  test("history and logs", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("history-timeline")).toBeVisible({ timeout: LONG });
    await page.getByRole("tab", { name: "Logs" }).click();
    await expect(page.getByTestId("agent-logs")).toBeVisible({ timeout: LONG });
    expect(page.url()).toContain(`/b/${NORTHWIND_BUSINESS_ID}/agents/`);
  });

  test("model costs read in US dollars on a business that keeps its books in pounds", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByRole("tab", { name: "History" }).click();
    const history = page.getByTestId("agent-history");
    await expect(history).toBeVisible({ timeout: LONG });
    await expect(history).toContainText("$");
    await expect(history).not.toContainText("£");
    await page.getByRole("tab", { name: "Logs" }).click();
    const logs = page.getByTestId("agent-logs");
    await expect(logs).toBeVisible({ timeout: LONG });
    await expect(logs).not.toContainText("£");
  });

  test("Talk opens the agent's desk as a sheet; a starter gets a reply in the agent's voice, with 2–4 quick replies", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByTestId("header-talk").click();
    const desk = page.getByTestId("agent-desk");
    await expect(desk).toBeVisible({ timeout: LONG });
    await expect(desk).toHaveAttribute("data-variant", "sheet");
    // The agent's presence: portrait, name, role, the "AI agent" marker and a state line.
    await expect(desk.getByTestId("desk-presence")).toContainText("AI agent");
    await expect(desk.getByTestId("desk-state")).toBeVisible();
    // Starters are there at once (no model call); the founder never has to type.
    const replies = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(replies.first()).toBeVisible({ timeout: LONG });
    expect(await replies.count()).toBeGreaterThanOrEqual(2);
    expect(await replies.count()).toBeLessThanOrEqual(4);
    const agentBubbles = desk.getByTestId("agent-bubble");
    const before = await agentBubbles.count();
    const label = (await replies.first().innerText()).replace(/^\d\s*/, "").trim();
    await page.keyboard.press("1");
    await expect(desk.getByTestId("founder-bubble").last()).toBeVisible();
    await expect.poll(() => agentBubbles.count(), { timeout: LONG }).toBeGreaterThan(before);
    await expect(desk.getByTestId("read-receipt").last()).toContainText(/Read \d{1,2}:\d\d [AP]M/);
    const after = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
    await expect(after.first()).toBeVisible({ timeout: LONG });
    expect(await after.count()).toBeGreaterThanOrEqual(2);
    expect(await after.count()).toBeLessThanOrEqual(4);
    expect(label.length).toBeGreaterThan(0);
    // Escape closes the sheet back to the profile.
    await page.keyboard.press("Escape");
    await expect(desk).toBeHidden();
    await expect(page.getByTestId("agent-profile")).toBeVisible();
  });
});
