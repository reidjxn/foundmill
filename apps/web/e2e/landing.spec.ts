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
    for (const [label, id] of [["How it works", "how"], ["Departments", "departments"], ["Live sessions", "live"], ["Channels", "channels"], ["You decide", "control"]] as const) {
      await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: label }).click();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }

    // The live tiles stream once the section is on screen; the Channel Board is interactive on example data.
    await page.locator("#live").scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: "Example agent sessions" }).getByRole("group")).toHaveCount(4);
    await page.locator("#channels").scrollIntoViewIfNeeded();
    const board = page.getByRole("group", { name: "Board: active channels" });
    await expect(board.getByRole("button")).toHaveCount(4);
    await page.getByRole("button", { name: /^SEO,/ }).focus();
    await page.keyboard.press("Enter");
    await expect(board.getByRole("button")).toHaveCount(5);

    // Every way in goes to sign-in.
    await page.getByRole("banner").getByRole("link", { name: "Start your business" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
