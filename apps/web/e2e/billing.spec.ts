import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, openSettings, settingsScreen, settled, UUID } from "./helpers";

/**
 * Settings › Billing: paying for credits (audit 2026-10-12 #22). Top up opens a checkout and grants nothing by itself;
 * on this stack (mock integrations and models) the checkout is simulated on the Billing tab, labeled, and the credits
 * arrive when the founder completes it, once. Stack and commands: e2e/README.md. The tab's own content is looked up
 * through the screen in the shell's main region (helpers.ts `settingsScreen`): React parks a second copy of a streamed
 * screen outside the shell for a moment, so a page-level locator can match twice.
 */
const BILLING = `/b/${NORTHWIND_BUSINESS_ID}/settings/billing`;
const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";

test.describe("billing", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("Billing lists four plans by name with labels true of the stage; choosing a plan and going back are one press each (WP-14 T14)", async ({ page }) => {
    const screen = await openSettings(page, "billing");
    const plans = screen.getByTestId("plans");
    await expect(plans.locator("[data-tier]")).toHaveCount(4, { timeout: LONG });
    for (const [tier, name] of [["free", "Try"], ["pro", "Founder"], ["scale", "Studio"], ["partner", "Partner"]] as const) await expect(plans.locator(`[data-tier=${tier}]`)).toContainText(name);
    // While sign-up is invite-only every plan that can be held reads the same, and nothing says it stays free.
    for (const tier of ["free", "pro", "scale"]) await expect(plans.locator(`[data-tier=${tier}]`).getByTestId("plan-price")).toHaveText("Free while in early access");
    await expect(screen).toContainText("Free while in early access. Founders invited now keep it free for good.");
    await expect(screen).not.toContainText(/Price to be announced|to be announced|always free|free forever|\bseats?\b/i);
    // What each plan holds and adds, from config.
    await expect(plans.locator("[data-tier=free]")).toContainText("1 project");
    await expect(plans.locator("[data-tier=pro]")).toContainText("Up to 5 projects");
    await expect(plans.locator("[data-tier=pro]")).toContainText("$10.00 of credits a month");
    await expect(plans.locator("[data-tier=pro]")).toContainText("Vacation mode, Card sharing, Named agents, The phone Inbox");
    await expect(plans.locator("[data-tier=scale]")).toContainText("Any number of projects");
    await expect(plans.locator("[data-tier=scale]")).toContainText("More agents at once");
    // Partner: by application, its price shows, and its only action is the waitlist. No checkout opens.
    const partner = plans.locator("[data-tier=partner]");
    await expect(partner).toContainText("By application");
    await expect(partner.getByTestId("plan-price")).toHaveText("$250 / month");
    await expect(partner).toContainText("experienced venture-backed founders and venture capital investors");
    await expect(partner.getByRole("button", { name: /Choose/ })).toHaveCount(0);

    // Seeded Northwind is on Founder. Going back to Try (canceling) is one press, and so is choosing Founder again:
    // canceling takes no more steps than subscribing, and neither opens a checkout on this stack.
    await expect(screen.getByTestId("current-plan")).toContainText("Founder");
    await plans.locator("[data-tier=free]").getByRole("button", { name: "Choose Try" }).click();
    await expect(screen.getByTestId("current-plan")).toContainText("Try", { timeout: LONG });
    await expect(page).not.toHaveURL(/checkout=/);
    await plans.locator("[data-tier=pro]").getByRole("button", { name: "Choose Founder" }).click();
    await expect(screen.getByTestId("current-plan")).toContainText("Founder", { timeout: LONG });
    await expect(page).not.toHaveURL(/checkout=/);
  });

  test("Join the Partner waitlist needs consent, records it once and charges nothing (WP-14 T14)", async ({ page }) => {
    const screen = await openSettings(page, "billing", LEDGERLY_BUSINESS_ID);
    const partner = screen.locator("[data-tier=partner]");
    await expect(partner).toBeVisible({ timeout: LONG });
    const join = partner.getByTestId("partner-join");
    // A retry finds the project already on the list: joining is once.
    if (await join.isVisible()) {
      await expect(join).toHaveText("Join the Partner waitlist");
      await expect(join).toBeDisabled();
      await partner.getByRole("checkbox", { name: "Agree to be contacted about the Partner plan" }).click();
      await join.click();
    }
    await expect(partner.getByTestId("partner-joined")).toHaveText("On the Partner waitlist", { timeout: LONG });
    await expect(join).toHaveCount(0);
    await expect(page).not.toHaveURL(/checkout=/);
    await expect(screen.getByTestId("checkout-panel")).toHaveCount(0);
  });

  test("Top up opens a mock checkout; completing it adds the credits once, labeled", async ({ page }) => {
    const screen = await openSettings(page, "billing");
    const topUp = screen.getByTestId("top-up");
    await expect(topUp).toBeEnabled({ timeout: LONG });
    // Credits are US dollars.
    await expect(screen.getByRole("combobox", { name: "Top-up amount" })).toContainText("$10.00");
    await expect(screen).toContainText("This server simulates payments");
    // Paid entry is off on this stack (as in production until sign-up opens): no entry plan is offered (WP-09 T16).
    await expect(screen.getByTestId("entry-plan")).toHaveCount(0);
    // "Credits" is defined where the founder first meets it, on the panel's title (a dotted word with guidance on).
    await expect(screen.locator('[data-term="credits"]').first()).toBeVisible();

    await topUp.click();
    await expect(page).toHaveURL(new RegExp(`${BILLING}\\?checkout=${UUID}$`), { timeout: LONG });
    const panel = screen.getByTestId("checkout-panel");
    await expect(panel).toHaveAttribute("data-status", "open");
    await expect(panel).toContainText("Mock checkout");
    await expect(panel).toContainText("no money moves");

    await panel.getByRole("button", { name: /^Complete mock payment of \$10\.00$/ }).click();
    await expect(panel).toHaveAttribute("data-status", "paid", { timeout: LONG });
    await expect(panel).toContainText("$10.00 in credits added. Mock top-up: no money moved.");
    await expect(panel.getByRole("button", { name: /Complete mock payment/ })).toHaveCount(0);

    // A reload of the same address shows the checkout paid; nothing is offered twice.
    await page.reload();
    await settled(page);
    await expect(screen.getByTestId("checkout-panel")).toHaveAttribute("data-status", "paid", { timeout: LONG });
    // Seeded Northwind has no finished cycle, so with guidance on the first-Continue callout (UX plan §7.7) sits under
    // Continue in the top bar, over the panel's top-right close button. It is not modal and stays until "Got it", which
    // marks the tour done for the whole dev account (first-days.spec.ts still expects it), so the close button is
    // pressed from the keyboard instead of a pointer click through the callout's card.
    const close = screen.getByRole("button", { name: "Close the checkout panel" });
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${BILLING}$`));
    await expect(screen.getByTestId("checkout-panel")).toHaveCount(0);
  });

  test("A business on credits shows the credits that pay for its platform-key work (SEC2)", async ({ page }) => {
    // Ledgerly is seeded on credits like Northwind (audit #95: no credential-less own-key integration), so its agents and
    // its conversations, Refresh and planning all run on Foundmill's key; the own-key wording belongs to a business that
    // has connected a key (apps/api and apps/web unit tests cover that copy).
    const screen = await openSettings(page, "billing", LEDGERLY_BUSINESS_ID);
    await expect(screen.getByTestId("credits-balance")).toContainText(/\$[\d,]+\.\d{2} left of \$/, { timeout: LONG });
    await expect(screen).not.toContainText("Your agents run on your own Anthropic key");
    await expect(screen).not.toContainText("Not used: your own key pays for model calls");
  });

  test("Coming back from a canceled checkout says nothing was charged", async ({ page }) => {
    const screen = await openSettings(page, "billing");
    await screen.getByTestId("top-up").click();
    await expect(page).toHaveURL(new RegExp(`checkout=${UUID}`), { timeout: LONG });
    await page.goto(`${page.url()}&canceled=1`);
    await settled(page);
    const panel = settingsScreen(page).getByTestId("checkout-panel");
    await expect(panel).toContainText("Checkout canceled: nothing was charged.", { timeout: LONG });
    await expect(panel.getByRole("button", { name: /Complete mock payment/ })).toHaveCount(0);
  });
});
