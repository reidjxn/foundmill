import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, dismissCoachmarks, settled, signIn } from "./helpers";

/**
 * "Ask <Chief of Staff>" on every page (Phase 3, part 4): one control at the right end of the tab row, beside "Explain
 * this page", with the three starter questions answered in plain words from the same facts as Today, and "Continue in
 * chat" opening the Chief of Staff's desk. The seeded Northwind Skincare has a Chief of Staff. Stack: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;
const ASK = /^Ask \S/;

async function openOn(page: Page, path: string): Promise<void> {
  await signIn(page);
  await page.goto(`${B}${path}`);
  await settled(page);
  await dismissCoachmarks(page);
}

const trigger = (page: Page) => page.getByTestId("ask-chief-trigger");

test.describe("ask the Chief of Staff", () => {
  test("shows once on Today, in the tab row beside Explain this page, named for the Chief of Staff", async ({ page }) => {
    await openOn(page, "/today");
    await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
    await expect(trigger(page)).toHaveCount(1, { timeout: LONG });
    await expect(trigger(page)).toBeVisible();
    await expect(trigger(page)).toHaveAccessibleName(ASK);
    const ask = (await trigger(page).boundingBox())!;
    expect(ask.y + ask.height).toBeLessThanOrEqual(100);
    expect(ask.x + ask.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    // Beside "Explain this page" (when the page registered one), never on top of it.
    const explain = page.getByRole("button", { name: /^Explain this page/ });
    if ((await explain.count()) > 0) {
      const e = (await explain.boundingBox())!;
      expect(ask.x + ask.width).toBeLessThanOrEqual(e.x + 1);
    }
  });

  test("shows once on an area tab, and on Needs you", async ({ page }) => {
    await openOn(page, "/d/finance/overview");
    await expect(page.getByTestId("module-screen")).toBeVisible({ timeout: LONG });
    await expect(trigger(page)).toHaveCount(1, { timeout: LONG });
    await page.goto(`${B}/inbox?tab=respond`);
    await expect(trigger(page)).toHaveCount(1, { timeout: LONG });
  });

  test("each of the three questions shows an answer in the Chief of Staff's voice, from Today's facts", async ({ page }) => {
    await openOn(page, "/today");
    await expect(trigger(page)).toBeVisible({ timeout: LONG });

    await trigger(page).click();
    const menu = page.getByTestId("ask-chief-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["What's happening?", "What's blocking us?", "Why am I seeing this?", "Ask something else…"]);

    const panel = page.getByTestId("ask-chief-panel");
    for (const question of ["What's happening?", "What's blocking us?", "Why am I seeing this?"]) {
      await menu.getByRole("menuitem", { name: question }).click();
      const answer = page.getByTestId("ask-chief-answer");
      await expect(answer).toContainText(question, { timeout: LONG });
      const text = page.getByTestId("ask-chief-text");
      await expect(text).toBeVisible({ timeout: LONG });
      const words = (await text.innerText()).replace(/\s+/g, " ").trim();
      expect(words.length).toBeGreaterThan(20);
      // Plain words: no entity markup, no ISO dates, no half-finished sentence.
      expect(words).not.toContain("[[");
      expect(words).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(words).toMatch(/[.!?]$/);
      await answer.getByRole("button", { name: "Back" }).click();
      await expect(menu).toBeVisible();
    }

    // "Why am I seeing this?" on Today: the page's purpose, then why it matters now.
    await menu.getByRole("menuitem", { name: "Why am I seeing this?" }).click();
    await expect(page.getByTestId("ask-chief-text")).toContainText(/front door|goal|needs you/i, { timeout: LONG });

    // Escape closes it and the focus goes back to the button.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("the answer on an area tab uses that tab's own purpose", async ({ page }) => {
    await openOn(page, "/d/finance/overview");
    await expect(trigger(page)).toBeVisible({ timeout: LONG });
    await trigger(page).click();
    await page.getByTestId("ask-chief-menu").getByRole("menuitem", { name: "Why am I seeing this?" }).click();
    const text = page.getByTestId("ask-chief-text");
    await expect(text).toBeVisible({ timeout: LONG });
    await expect(text).not.toContainText("front door");
  });

  test("it works from the keyboard: Enter opens it, arrows move, Enter asks", async ({ page }) => {
    await openOn(page, "/today");
    await expect(trigger(page)).toBeVisible({ timeout: LONG });
    await trigger(page).focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("ask-chief-menu");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ask-chief-answer")).toContainText("What's blocking us?");
    await expect(page.getByTestId("ask-chief-text")).toBeVisible({ timeout: LONG });
  });

  test("Continue in chat opens the Chief of Staff's desk with the question; Ask something else opens it empty", async ({ page }) => {
    await openOn(page, "/today");
    await expect(trigger(page)).toBeVisible({ timeout: LONG });
    await trigger(page).click();
    await page.getByTestId("ask-chief-menu").getByRole("menuitem", { name: "What's happening?" }).click();
    await expect(page.getByTestId("ask-chief-text")).toBeVisible({ timeout: LONG });
    await page.getByRole("button", { name: "Continue in chat" }).click();
    await expect(page.getByTestId("ask-chief-panel")).toHaveCount(0);
    const desk = page.getByTestId("agent-desk");
    await expect(desk).toBeVisible({ timeout: LONG });
    await expect(desk).toHaveAttribute("data-variant", "sheet");
    await expect(desk.getByTestId("founder-bubble").first()).toContainText("What's happening?", { timeout: LONG });
    await page.keyboard.press("Escape");
    await expect(desk).toBeHidden({ timeout: LONG });

    // Ask something else: the same conversation opens with nothing new sent (the question above is still its only founder message).
    await trigger(page).click();
    await page.getByTestId("ask-chief-menu").getByRole("menuitem", { name: "Ask something else…" }).click();
    const reopened = page.getByTestId("agent-desk");
    await expect(reopened).toBeVisible({ timeout: LONG });
    await expect(reopened.getByTestId("founder-bubble").first()).toBeVisible({ timeout: LONG });
    const before = await reopened.getByTestId("founder-bubble").count();
    await page.waitForTimeout(1500);
    expect(await reopened.getByTestId("founder-bubble").count()).toBe(before);
  });
});
