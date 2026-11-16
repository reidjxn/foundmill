import { expect, test } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks, settled } from "./helpers";

/**
 * The project's positioning notes on Product › Vision (WP-08 T1), on the mock model. A throwaway project asks the team
 * for a draft; the panel says it waits for the founder and that the team writes from their own words until then. The
 * owner fixes the one line and approves; the panel shows version 1. Stack and commands: e2e/README.md.
 */
test.describe("positioning notes", () => {
  test("the team drafts them, the founder approves them", async ({ page }) => {
    test.setTimeout(240_000);
    const bid = await commitThrowaway(page, `Notes Loaf ${Date.now().toString(36)}`);
    await page.goto(`/b/${bid}/d/product/vision`);
    await settled(page);
    await dismissCoachmarks(page);
    const panel = page.getByTestId("positioning-panel");
    await expect(panel).toBeVisible({ timeout: LONG });

    // A project that has no notes yet offers the draft (the in-process foundations of the e2e stack write none).
    const ask = panel.getByTestId("positioning-ask");
    await expect(ask).toBeVisible({ timeout: LONG });
    await ask.click();
    await expect(panel.getByText("Waiting for you to approve")).toBeVisible({ timeout: LONG });
    await expect(panel.getByText("Until you approve these notes, the team writes from your own words only.")).toBeVisible();

    await panel.getByLabel("One line").fill("A fresh sourdough loaf on your porch every Saturday.");
    await panel.getByTestId("positioning-approve").click();
    await expect(panel.getByText(/Approved, version 1/)).toBeVisible({ timeout: LONG });
  });
});
