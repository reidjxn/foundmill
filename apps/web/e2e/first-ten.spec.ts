import { expect, test } from "@playwright/test";
import { LONG, commitThrowaway, dismissCoachmarks } from "./helpers";

/**
 * Customers › First ten (WP-08 T5): ten slots; a founder adds a person they know, and writes down what the person said,
 * which moves them from "To ask" to "Talked". Nothing is sent and nothing counts anyone as behind. Stack: e2e/README.md.
 */
test.describe("first ten", () => {
  test("add a person, then record what they said", async ({ page }) => {
    test.setTimeout(240_000);
    const bid = await commitThrowaway(page, `Ten Bikes ${Date.now().toString(36)}`);
    await page.goto(`/b/${bid}/d/distribution/first-ten`);
    const screen = page.getByTestId("module-screen");
    await expect(screen).toHaveAttribute("data-module", "distribution/first-ten", { timeout: LONG });
    await dismissCoachmarks(page);
    await expect(screen).toContainText("Ten people to talk to", { timeout: LONG });
    await expect(screen.locator("[data-slot='empty']")).toHaveCount(10);

    await screen.getByLabel("Their name").fill("Sam Lee");
    await screen.getByRole("button", { name: "Add a person" }).click();
    const person = screen.locator("[data-person]");
    await expect(person).toHaveCount(1, { timeout: LONG });
    await expect(person).toHaveAttribute("data-stage", "to_ask");
    await expect(person).toContainText("Sam Lee");
    await expect(screen.locator("[data-slot='empty']")).toHaveCount(9);

    await person.getByLabel("What did they say? Sam Lee").fill("I fix my own bike, and it takes a whole Saturday.");
    await person.getByRole("button", { name: "Save" }).click();
    await expect(person.getByTestId("first-ten-words")).toHaveText("I fix my own bike, and it takes a whole Saturday.", { timeout: LONG });
    await expect(person).toHaveAttribute("data-stage", "talked");
    await expect(screen).not.toContainText(/behind|streak|cofounder/i);
  });
});
