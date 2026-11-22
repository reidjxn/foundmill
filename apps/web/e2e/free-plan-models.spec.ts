import { expect, test } from "@playwright/test";
import { LONG, commitThrowaway } from "./helpers";

/**
 * WP-13 T7 on a new project, which is on the free plan: the model dialog offers Haiku 5.5 and GLM-5.3 Flash, Opus and
 * Sonnet are grayed but selectable, and choosing one opens "Better models come with a plan" instead of selecting it.
 * "Connect your Anthropic key" goes to Settings › Keys. Desktop, 1280 px and wider.
 */
test("a free project's model dialog gates Opus and Sonnet and offers an Anthropic key", async ({ page }) => {
  const bid = await commitThrowaway(page, `Playwright models ${Date.now().toString(36)}`);
  await page.goto(`/b/${bid}/d/team/squad`);
  const link = page.locator("[data-testid=module-screen] a[href*='/agents/']").first();
  await expect(link, "a new project's team is hired at commit").toBeVisible({ timeout: LONG });
  await link.click();
  await expect(page.getByTestId("agent-profile")).toBeVisible({ timeout: LONG });

  await page.getByTestId("header-model-chip").click();
  const dialog = page.getByTestId("model-dialog");
  await expect(dialog).toBeVisible();
  const radio = (model: string) => dialog.locator(`input[type=radio][value="${model}"]`);
  await expect(radio("glm")).toBeAttached({ timeout: LONG });
  await expect(radio("haiku")).toBeAttached();
  for (const gated of ["opus", "sonnet"]) {
    await expect(dialog.locator(`label[data-gated]:has(input[value="${gated}"])`)).toHaveCount(1);
    await expect(radio(gated), "a grayed option stays selectable").toBeEnabled();
  }
  await expect(dialog.locator("label[data-gated]:has(input[value=glm]), label[data-gated]:has(input[value=haiku])")).toHaveCount(0);

  await radio("sonnet").click(); // Opus is this agent's current model, so it cannot be chosen again
  const prompt = page.getByTestId("better-models-prompt");
  await expect(prompt).toContainText("Better models come with a plan");
  await expect(page.getByTestId("apply-scope-dialog"), "nothing is selected").toBeHidden();
  await expect(prompt.getByTestId("better-models-plans")).toHaveText("See plans");

  await prompt.getByTestId("better-models-key").click();
  await page.waitForURL(new RegExp(`/b/${bid}/settings/keys`), { timeout: LONG });
});
