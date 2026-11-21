import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, openBusiness, openExplainer } from "./helpers";

/**
 * Finance and Legal fixes (audit W03), on the seeded Northwind Skincare: typing in the Runway drivers keeps what was
 * typed, the Cash "This month" view lists the month's rows, "Renew consent" lands on the connector's row, the
 * regulated-sector choices survive a reload, an unpublished policy can be published, and choosing an incorporation
 * route fills in what it forms. Stack: e2e/README.md. (Written against the seed; run with the rest of the Playwright
 * suite in CI.)
 */
const D = `/b/${NORTHWIND_BUSINESS_ID}/d`;

async function openTab(page: Page, dept: "finance" | "legal", tab: string): Promise<void> {
  await page.goto(`${D}/${dept}/${tab}`);
  const screen = page.getByTestId("module-screen");
  await expect(screen).toBeVisible({ timeout: LONG });
  await expect(screen).toHaveAttribute("data-module", `${dept}/${tab}`);
  await expect(screen.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: LONG });
}

test.describe("finance fixes", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("runway: a driver field keeps what is typed (2.5, 18 and 1500.50 stay as typed)", async ({ page }) => {
    await openTab(page, "finance", "runway");
    const form = page.getByRole("form", { name: "Base drivers" });
    const growth = form.getByLabel("Revenue growth");
    await growth.fill("");
    await growth.pressSequentially("2.5");
    await expect(growth).toHaveValue("2.5");
    const horizon = form.getByLabel("Horizon");
    await horizon.fill("");
    await horizon.pressSequentially("18");
    await expect(horizon).toHaveValue("18");
    const cash = form.getByLabel("Starting cash");
    await cash.fill("");
    await cash.pressSequentially("1500.50");
    await expect(cash).toHaveValue("1500.50");
    // nothing is saved by typing; Reset puts the stored drivers back
    await form.getByRole("button", { name: "Reset" }).click();
    await expect(growth).not.toHaveValue("2.5");
  });

  test("runway: the scenario sentence is built from the drivers", async ({ page }) => {
    await openTab(page, "finance", "runway");
    const form = page.getByRole("form", { name: "Base drivers" });
    await form.getByLabel("Revenue growth").fill("7");
    await expect(page.getByText(/revenue up 7% and costs up \d+(\.\d)?% a month, over \d+ months/)).toBeVisible();
  });

  test("cash: the This month view lists this month's transactions", async ({ page }) => {
    // The seed books its first transactions of a month on the 3rd, so on the 1st and 2nd "this month" is rightly empty
    // (Nov 1, 2026). The browser's "this month" is pinned to the 20th of last month, which the seed always covers.
    const now = new Date();
    await page.clock.setFixedTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 20, 12)));
    await openTab(page, "finance", "cash");
    // The table opens on whichever view is current (Simple while guidance is on, UX plan §7.10); pick This month from it.
    await page.getByRole("button", { name: /^View: / }).click();
    await page.getByRole("menuitemradio", { name: /This month/ }).click();
    await expect(page.getByRole("button", { name: /^View: This month/ })).toBeVisible();
    await expect(page.getByText("No rows match these filters")).toHaveCount(0);
    await expect(page.getByRole("grid", { name: "Transactions" }).getByRole("row")).not.toHaveCount(1);
  });

  test("cash: Renew consent lands on that connector's row, which offers to renew in place", async ({ page }) => {
    await openTab(page, "finance", "cash");
    const renew = page.getByRole("button", { name: /Renew consent/ }).first();
    test.skip((await renew.count()) === 0, "no bank consent is lapsing on the seed today");
    await renew.click();
    await expect(page).toHaveURL(/\/settings\/integrations\?connector=/);
    const row = page.locator("[data-connector][aria-current='true']");
    await expect(row).toBeVisible({ timeout: LONG });
    await expect(row.getByRole("button", { name: /Renew consent|Reconnect/ })).toBeVisible();
    await expect(row.getByRole("button", { name: /Disconnect/ })).toBeVisible();
  });

  test("cap table: SAFEs are not shares, prices carry the business's currency and the register names holder kinds in words", async ({ page }) => {
    await openTab(page, "finance", "cap-table");
    const text = await page.getByTestId("module-screen").innerText();
    expect(text).not.toContain("€");
    expect(text).not.toMatch(/\b(team_member|organisation)\b/);
    // Guidance on (the product default): the tab's intro says who owns what, inside the Holders panel (UX plan §7.14),
    // and SAFE is a defined word wherever the screen first says it.
    const holders = page.getByRole("region", { name: "Holders" });
    await expect(await openExplainer(page, "finance/cap-table")).toContainText("Who owns what share of the company.");
    await expect(page.locator("[data-term='safe']").first()).toBeVisible();
    for (const row of await page.getByRole("grid", { name: "Holders" }).getByRole("row").all()) {
      const cells = (await row.innerText()).toLowerCase();
      // a holder of SAFEs alone has no percentage: it says it has not converted
      if (cells.includes("safe") && !cells.includes("ordinary")) expect(cells).toContain("not converted");
    }
  });
});

