import { expect, test, type Page } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, NORTHWIND_BUSINESS_ID, commitThrowaway, openBusiness, openSwitcher, settled } from "./helpers";

/**
 * Multiple businesses (founder, 2026-10-16): the top bar's Switch business lists every business the founder belongs to
 * and opens another one's Home with no frame that mixes two businesses, remembering it as the last business; Create a
 * new business reaches the two doors with the way back; Your businesses (/businesses) lists every business with its
 * role, plan, modes and created date, and opens one. The dev founder owns Northwind Skincare and Ledgerly (seed); the
 * Commit specs add more, so nothing here assumes a count. Stack and commands: e2e/README.md.
 */

/** Records every [top bar name, shell business id] pair the page shows, from now on. */
async function watchShellPairs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __pairs: [string, string][] };
    w.__pairs = [];
    const record = () => w.__pairs.push([document.querySelector("[data-testid=kitbar-business-name]")?.textContent ?? "", document.querySelector("[data-testid=app-shell]")?.getAttribute("data-business-id") ?? ""]);
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-business-id"] });
  });
}

test.describe("switch business and Your businesses", () => {
  test("the top bar's Switch business lists every business and opens Ledgerly's Home with no frame of Northwind", async ({ page }) => {
    await openBusiness(page);
    const trigger = page.getByRole("button", { name: /^Switch business/ });
    await expect(trigger).toContainText("Northwind Skincare");
    await trigger.hover();
    await expect(page.getByRole("tooltip")).toContainText("Switch business", { timeout: LONG });

    await watchShellPairs(page);
    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole("option", { name: /Northwind Skincare/ })).toContainText("Current business");
    await expect(switcher.getByRole("option", { name: /Ledgerly/ })).toBeVisible({ timeout: LONG });
    for (const action of ["Create a new business", "Manage businesses", "Home", "Your profile"]) await expect(switcher.getByRole("option", { name: new RegExp(`^${action}$`) })).toBeVisible();

    await switcher.getByRole("option", { name: /Ledgerly/ }).click();
    await page.waitForURL(new RegExp(`/b/${LEDGERLY_BUSINESS_ID}/home$`), { timeout: LONG });
    await expect(page.getByTestId("kitbar-business-name")).toHaveText("Ledgerly", { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-business-id", LEDGERLY_BUSINESS_ID);

    // Every frame shows one business: its name with its own shell, never one business's name over the other's.
    const pairs = (await page.evaluate(() => (window as unknown as { __pairs: [string, string][] }).__pairs)).filter(([name, bid]) => name && bid);
    const owner: Record<string, string> = { "Northwind Skincare": NORTHWIND_BUSINESS_ID, Ledgerly: LEDGERLY_BUSINESS_ID };
    for (const [name, bid] of pairs) expect(owner[name], `${name} shown over ${bid}`).toBe(bid);
    const firstLedgerly = pairs.findIndex(([name]) => name === "Ledgerly");
    expect(pairs.slice(Math.max(firstLedgerly, 0)).some(([name]) => name === "Northwind Skincare")).toBe(false);

    // Remembered as the last business: `/` opens it next time.
    const cookie = (await page.context().cookies()).find((c) => c.name === "fm_last_business");
    expect(cookie?.value).toBe(LEDGERLY_BUSINESS_ID);
    await page.goto("/");
    await page.waitForURL(new RegExp(`/b/${LEDGERLY_BUSINESS_ID}/home`), { timeout: LONG });
  });

  test("Create a new business opens the doors, with the way back to the business it came from", async ({ page }) => {
    await openBusiness(page);
    const switcher = await openSwitcher(page);
    await switcher.getByRole("option", { name: /^Create a new business$/ }).click();
    await page.waitForURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create a new business");
    await expect(page.getByTestId("door-ideate")).toBeVisible();
    await expect(page.getByTestId("door-import")).toBeVisible();
    await page.getByRole("link", { name: "Back to Northwind Skincare" }).click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
  });

  test("Your businesses lists every business with role, plan, mode and created date, and opens one", async ({ page }) => {
    await openBusiness(page);
    const switcher = await openSwitcher(page);
    await switcher.getByRole("option", { name: /^Manage businesses$/ }).click();
    await page.waitForURL(/\/businesses$/, { timeout: LONG });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your businesses");

    const northwind = page.locator(`[data-business-row="${NORTHWIND_BUSINESS_ID}"]`);
    await expect(northwind).toBeVisible({ timeout: LONG });
    for (const text of ["Northwind Skincare", "Owner", "Demo", "Pro plan", "Last opened"]) await expect(northwind).toContainText(text);
    await expect(northwind).toContainText(/(Augmented|Assisted|Automated)/);
    await expect(northwind).toContainText(/(LIVE|Personal)/);
    await expect(northwind).toContainText(/Created [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(northwind.getByRole("link", { name: "Settings of Northwind Skincare" })).toHaveAttribute("href", `/b/${NORTHWIND_BUSINESS_ID}/settings/business`);
    await expect(page.locator(`[data-business-row="${LEDGERLY_BUSINESS_ID}"]`)).toContainText("Scale plan");
    await expect(page.getByTestId("businesses-create")).toHaveAttribute("href", "/new");

    await page.getByRole("link", { name: "Open Ledgerly" }).click();
    await page.waitForURL(new RegExp(`/b/${LEDGERLY_BUSINESS_ID}/home$`), { timeout: LONG });
    await expect(page.getByTestId("kitbar-business-name")).toHaveText("Ledgerly", { timeout: LONG });
  });

  test("a business you take charge of opens and appears in the switcher", async ({ page }) => {
    test.setTimeout(240_000);
    const name = `Switch ${Date.now().toString(36)}`;
    const bid = await commitThrowaway(page, name);
    await expect(page.getByTestId("kitbar-business-name")).toHaveText(name, { timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await settled(page);
    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole("option", { name: new RegExp(name) })).toContainText("Current business");
    await expect(switcher.locator(`[data-business-id="${bid}"]`)).toHaveAttribute("data-current", "true");
    await expect(switcher.getByRole("option", { name: /Northwind Skincare/ })).toBeVisible({ timeout: LONG });
    await switcher.getByRole("option", { name: /Northwind Skincare/ }).click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
  });
});
