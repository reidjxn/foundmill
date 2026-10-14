import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, UUID } from "./helpers";

/**
 * Settings › Billing: paying for credits (audit 2026-10-12 #22). Top up opens a checkout and grants nothing by itself;
 * on this stack (mock integrations and models) the checkout is simulated on the Billing tab, labeled, and the credits
 * arrive when the founder completes it, once. Stack and commands: e2e/README.md.
 */
const BILLING = `/b/${NORTHWIND_BUSINESS_ID}/settings/billing`;
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

test.describe("billing", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("Top up opens a mock checkout; completing it adds the credits once, labeled", async ({ page }) => {
    await page.goto(BILLING);
    const screen = page.getByTestId("settings-screen");
    const topUp = page.getByTestId("top-up");
    await expect(topUp).toBeEnabled({ timeout: LONG });
    // Credits are US dollars.
    await expect(page.getByRole("combobox", { name: "Top-up amount" })).toContainText("$50.00");
    await expect(screen).toContainText("This server simulates payments");

    await topUp.click();
    await expect(page).toHaveURL(new RegExp(`${BILLING}\\?checkout=${UUID}$`), { timeout: LONG });
    const panel = page.getByTestId("checkout-panel");
    await expect(panel).toHaveAttribute("data-status", "open");
    await expect(panel).toContainText("Mock checkout");
    await expect(panel).toContainText("no money moves");

    await panel.getByRole("button", { name: /^Complete mock payment of \$50\.00$/ }).click();
    await expect(panel).toHaveAttribute("data-status", "paid", { timeout: LONG });
    await expect(panel).toContainText("$50.00 in credits added. Mock top-up: no money moved.");
    await expect(panel.getByRole("button", { name: /Complete mock payment/ })).toHaveCount(0);

    // A reload of the same address shows the checkout paid; nothing is offered twice.
    await page.reload();
    await expect(page.getByTestId("checkout-panel")).toHaveAttribute("data-status", "paid", { timeout: LONG });
    await page.getByRole("button", { name: "Close the checkout panel" }).click();
    await expect(page).toHaveURL(new RegExp(`${BILLING}$`));
    await expect(page.getByTestId("checkout-panel")).toHaveCount(0);
  });

  test("A business on credits shows the credits that pay for its platform-key work (SEC2)", async ({ page }) => {
    // Ledgerly is seeded on credits like Northwind (audit #95: no credential-less own-key integration), so its agents and
    // its conversations, Refresh and planning all run on Foundmill's key; the own-key wording belongs to a business that
    // has connected a key (apps/api and apps/web unit tests cover that copy).
    await page.goto(`/b/${LEDGERLY_BUSINESS_ID}/settings/billing`);
    const screen = page.getByTestId("settings-screen");
    await expect(page.getByTestId("credits-balance")).toContainText(/\$[\d,]+\.\d{2} left of \$/, { timeout: LONG });
    await expect(screen).not.toContainText("Your agents run on your own Anthropic key");
    await expect(screen).not.toContainText("Not used: your own key pays for model calls");
  });

  test("Coming back from a canceled checkout says nothing was charged", async ({ page }) => {
    await page.goto(BILLING);
    await page.getByTestId("top-up").click();
    await expect(page).toHaveURL(new RegExp(`checkout=${UUID}`), { timeout: LONG });
    await page.goto(`${page.url()}&canceled=1`);
    const panel = page.getByTestId("checkout-panel");
    await expect(panel).toContainText("Checkout canceled: nothing was charged.", { timeout: LONG });
    await expect(panel.getByRole("button", { name: /Complete mock payment/ })).toHaveCount(0);
  });
});
