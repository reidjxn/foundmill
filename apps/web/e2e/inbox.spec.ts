import { expect, test, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, UUID, ensureDeck, openBusiness, signIn } from "./helpers";

/**
 * Inbox (BUILD §11.3; AC-11.3.2 refresh, AC-11.3.3 Continue follows blocking items) on the seeded Northwind Skincare,
 * plus a fresh business for the decision that releases Continue (the seed's decisions would be used up by the first
 * run). Stack and commands: e2e/README.md.
 */
const rowsOf = (page: Page) => page.getByTestId("inbox-list").getByRole("option");

async function openInbox(page: Page, tab?: string): Promise<void> {
  await openBusiness(page, `inbox${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByTestId("inbox-screen")).toBeVisible({ timeout: LONG });
  // The list renders its rows only once inbox.list has answered (the loading state is a separate element).
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
}

/** Commits the first drafted concept as a new business and lands on its Board item (a decision from the Chief of Staff). */
async function commitFreshBusiness(page: Page, name: string): Promise<{ bid: string; itemId: string }> {
  await ensureDeck(page, 1);
  await page.getByTestId("commit-link").first().click();
  await expect(page).toHaveURL(/\/new\/commit\/[0-9a-f-]+/);
  await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/inbox/${UUID}`), { timeout: LONG });
  const m = page.url().match(new RegExp(`/b/(${UUID})/inbox/(${UUID})`))!;
  await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
  return { bid: m[1]!, itemId: m[2]! };
}

test.describe("inbox", () => {
  test("renders the 380 px list, the tabs and the empty reading pane", async ({ page }) => {
    await openInbox(page);
    await expect(page.getByTestId("inbox-screen")).toHaveAttribute("data-tab", "all");
    const list = page.getByTestId("inbox-pane");
    await expect(list).toBeVisible();
    expect((await list.boundingBox())?.width).toBe(380);
    await expect(page.getByTestId("reading-pane-empty")).toBeVisible();
    for (const tab of ["Respond", "Customers", "Updates", "Archive"]) await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
  });

  test("J/K select the next and previous rows; the URL carries the selection; the pane shows the note anatomy", async ({ page }) => {
    await openInbox(page);
    const rows = rowsOf(page);
    await expect(rows.nth(1), "the seed gives Northwind at least two inbox items").toBeVisible();
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/);
    const first = page.url();
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("j");
    await expect(page).not.toHaveURL(first);
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("k");
    await expect(page).toHaveURL(first);
    await expect(page.getByTestId("inbox-item-header")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("type-pill")).toBeVisible();
    await expect(page.getByTestId("inbox-note")).toBeVisible();
  });

  test("AC-11.3.2: R adds exactly one new item; a second R inside the debounce only shows the wait", async ({ page }) => {
    await openInbox(page);
    const rows = rowsOf(page);
    const refreshCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/trpc\/inbox\.refresh/.test(req.url())) refreshCalls.push(req.url());
    });
    await expect(page.getByTestId("inbox-refresh")).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);
    await page.keyboard.press("r");
    // The 3 s debounce starts with the key press, before the api answers.
    await expect(page.getByTestId("inbox-refresh")).toHaveAttribute("data-wait-ms", /^\d+$/);
    await page.keyboard.press("r");
    // Radix toasts render their title twice (once for the live region): the visible one is enough.
    await expect(page.getByText("One note at a time").first()).toBeVisible();
    await expect(page.getByText("One new note").first()).toBeVisible({ timeout: LONG });
    await expect(rows).toHaveCount(before + 1, { timeout: LONG });
    // The new note is selected and the second press never reached the api.
    await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/);
    expect(refreshCalls).toHaveLength(1);
    // The debounce clears on its own and the count stays at exactly one new item.
    await expect(page.getByTestId("inbox-refresh")).not.toHaveAttribute("data-wait-ms", /\d/, { timeout: 10_000 });
    await expect(rows).toHaveCount(before + 1);
  });

  test("AC-11.3.3: answering a blocking decision with 1 releases Continue, which then runs a cycle step", async ({ page }) => {
    await signIn(page);
    await commitFreshBusiness(page, `Playwright Inbox ${Date.now().toString(36)}`);
    const respond = page.getByRole("button", { name: /^Respond to \d+ items?$/ });
    await expect(respond).toBeVisible({ timeout: LONG });
    const countBefore = Number((await respond.innerText()).match(/\d+/)?.[0] ?? "0");
    expect(countBefore).toBeGreaterThanOrEqual(1);
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision");
    const bar = page.getByTestId("decision-bar");
    await expect(bar).toHaveAttribute("data-state", "open");
    expect(await bar.getByRole("group", { name: "Options" }).getByRole("button").count()).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("1");
    const confirm = page.getByTestId("confirm-plan");
    const answered = page.getByTestId("answered-panel");
    await expect(confirm.or(answered).first()).toBeVisible({ timeout: LONG });
    if (await confirm.isVisible()) {
      await expect(confirm.getByRole("heading", { name: "Here is what will happen" })).toBeVisible();
      await page.getByTestId("confirm-plan-go").click();
      await expect(confirm).toBeHidden({ timeout: LONG });
    }
    await expect(item).toHaveAttribute("data-state", "answered");
    await expect(answered).toBeVisible();
    if (countBefore > 1) {
      await expect(page.getByRole("button", { name: `Respond to ${countBefore - 1} item${countBefore - 1 === 1 ? "" : "s"}` })).toBeVisible({ timeout: LONG });
      return;
    }
    const idle = page.getByRole("button", { name: /^Continue$/ });
    await expect(idle).toBeVisible({ timeout: LONG });
    // One press of Continue → business.continue (an in-process cycle step without Temporal) → a toast says what happened.
    await idle.click();
    await expect(page.getByText(/Cycle started|One new note|Cycle resumed|already running/).first()).toBeVisible({ timeout: LONG });
  });

  test("a won customer opens its Customer Update", async ({ page }) => {
    await openInbox(page, "customers");
    const won = rowsOf(page).first();
    await expect(won, "the seed gives Northwind a won customer").toBeVisible();
    await won.click();
    await expect(page.getByTestId("customer-update")).toBeVisible({ timeout: LONG });
    const open = page.getByTestId("open-replay");
    await expect(open).toBeEnabled({ timeout: LONG });
    await open.click();
    await expect(page).toHaveURL(/\/journey\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("journey-screen")).toBeVisible({ timeout: LONG });
    expect(page.url()).toContain(`/b/${NORTHWIND_BUSINESS_ID}/journey/`);
  });
});
