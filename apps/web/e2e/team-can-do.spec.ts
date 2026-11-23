import { expect, test } from "@playwright/test";
import { LONG, openBusiness, settingsScreen, settled, toast } from "./helpers";

/**
 * Settings › What the team can do (founder, 2026-11-07): one page for how much the team does before it checks with the
 * founder. What always comes to the founder is said once; the amount per purchase reads in the top bar's chip in the
 * business's own currency, with the tooltip saying the stakes; handing publishing to the Chief of Staff shows up in
 * Team › Responsibilities; nothing is cut off at 1280. Northwind (GBP, Assisted, each agent's own limit) is put back as
 * the seed has it after each test. Stack and commands: e2e/README.md.
 */
const OWN_LIMIT = /^Each agent's own limit \(£250 unless you set one\)/;

test.describe("settings › what the team can do", () => {
  test("says once what always comes to the founder, in plain answers", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const screen = settingsScreen(page);
    await expect(screen.getByTestId("team-can-do-mode")).toBeVisible({ timeout: LONG });
    await expect(page).toHaveTitle(/^(?:\(\d+\) )?What the team can do · Settings · /);
    await expect(screen.getByText(/Nothing on this page changes that\./)).toHaveCount(1);
    await expect(screen.getByTestId("team-can-do-always")).toContainText("Moving money, signing, filing in your name, accepting terms, deleting for good and changing security settings always come to you.");
    const answers = screen.getByRole("radiogroup", { name: "How much should the team do before checking with you?" });
    await expect(answers.getByRole("radio")).toHaveCount(3);
    await expect(answers.getByRole("radio", { name: /^Routine work alone; ask before big or permanent steps · Recommended/ })).toBeVisible();
    // Putting changes live and adding agents are said as they are today, not offered as choices.
    await expect(screen.getByTestId("answer-merge_to_main")).toContainText("Always asks you.");
    await expect(screen.getByTestId("answer-agents")).toContainText("The team suggests it in the Inbox and you decide.");
    await expect(screen).not.toContainText(/\b(hard gates?|policy|policies|caps?)\b/i);
  });

  test("an amount of 50 makes the top bar read Asks before spending over £50, with the stakes in its tooltip", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const form = settingsScreen(page).getByTestId("spend-cap-form");
    await expect(form).toBeVisible({ timeout: LONG });
    await expect(form.getByRole("radio", { name: OWN_LIMIT })).toHaveAttribute("aria-checked", "true");
    const chip = page.getByRole("button", { name: /^What the team can do: / });
    await expect(chip).toHaveAccessibleName("What the team can do: asks before spending over each agent's limit");
    try {
      await form.getByLabel("Amount per purchase").fill("50");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(toast(page, "Amount saved")).toBeVisible({ timeout: LONG });
      await expect(chip).toHaveAccessibleName("What the team can do: asks before spending over £50", { timeout: LONG });
      await expect(chip.locator("[data-chip-full]")).toHaveText("Asks before spending over £50");
      await expect(chip.locator("[data-chip-brief]")).toHaveText("Asks over £50");
      // The tooltip says the stakes and where to change them.
      const tooltip = page.getByRole("tooltip");
      await expect(async () => {
        const box = (await chip.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect(tooltip).toContainText("The team does routine work on its own. It asks you before spending over £50, before anything it can't undo and before any contract.", { timeout: 2_000 });
      }).toPass({ timeout: LONG });
      await expect(tooltip).toContainText("Change it in Settings › What the team can do.");
      await page.mouse.move(0, 0);
    } finally {
      await form.getByRole("radio", { name: OWN_LIMIT }).click();
      await form.getByRole("button", { name: "Save" }).click();
      await expect(toast(page, "Each agent's own limit applies")).toBeVisible({ timeout: LONG });
      await expect(chip).toHaveAccessibleName("What the team can do: asks before spending over each agent's limit", { timeout: LONG });
    }
  });

  test("When the team stops lists, read-only, what asks first for the answer in force and what stops on its own", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const stops = settingsScreen(page).getByTestId("team-can-do-stops");
    await expect(stops).toBeVisible({ timeout: LONG });
    await expect(stops.getByRole("heading", { name: "When the team stops" })).toBeVisible();
    // Northwind is on the second answer: a step that can't be undone and a contract ask; outside contact alone does not.
    const asks = stops.getByTestId("stops-asks");
    await expect(asks.getByTestId("stop-always_yours")).toContainText("Always comes to you. The team prepares it and never does it itself.");
    await expect(asks.getByTestId("stop-spend")).toContainText("A purchase over the agent's own limit (£250 unless you set one)");
    await expect(asks.getByTestId("stop-permanent")).toContainText("A step that can't be undone");
    await expect(asks.getByTestId("stop-contract")).toBeVisible();
    await expect(asks.getByTestId("stop-outside")).toHaveCount(0);
    await expect(asks.getByTestId("stop-release")).toContainText("Putting changes live in your product");
    await expect(asks.getByTestId("stop-credits")).toContainText("The credits run out");
    const own = stops.getByTestId("stops-own");
    await expect(own.getByTestId("stop-unsubscribed")).toContainText("The project never emails them again.");
    await expect(own.getByTestId("stop-daily_email")).toContainText("Sending waits until midnight UTC.");
    // Read-only: no control of its own.
    await expect(stops.locator("button, input, [role='radio'], [role='switch']")).toHaveCount(0);
    await expect(stops).not.toContainText(/\b(hard gates?|policy|policies|caps?)\b/i);
  });

  test("handing publishing to the Chief of Staff shows up in Team › Responsibilities", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const row = settingsScreen(page).getByTestId("answer-publish_content");
    await expect(row.getByRole("radio", { name: "Ask me" })).toHaveAttribute("aria-checked", "true", { timeout: LONG });
    try {
      await row.getByRole("radio", { name: "The Chief of Staff approves" }).click();
      await expect(toast(page, "Saved")).toBeVisible({ timeout: LONG });
      await expect(row.getByRole("radio", { name: "The Chief of Staff approves" })).toHaveAttribute("aria-checked", "true");
      await openBusiness(page, "d/team/responsibilities");
      const matrix = page.getByRole("grid", { name: "Responsibilities" });
      const publish = matrix.getByRole("row").filter({ hasText: "Publish content" });
      await expect(publish).toBeVisible({ timeout: LONG });
      await expect(publish).not.toContainText("You (founder)");
      await expect(publish.getByRole("link")).toHaveCount(1);
    } finally {
      await openBusiness(page, "settings/mode");
      const again = settingsScreen(page).getByTestId("answer-publish_content");
      await again.getByRole("radio", { name: "Ask me" }).click();
      await expect(again.getByRole("radio", { name: "Ask me" })).toHaveAttribute("aria-checked", "true", { timeout: LONG });
    }
  });

  test("payment powers: chosen with the automated answer and when a vacation starts; off by default", async ({ page }) => {
    await openBusiness(page, "settings/mode");
    const screen = settingsScreen(page);
    const answers = screen.getByRole("radiogroup", { name: "How much should the team do before checking with you?" });
    await expect(answers).toBeVisible({ timeout: LONG });
    await expect(screen.getByTestId("payment-powers")).toHaveCount(0);
    const before = await answers.getByRole("radio", { checked: true }).getAttribute("value");
    try {
      await answers.getByRole("radio", { name: /^Work and decide on its own/ }).click();
      const power = screen.getByTestId("payment-powers");
      await expect(power).toBeVisible({ timeout: LONG });
      const sw = power.getByRole("switch", { name: "Agents may create invoices and payment links without asking" });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(power).toContainText("Off, each one waits in Needs you.");
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: LONG });
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: LONG });
    } finally {
      if (before) await answers.locator(`[value="${before}"]`).click();
      await settled(page);
    }
    // The vacation dialog asks the same question, off unless the project already chose it.
    await screen.getByTestId("start-holiday").click();
    const dialog = page.getByRole("dialog");
    const box = dialog.getByRole("checkbox", { name: /Agents may create invoices and payment links without asking/ });
    await expect(box).toBeVisible({ timeout: LONG });
    await expect(box).toHaveAttribute("aria-checked", "false");
    await expect(dialog).toContainText("Nothing is ever paid out, refunded or transferred without you.");
    await page.keyboard.press("Escape");
  });

  test("nothing is cut off at 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBusiness(page, "settings/mode");
    const screen = settingsScreen(page);
    await expect(screen.getByTestId("team-can-do-answers")).toBeVisible({ timeout: LONG });
    await settled(page);
    // The page and the top bar never scroll sideways, and the chip's words fit its box at whichever step the bar is on.
    expect(await screen.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const bar = page.getByTestId("kit-bar");
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const chip = page.getByRole("button", { name: /^What the team can do: / });
    expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // Every answer card and row keeps its words inside its box.
    for (const card of await screen.locator(".radio-card, [data-testid^='answer-'], [data-testid^='stop-']").all()) {
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  });
});
