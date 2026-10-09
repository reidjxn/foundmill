import { expect, test } from "@playwright/test";

/**
 * The signed-out landing page at `/` (it needs no api and no session). Runs in a fresh browser context, so the dev
 * auth cookie of the other specs is not present.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("landing page", () => {
  test("explains the product, links every call to action to sign-in, and shows the live parts", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Build a real business with a team of AI agents.");
    await expect(page.getByRole("img", { name: /Your team: you at the centre/ })).toBeVisible();

    // The header is anchored by the Foundmill wordmark alone; the FM monogram is the favicon only.
    const home = page.getByRole("banner").getByRole("link", { name: "Foundmill home" });
    await expect(home).toBeVisible();
    await expect(home.locator("svg")).toHaveCount(1);
    expect((await home.locator("svg").boundingBox())!.height).toBe(20);
    await expect(page.locator("svg[data-variant]")).toHaveCount(0);

    // Section nav scrolls to each section.
    for (const [label, id] of [["Why now", "why"], ["How it works", "how"], ["Your team", "team"], ["Live sessions", "live"], ["Journey", "journey"], ["You decide", "control"]] as const) {
      await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: label }).click();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }

    // The team: each department's lead, with their attribute ratings.
    await page.locator("#team").scrollIntoViewIfNeeded();
    const departments = page.getByRole("tablist", { name: "Departments" });
    await departments.getByRole("tab", { name: /Finance/ }).click();
    await expect(departments.getByRole("tab", { name: /Finance/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#team-panel").getByText("Finance lead")).toBeVisible();
    await expect(page.getByRole("list", { name: "Finance screens" })).toBeVisible();

    // The live tiles stream once the section is on screen; the Journey draws; the Channel Board is interactive.
    await page.locator("#live").scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: "Example agent sessions" }).getByRole("group")).toHaveCount(4);
    await page.locator("#journey").scrollIntoViewIfNeeded();
    await expect(page.locator("[aria-roledescription='journey ribbon']")).toBeVisible();
    await expect(page.getByRole("region", { name: "Customer Update" })).toBeVisible();
    await page.locator("#channels").scrollIntoViewIfNeeded();
    const board = page.getByRole("group", { name: "Board: active channels" });
    await expect(board.getByRole("button")).toHaveCount(4);
    // Social media is off the board for the example business; putting it on adds a fifth running channel.
    await page.getByRole("button", { name: /^Social media,/ }).focus();
    await page.keyboard.press("Enter");
    await expect(board.getByRole("button")).toHaveCount(5);

    // Every way in goes to sign-in.
    await page.getByRole("banner").getByRole("link", { name: "Start your business" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the hero deck runs a cycle: a decision comes back, then a customer", async ({ page }) => {
    await page.goto("/");
    const deck = page.getByTestId("cycle-deck");
    // The first cycle runs on its own and comes back with a decision; Continue waits for the founder.
    await expect(deck).toHaveAttribute("data-phase", "decision", { timeout: 15_000 });
    await expect(deck.getByRole("button", { name: /Respond to 1 item/ })).toBeVisible();
    await page.getByTestId("deck-decision").getByRole("button", { name: "Merge" }).click();
    await expect(deck.getByText("Photo marking merged to production")).toBeVisible();

    // Pressing Continue runs the next cycle, which brings a customer; the gold card opens the Journey.
    await deck.getByRole("button", { name: "Continue" }).click();
    await expect(deck).toHaveAttribute("data-phase", "processing");
    await expect(page.getByTestId("deck-win")).toBeVisible({ timeout: 15_000 });
    await expect(deck.getByRole("button", { name: /Go to Journey/ })).toBeVisible();
    await page.getByTestId("deck-win").getByRole("button", { name: /See the Customer Update/ }).click();
    await expect(page.locator("#journey")).toBeInViewport();
    await expect(page.locator("#journey-title")).toBeFocused();
    await expect(deck).toHaveAttribute("data-phase", "idle");
    // The update it opens is about the same customer.
    await expect(page.getByRole("region", { name: "Customer Update" }).getByText("Okafor Maths Tuition").first()).toBeVisible();
  });
});
