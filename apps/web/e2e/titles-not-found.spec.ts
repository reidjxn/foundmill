import { expect, test } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, settled } from "./helpers";

/**
 * Browser titles and misses inside a business (audits A11Y-15, IAE-15; WCAG 2.4.2): every screen names itself in the tab
 * ("Inbox · Northwind Skincare · Foundmill"), and an unknown settings section or agent address says what is missing
 * inside the shell instead of "No business at this address". Read-only. Stack: e2e/README.md.
 */
const B = `/b/${NORTHWIND_BUSINESS_ID}`;

test.describe("titles and misses inside a business", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("each screen has its own browser title", async ({ page }) => {
    for (const [path, title] of [
      ["today", /^Today · Northwind Skincare · /],
      ["home", /^Details · Northwind Skincare · /],
      ["inbox", /^Inbox · Northwind Skincare · /],
      ["crm", /^Contacts · Northwind Skincare · /],
      ["settings/members", /^Members · Settings · Northwind Skincare · /],
      ["settings/danger", /^Danger zone · Settings · Northwind Skincare · /],
      ["d/finance/overview", /^Overview · Finance · Northwind Skincare · /],
    ] as const) {
      await page.goto(`${B}/${path}`);
      await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
      await expect(page, path).toHaveTitle(title);
    }
  });

  test("an unknown settings tab says so, inside the business", async ({ page }) => {
    await page.goto(`${B}/settings/nope`);
    await settled(page);
    // Inside the shell's main region: a streamed page parks a second copy outside it for a moment (helpers.ts).
    const miss = page.getByTestId("shell-content").getByTestId("settings-not-found");
    await expect(miss).toBeVisible({ timeout: LONG });
    await expect(miss).toContainText("No such settings tab");
    await expect(page.getByText("No business at this address")).toHaveCount(0);
    await miss.getByRole("button", { name: "Open Business settings" }).click();
    await expect(page).toHaveURL(/\/settings\/business$/, { timeout: LONG });
  });

  test("an address that is not an agent, or not an agent tab, says so", async ({ page }) => {
    await page.goto(`${B}/agents/not-a-uuid/overview`);
    await settled(page);
    await expect(page.getByTestId("shell-content").getByTestId("agent-not-found")).toContainText("No such agent", { timeout: LONG });
    await page.goto(`${B}/agents/37d03d31-2afd-4bdd-adbf-2a82479eadf3/profile`);
    await settled(page);
    await expect(page.getByTestId("shell-content").getByTestId("agent-not-found")).toContainText("No such tab", { timeout: LONG });
    await expect(page.getByText("No business at this address")).toHaveCount(0);
  });
});
