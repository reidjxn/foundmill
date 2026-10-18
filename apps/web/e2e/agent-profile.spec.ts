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
      // Canceling the retest does not undo the model change it was scoring; the notice says so.
      await expect(page.getByTestId("training-notice")).toContainText("Retest canceled. The live version is unchanged;");
    };
    const applyModel = async (pick: "other" | string, outcome: RegExp) => {
      await page.getByTestId("header-model-chip").click();
      const dialog = page.getByTestId("model-dialog");
      await expect(dialog).toBeVisible();
      const radio = pick === "other" ? dialog.locator("input[type=radio]:not(:checked):not(:disabled)").first() : dialog.locator(`input[type=radio][value="${pick}"]`);
      await expect(radio).toBeAttached({ timeout: LONG });
      await radio.click();
      await expect(page.getByTestId("apply-scope-dialog")).toBeVisible();
      await page.getByTestId("apply-scope-confirm").click();
      await expect(page.getByTestId("apply-scope-dialog")).toBeHidden({ timeout: LONG });
      await expect(page.getByText(outcome).first()).toBeVisible({ timeout: LONG });
    };

    await page.getByTestId("header-model-chip").click();
    const original = await page.getByTestId("model-dialog").locator("input[type=radio]:checked").getAttribute("value", { timeout: LONG });
    await page.keyboard.press("Escape");
    expect(original, "the picker marks the agent's current model").toBeTruthy();

    await applyModel("other", /1 retest queued/);
    await page.getByRole("tab", { name: "Training" }).click();
    await expect(page.getByTestId("agent-training")).toBeVisible({ timeout: LONG });
    await cancelQueuedRuns();
    await expect(page.getByTestId("agent-training")).not.toHaveAttribute("data-phase", "active");

    // Put the seeded model back. The live version already runs on it, so there is nothing new to retest.
    await applyModel(original!, /^Model set to \w+ for 1 agent$/);
    await expect(progress).toHaveCount(0);
    await expect(page.getByTestId("agent-training")).not.toHaveAttribute("data-phase", "active");
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

  test("promoting a run writes its scores onto the attributes; a skill with no tests stays untested (founder: 'Training doesn't update ratings')", async ({ page }) => {
    // The seed leaves the Frontend Engineer's trained draft awaiting a decision, with a library skill the run found no
    // tests for (packages/db/src/seed/northwind.ts). The stack is seeded once per run, so the run is promoted once.
    await openBusiness(page, "d/team/squad");
    const link = page.locator("[data-testid=module-screen] a[href*='/agents/']").filter({ hasText: "Frontend Engineer" }).first();
    await expect(link, "the seed hires a frontend engineer into Northwind").toBeVisible({ timeout: LONG });
    await page.goto((await link.getAttribute("href"))!);
    await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });
    const skills = page.getByTestId("skills-panel");
    const craft = skills.locator("[data-skill=component_craft]");
    const releaseNotes = skills.locator("[data-skill=library_release_notes]");
    await expect(craft).toBeVisible({ timeout: LONG });
    await expect(releaseNotes).toContainText("Untested");
    const before = Number((await craft.locator("[data-rating-figure]").first().textContent())?.trim());
    expect(before, "the seed rates the skill at the template's baseline").toBeGreaterThan(0);

    await page.getByRole("tab", { name: "Training" }).click();
    const training = page.getByTestId("agent-training");
    await expect(training).toBeVisible({ timeout: LONG });
    await expect(training).toHaveAttribute("data-phase", /awaiting|watch/, { timeout: LONG });
    if ((await training.getAttribute("data-phase")) === "awaiting") {
      const results = page.getByTestId("training-results");
      await expect(results).toBeVisible({ timeout: LONG });
      const untested = results.locator("[data-skill=library_release_notes]");
      await expect(untested).toContainText("Release notes");
      await expect(untested).toContainText("No tests yet");
      await expect(results.locator("[data-skill=component_craft]")).toContainText("up 3");
      expect(await results.innerText(), "skills read as words, never keys").not.toMatch(/library_|_craft/);
      await results.getByRole("button", { name: /^Promote v\d+$/ }).click();
      await expect(page.getByTestId("training-notice")).toContainText("Promoted; 6 ratings updated", { timeout: LONG });
      await expect(training).toHaveAttribute("data-phase", "watch", { timeout: LONG });
    }

    // The attributes reflect the promotion at once: the scored skill shows its new rating, the library skill is still untested.
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(craft).toBeVisible({ timeout: LONG });
    await expect(craft.locator("[data-rating-figure]").first()).toHaveText(String(before + 3), { timeout: LONG });
    await expect(craft.locator("[data-skill-delta]")).toContainText("3");
    await expect(releaseNotes).toContainText("Untested");
    await expect(releaseNotes.locator("[data-rating-figure]").first()).toHaveText(String(before));
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
    // Negotiation has no runtime yet (AC-11.14.3): the switch is off and cannot be turned on; limits save as "Save limits".
    await expect(page.getByTestId("save-negotiation")).toHaveText(/Save limits/);
    await expect(page.locator("#negotiation-enabled")).toBeDisabled();
    await expect(page.getByTestId("negotiation-footer")).toContainText("not available yet");
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
    // Sessions name their task and link to it on the Plan, never a raw task id (TPD-21).
    await expect(page.getByTestId("agent-logs")).not.toContainText(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
    const taskLink = page.getByTestId("agent-logs").locator("a[href*='/plan?task=']").first();
    if (await taskLink.count()) await expect(taskLink).not.toHaveText(/^[0-9a-f-]{36}$/);
  });

  test("line manager: the header control opens a picker; nothing is saved until a new manager is chosen (TPD-27)", async ({ page }) => {
    await openSquadAgent(page);
    const header = page.getByTestId("profile-header");
    await expect(header.getByTestId("header-line-manager")).toBeVisible({ timeout: LONG });
    await header.getByTestId("header-change-manager").click();
    const dialog = page.getByTestId("line-manager-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("line-manager-save")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("training: custom skills can be added and wait for review (AC-08)", async ({ page }) => {
    await openSquadAgent(page);
    await page.getByRole("tab", { name: "Training" }).click();
    const panel = page.getByTestId("custom-skills");
    await expect(panel).toBeVisible({ timeout: LONG });
    await panel.getByTestId("add-custom-skill").click();
    const dialog = page.getByTestId("add-skill-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("draft-custom-skill")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
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
