import { expect, test } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, openBusiness, openSettings } from "./helpers";

/**
 * Settings › Integrations › "Send from your own domain" › Get a domain (WP-08 domain plan, Path A), on the mocks: look a
 * name up and see its price for a year labeled Estimate; Register opens a dialog that says the founder is the owner, asks
 * for their details and the agreement, and pays (a simulated payment here), and only a paid payment registers the domain; the records Foundmill set show,
 * MX to Foundmill's inbound and DMARC among them; forwarding to the founder's inbox goes on with their click; there is
 * no Remove. Runs on Ledgerly, since a registered domain stays with its project. Stack and commands: e2e/README.md.
 */
test.describe("Get a domain", () => {
  test("look up, see the Estimate, register as the owner, and turn forwarding on", async ({ page }) => {
    await openBusiness(page);
    const screen = await openSettings(page, "integrations", LEDGERLY_BUSINESS_ID);
    const panel = screen.getByTestId("own-domain");
    await expect(panel).toBeVisible({ timeout: LONG });
    // A run that registered already leaves the domain (it stays with the project): then only the end state is checked.
    await expect(panel.getByTestId("own-domain-form").or(panel.getByTestId("own-domain-forwarding"))).toBeVisible({ timeout: LONG });
    if (await panel.getByTestId("own-domain-form").isVisible()) {
      const get = panel.getByTestId("get-domain");
      await get.getByLabel("Name to look up").fill("google.com");
      await get.getByTestId("get-domain-look").click();
      await expect(get).toContainText("google.com is taken", { timeout: LONG });
      await get.getByLabel("Name to look up").fill("ledgerly-books.com");
      await get.getByTestId("get-domain-look").click();
      await expect(get.getByTestId("get-domain-quote")).toContainText("ledgerly-books.com", { timeout: LONG });
      await expect(get.getByTestId("get-domain-quote")).toContainText("$14.25 a year");
      await expect(get.getByTestId("get-domain-quote")).toContainText("Estimate");
      await get.getByTestId("get-domain-register").click();
      const dialog = page.getByTestId("get-domain-dialog");
      await expect(dialog).toContainText("You will be the domain's owner");
      await expect(dialog.getByTestId("get-domain-confirm")).toBeDisabled();
      for (const [label, value] of [
        ["First name", "Sam"],
        ["Last name", "Rivera"],
        ["Email", "sam@example.com"],
        ["Phone", "+1.4155550123"],
        ["Street address", "1 Market Street"],
        ["City", "San Francisco"],
        ["State or region (optional)", "CA"],
        ["ZIP or postal code", "94105"],
        ["Country (two letters)", "US"],
      ] as const)
        await dialog.getByLabel(label, { exact: true }).fill(value);
      // Not without the agreement.
      await expect(dialog.getByTestId("get-domain-confirm")).toBeDisabled();
      await dialog.getByLabel(/accept Tucows' registration agreement/).check();
      await expect(dialog.getByTestId("get-domain-price")).toContainText("Simulated here");
      await expect(dialog.getByTestId("get-domain-confirm")).toHaveText("Pay $14.25 and register");
      await dialog.getByTestId("get-domain-confirm").click();
      await expect(page.getByText("Domain registered", { exact: true })).toBeVisible({ timeout: LONG });
      await expect(panel.getByTestId("own-domain-address")).toHaveText("hello@ledgerly-books.com", { timeout: LONG });
      await panel.getByTestId("own-domain-forwarding").click();
      await expect(page.getByText("Forwarding is on", { exact: true })).toBeVisible({ timeout: LONG });
    }
    await expect(panel).toContainText("Registered in your name");
    const records = panel.getByTestId("own-domain-records");
    await expect(records).toContainText("mx.sendgrid.net");
    await expect(records).toContainText("v=DMARC1; p=none;");
    await expect(records).toContainText("For mail to your domain");
    await expect(panel.getByTestId("own-domain-remove")).toHaveCount(0);
    await expect(panel.getByTestId("own-domain-forwarding")).toHaveText("Stop forwarding to my inbox");
  });
});