test.describe("legal fixes", () => {
  test.beforeEach(async ({ page }) => {
    await openBusiness(page);
  });

  test("incorporate: choosing a route fills in the jurisdiction and entity type it forms", async ({ page }) => {
    await openTab(page, "legal", "incorporate");
    const form = page.getByRole("form", { name: "Incorporation route" });
    test.skip((await form.getByRole("radio").first().isDisabled()), "an incorporation is already in flight on this seed");
    await form.getByRole("radio", { name: /Companies House/ }).click();
    // Exact: the "Another jurisdiction" route's radio is labelled by text that also contains the word.
    await expect(form.getByLabel("Jurisdiction", { exact: true })).toHaveValue("United Kingdom");
    await expect(form.getByLabel("Entity type", { exact: true })).toHaveValue("Ltd");
    await form.getByRole("radio", { name: /Stripe Atlas/ }).click();
    await expect(form.getByLabel("Jurisdiction", { exact: true })).toHaveValue("Delaware");
    await expect(form.getByLabel("Entity type", { exact: true })).toHaveValue("C-corp");
  });

  test("regulatory: a sector choice and a tick survive a reload", async ({ page }) => {
    await openTab(page, "legal", "regulatory");
    // The listener comes before the click: the switch flips at once and the api can answer before a listener added after
    // the click exists, which then waits for a response that has already gone by.
    const saved = () => page.waitForResponse((r) => r.url().includes("legal.regulatory.set") && r.ok());
    const health = page.getByRole("switch", { name: "Health" });
    const before = await health.getAttribute("aria-checked");
    const firstSave = saved();
    await health.click();
    await expect(health).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    await firstSave;
    await page.reload();
    await expect(page.getByTestId("module-screen").locator('[aria-busy="true"]')).toHaveCount(0, { timeout: LONG });
    await expect(page.getByRole("switch", { name: "Health" })).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    // put it back
    const secondSave = saved();
    await page.getByRole("switch", { name: "Health" }).click();
    await secondSave;
    await expect(page.getByText(/goes into the team's brief each round of work/)).toBeVisible();
    await expect(page.getByText(/never performs these/)).toHaveCount(0);
  });

  test("policies: an unpublished policy can be published to the spec", async ({ page }) => {
    await openTab(page, "legal", "policies");
    await page.getByRole("tab", { name: "Cookie policy" }).click();
    const publish = page.getByRole("button", { name: "Publish to the spec" });
    test.skip((await publish.count()) === 0, "the cookie policy is already published on this seed");
    await publish.click();
    await expect(page.getByRole("region", { name: "Cookie policy refresh" })).toBeVisible({ timeout: LONG });
    await expect(page.getByText("Pinned (human-edited)")).toBeVisible();
  });

  test("contracts: nothing says a signature request is sent, and DocuSign is not offered", async ({ page }) => {
    await openTab(page, "legal", "contracts");
    const text = await page.getByTestId("module-screen").innerText();
    expect(text).not.toContain("Send for signature");
    expect(text).not.toContain("DocuSign");
  });

  test("contracts: letting a contract go says it cannot be undone, under the button that offers it (UX plan §6.2)", async ({ page }) => {
    await openTab(page, "legal", "contracts");
    const grid = page.getByRole("grid", { name: "Contracts" });
    const rows = grid.getByRole("row");
    if ((await rows.count()) < 2) return; // the seed may hold no contract; the empty state is its own test
    await rows.nth(1).dblclick();
    const terminate = page.getByRole("button", { name: "Terminate" });
    if (!(await terminate.count())) return; // an expired or terminated contract offers no way on
    const consequence = page.getByTestId("terminate-consequence");
    await expect(consequence).toBeVisible({ timeout: LONG });
    await expect(consequence).toContainText("Not reversible");
    await expect(consequence.locator("[data-consequence-reversible='false']")).toBeVisible();
  });

  test("regulatory: sector suggestions read whole words (a lab team is not tea)", async ({ page }) => {
    await openTab(page, "legal", "regulatory");
    await expect(page.getByText('Why: mentions "tea"')).toHaveCount(0);
  });
});
