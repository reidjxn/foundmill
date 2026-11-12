import { expect, test } from "@playwright/test";
import { LONG, openBusiness, openSettings } from "./helpers";

/**
 * Settings › Integrations › "Email from your project" (docs/THESIS_REVIEW.md package 1.5): the project's Foundmill
 * sending address, today's count against its cap, and the line about outside contact. The stack runs with
 * PLATFORM_MAIL_DOMAIN set and SendGrid mock (playwright.config.ts STACK_ENV, CI's e2e env), so the row is there and says
 * sending is simulated. Read-only: nothing is sent. Stack and commands: e2e/README.md.
 */
test.describe("Email from your project", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("shows the address, today's count against the cap, the approval line and that sending is simulated", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const row = screen.getByTestId("platform-mail");
    await expect(row).toBeVisible({ timeout: LONG });
    await expect(row).toContainText("Email from your project");
    await expect(row.getByTestId("platform-mail-address")).toHaveText(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]@mail\.foundmill\.test$/);
    await expect(row.getByTestId("platform-mail-count")).toHaveText(/^\d[\d,]* of \d[\d,]* sent today$/);
    await expect(row).toContainText("Messages to people outside the project wait for your OK unless you said otherwise in What the team can do.");
    await expect(row).toContainText("Sending is simulated here: no message leaves for real.");
    // The address is chosen once and kept: a reload shows the same one.
    const address = await row.getByTestId("platform-mail-address").textContent();
    await page.reload();
    await expect(screen.getByTestId("platform-mail-address")).toHaveText(address ?? "", { timeout: LONG });
  });

  test("with the feature off there is no row at all", async ({ page }) => {
    // The same answer the api gives when PLATFORM_MAIL_DOMAIN is unset (integrations.platformMail → null).
    await page.route(/\/trpc\/[^?]*integrations\.platformMail/, async (route) => {
      const response = await route.fetch();
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = (await response.json()) as { result?: { data?: { json?: unknown } } }[];
      const at = procedures.indexOf("integrations.platformMail");
      if (body[at]?.result?.data) body[at]!.result!.data!.json = null;
      await route.fulfill({ response, json: body });
    });
    const screen = await openSettings(page, "integrations");
    await expect(screen.getByTestId("connector-list")).toBeVisible({ timeout: LONG });
    await expect(screen.getByTestId("platform-mail")).toHaveCount(0);
  });
});
