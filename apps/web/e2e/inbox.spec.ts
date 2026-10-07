import { expect, test, type Page } from "@playwright/test";

/**
 * Inbox (BUILD §11.3; AC-11.3.2 refresh, AC-11.3.3 Continue follows blocking items). Not run in the build container
 * (no browser). Needs apps/api in mock mode with DEV_AUTH_USER_ID set to a seeded owner.
 */
async function openInbox(page: Page): Promise<string | null> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as developer" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/home|\/onboarding|\/new/);
  const bid = page.url().match(/\/b\/([0-9a-f-]+)/)?.[1] ?? null;
  if (bid) await page.goto(`/b/${bid}/inbox`);
  return bid;
}

test.describe("inbox", () => {
  test("renders the 380 px list, the tabs and the empty reading pane", async ({ page }) => {
    const bid = await openInbox(page);
    test.skip(!bid, "no seeded business for the dev user");
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "all");
    const list = page.getByTestId("inbox-pane");
    await expect(list).toBeVisible();
    expect((await list.boundingBox())?.width).toBe(380);
    await expect(page.getByTestId("reading-pane-empty")).toBeVisible();
    for (const tab of ["Respond", "Customers", "Updates", "Archive"]) await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
  });

  test("J/K select the next and previous rows; the URL carries the selection; the pane shows the note anatomy", async ({ page }) => {
    const bid = await openInbox(page);
    test.skip(!bid, "no seeded business for the dev user");
    const rows = page.getByTestId("inbox-list").getByRole("option");
    test.skip((await rows.count()) < 2, "fewer than two inbox items seeded");
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/);
    const first = page.url();
    await page.keyboard.press("j");
    await expect(page).not.toHaveURL(first);
    await page.keyboard.press("k");
    await expect(page).toHaveURL(first);
    await expect(page.getByTestId("inbox-item-header")).toBeVisible();
    await expect(page.getByTestId("type-pill")).toBeVisible();
    await expect(page.getByTestId("inbox-note")).toBeVisible();
  });

  test("AC-11.3.2: R adds exactly one new item and the debounce shows while it settles", async ({ page }) => {
    const bid = await openInbox(page);
    test.skip(!bid, "no seeded business for the dev user");
    const rows = page.getByTestId("inbox-list").getByRole("option");
    await expect(page.getByTestId("inbox-refresh")).toBeVisible();
    const before = await rows.count();
    await page.keyboard.press("r");
    await expect(page.getByTestId("inbox-refresh")).toHaveAttribute("data-wait-ms", /\d+/);
    await expect(async () => expect(await rows.count()).toBe(before + 1)).toPass({ timeout: 10_000 });
    await page.keyboard.press("r");
    await expect(page.getByText("One note at a time")).toBeVisible();
    expect(await rows.count()).toBe(before + 1);
  });

  test("AC-11.3.3: answering a blocking decision with 1 releases Continue", async ({ page }) => {
    const bid = await openInbox(page);
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/inbox?tab=respond`);
    const blocking = page.getByTestId("inbox-list").locator("[data-needs-answer][data-type='Decision']").first();
    test.skip((await blocking.count()) === 0, "no blocking decision seeded");
    const respond = page.getByRole("button", { name: /Respond · \d+/ });
    const countBefore = Number((await respond.textContent())?.match(/\d+/)?.[0] ?? "0");
    await blocking.click();
    await expect(page.getByTestId("decision-bar")).toBeVisible();
    await page.keyboard.press("1");
    const confirm = page.getByTestId("confirm-plan");
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await page.getByTestId("confirm-plan-go").click();
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-state", "answered");
    await expect(page.getByTestId("answered-panel")).toBeVisible();
    if (countBefore <= 1) await expect(page.getByRole("button", { name: /^Continue/ })).toBeVisible();
    else await expect(page.getByRole("button", { name: `Respond · ${countBefore - 1}` })).toBeVisible();
  });

  test("a won customer opens its Customer Update", async ({ page }) => {
    const bid = await openInbox(page);
    test.skip(!bid, "no seeded business for the dev user");
    await page.goto(`/b/${bid}/inbox?tab=customers`);
    const won = page.getByTestId("inbox-list").getByRole("option").first();
    test.skip((await won.count()) === 0, "no won customer seeded");
    await won.click();
    await expect(page.getByTestId("customer-update")).toBeVisible();
    const open = page.getByTestId("open-replay");
    await expect(open).toBeEnabled({ timeout: 10_000 });
    await open.click();
    await expect(page).toHaveURL(/\/journey\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("journey-screen")).toBeVisible();
  });
});
