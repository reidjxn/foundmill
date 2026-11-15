import { expect, test } from "@playwright/test";
import { LONG, openBusiness, openSettings } from "./helpers";

/**
 * Settings › Integrations › "Email from your project" (docs/THESIS_REVIEW.md package 1.5): the project's Foundmill
 * sending address, today's count against its cap, and the line about outside contact. The stack runs with
 * PLATFORM_MAIL_DOMAIN set and SendGrid mock (playwright.config.ts STACK_ENV, CI's e2e env), so the row is there and says
 * sending is simulated. Nothing is sent. The founders' postal address for marketing email (US CAN-SPAM) is entered
 * here: the field says why the law asks for it and that a PO box is fine, refuses what is not an address, and keeps
 * what was saved. Stack and commands: e2e/README.md.
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

  test("the founder adds the postal address for marketing email: why it is asked, a PO box is fine, and it is kept", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const field = screen.getByTestId("postal-address");
    await expect(field).toBeVisible({ timeout: LONG });
    await expect(field).toContainText("Postal address for your emails");
    await expect(field).toContainText("By law in the US, every marketing email must show the sender's postal address");
    await expect(field).toContainText("A PO box is fine.");
    await expect(field).toContainText("It is never shown on your public page");
    const input = field.getByLabel("Postal address for your emails");
    // Not an address: refused in plain words before anything is saved.
    await input.fill("www.example.com 12");
    await expect(field).toContainText("Enter a postal address, not a web or email address.");
    await expect(field.getByTestId("postal-address-save")).toBeDisabled();
    // A PO box, saved, and kept after a reload as one tidy line.
    await input.fill("PO Box 1234, Springfield, IL 62701, USA");
    await field.getByTestId("postal-address-save").click();
    await expect(page.getByText("Postal address saved", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(field.getByTestId("postal-address-missing")).toHaveCount(0);
    await page.reload();
    await expect(screen.getByTestId("postal-address").getByLabel("Postal address for your emails")).toHaveValue("PO Box 1234, Springfield, IL 62701, USA", { timeout: LONG });
    await expect(screen.getByTestId("postal-address-save")).toBeDisabled();
  });

  test("without an address the field says marketing email waits for it", async ({ page }) => {
    await page.route(/\/trpc\/[^?]*integrations\.platformMail/, async (route) => {
      const response = await route.fetch();
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = (await response.json()) as { result?: { data?: { json?: Record<string, unknown> | null } } }[];
      const at = procedures.indexOf("integrations.platformMail");
      const json = body[at]?.result?.data?.json;
      if (json) json.postalAddress = null;
      await route.fulfill({ response, json: body });
    });
    const screen = await openSettings(page, "integrations");
    const field = screen.getByTestId("postal-address");
    await expect(field).toBeVisible({ timeout: LONG });
    await expect(field.getByTestId("postal-address-missing")).toHaveText("Until you add it, the team cannot send marketing emails from this address.");
    await expect(field.getByTestId("postal-address-save")).toHaveText("Add address");
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
