import { expect, test } from "@playwright/test";
import { LONG, openBusiness, openSettings } from "./helpers";

/**
 * Settings › Integrations › "Send from your own domain" (WP-08 domain plan, Path B): the founder types a domain they
 * already own and the name mail goes as there; the panel lists the project's ownership TXT and SendGrid's three CNAMEs (and the site's record when the
 * project has a site) with copy buttons; "Check now" finds them and mail goes from the domain. SendGrid is mock on the
 * stack (no gateway): a domain with "notyet" in it is never found, so the "Not found yet" lines show too. The spec
 * removes what it added, so the seeded project is left as it was. Stack and commands: e2e/README.md.
 */
test.describe("Send from your own domain", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("add a domain, see its records, check it and send from it; then remove it", async ({ page }) => {
    const screen = await openSettings(page, "integrations");
    const panel = screen.getByTestId("own-domain");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("Send from your own domain");
    // A run that stopped halfway leaves its domain behind: start from none.
    await expect(panel.getByTestId("own-domain-form").or(panel.getByTestId("own-domain-remove"))).toBeVisible({ timeout: LONG });
    if (await panel.getByTestId("own-domain-remove").isVisible()) await panel.getByTestId("own-domain-remove").click();
    await expect(panel.getByTestId("own-domain-form")).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("nothing you receive there changes");
    // Not a domain: refused in plain words, nothing added.
    await panel.getByLabel("Your domain").fill("not a domain");
    await panel.getByTestId("own-domain-add").click();
    await expect(page.getByText("Enter a domain you own, like acme.com.").first()).toBeVisible({ timeout: LONG });
    await expect(panel.getByTestId("own-domain-records")).toHaveCount(0);

    await panel.getByLabel("Name").fill("maya");
    await panel.getByLabel("Your domain").fill("https://www.Northwind-Notyet.com/");
    await panel.getByTestId("own-domain-add").click();
    await expect(panel.getByTestId("own-domain-address")).toHaveText("maya@northwind-notyet.com", { timeout: LONG });
    await expect(panel).toContainText("Waiting for records");
    // The project's own ownership record first, then SendGrid's three.
    await expect(panel.getByTestId("own-domain-record").first()).toContainText("_foundmill.northwind-notyet.com");
    await expect(panel.getByTestId("own-domain-records")).toContainText("em.northwind-notyet.com");
    await expect(panel.getByTestId("own-domain-records")).toContainText("s1._domainkey.northwind-notyet.com");
    await expect(panel.getByTestId("own-domain-records")).toContainText("Not checked yet");
    await expect(panel).toContainText("simulated here");

    await panel.getByTestId("own-domain-check").click();
    await expect(page.getByText("Not every record is there yet", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(panel.getByTestId("own-domain-record-check").first()).toHaveText("Not found yet.");

    // Another domain replaces it; this one is found on the first check.
    await panel.getByTestId("own-domain-remove").click();
    await expect(panel.getByTestId("own-domain-form")).toBeVisible({ timeout: LONG });
    await panel.getByLabel("Name").fill("hello");
    await panel.getByLabel("Your domain").fill("northwind-goods.com");
    await panel.getByTestId("own-domain-add").click();
    await expect(panel.getByTestId("own-domain-address")).toHaveText("hello@northwind-goods.com", { timeout: LONG });
    await panel.getByTestId("own-domain-check").click();
    await expect(page.getByText("Your domain is ready", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(panel).toContainText("Sending from it");
    await expect(panel.getByTestId("own-domain-record-check").first()).toHaveText("Found");
    // Kept after a reload.
    await page.reload();
    await expect(screen.getByTestId("own-domain-address")).toHaveText("hello@northwind-goods.com", { timeout: LONG });

    await screen.getByTestId("own-domain-remove").click();
    await expect(page.getByText("Domain removed", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(screen.getByTestId("own-domain-form")).toBeVisible();
  });
});
