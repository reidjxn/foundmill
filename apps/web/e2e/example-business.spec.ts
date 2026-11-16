import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { E2E_EXAMPLE_VIEWER_ID } from "../playwright.config";
import { API_URL, LONG, NORTHWIND_BUSINESS_ID, answerFirstProfile, devApi, openBusiness, settled, signIn, signInAs } from "./helpers";

/**
 * The example business (docs/UX_AUDIT_AND_PLAN.md §10 Phase 3, §12 item 5; migration 0065): a signed-in founder opens
 * the seeded Northwind Skincare as a read-only "example viewer" from a third door on New business, meets the Example
 * frame (the "Example" chip beside the name, Start your own in Continue's slot, Stop all agents hidden, every write
 * refused with the example wording), and leaves it from Your businesses. Stack and commands: e2e/README.md.
 *
 * Two kinds of account meet this feature, and the stack signs in exactly one of them:
 *
 *  1. The seeded owner (the dev bypass, `DEV_AUTH_USER_ID`) owns both demo businesses, Northwind and Ledgerly
 *     (packages/db/src/seed: every demo gets every seed owner). For them the example is a business they already
 *     belong to for real: the door hides, `business.example.open` refuses (CONFLICT) and nothing is listed under
 *     "Example". The first describe below covers that and runs on the stack as it is.
 *
 *  2. An example viewer: an account that is not a member of the example business. The second describe signs in as
 *     `E2E_EXAMPLE_VIEWER_ID` (playwright.config.ts, a fixed id) through `signInAs` (`/auth/dev?as=<uuid>`): the web
 *     then sends `Bearer dev:<uuid>`, which the api and the stream map to that account in development and test only,
 *     and the api's dev bootstrap creates it as a stub auth user with no business the first time it is seen.
 */

type Json<T> = { result: { data: { json: T } } };
interface ExampleView {
  id: string;
  name: string;
  slug: string;
  membership: "none" | "example" | "member";
}

async function exampleGet(api: APIRequestContext): Promise<ExampleView | null> {
  const res = await api.get("/trpc/business.example.get");
  expect(res.ok(), `business.example.get answered ${res.status()}`).toBe(true);
  return ((await res.json()) as Json<ExampleView | null>).result.data.json;
}

test.describe("the example business, as the seeded owner", () => {
  test("names Northwind as the example; its owner belongs for real, so the door hides and open is refused", async ({ page, playwright }) => {
    const api = await devApi(playwright);
    const example = await exampleGet(api);
    expect(example, "the seed's demo businesses are the example (re-seed: e2e/README.md)").not.toBeNull();
    expect(example!.id).toBe(NORTHWIND_BUSINESS_ID);
    expect(example!.name).toBe("Northwind Skincare");
    expect(example!.membership).toBe("member");
    // A real member never gets an example seat: the open is refused and their owner row stays.
    const open = await api.post("/trpc/business.example.open", { data: { json: null } });
    expect(open.status()).toBe(409);
    expect(await open.text()).toContain("already a member");
    // Leaving through the example path removes nothing of theirs.
    const leave = await api.post("/trpc/business.example.leave", { data: { json: { businessId: NORTHWIND_BUSINESS_ID } } });
    expect(leave.ok()).toBe(true);
    expect(((await leave.json()) as Json<{ left: boolean }>).result.data.json.left).toBe(false);
    await api.dispose();

    await signIn(page);
    await page.goto("/new");
    await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("doors")).toHaveAttribute("data-doors", "2");
    await expect(page.getByTestId("door-ideate")).toBeVisible();
    await expect(page.getByTestId("door-import")).toBeVisible();
    await expect(page.getByTestId("door-example")).toHaveCount(0);
  });

  test("Your businesses lists nothing under Example; Northwind's owner sees no sample marker and no Example frame", async ({ page }) => {
    await openBusiness(page);
    await expect(page.getByTestId("kitbar-business-name")).toHaveText("Northwind Skincare", { timeout: LONG });
    // The sample marker is only for a visitor exploring the example (founder, Nov 12, 2026); the owner is not one.
    await expect(page.getByTestId("sample-chip")).toHaveCount(0);
    await expect(page.getByTestId("stop-all-trigger")).toBeVisible();
    await page.goto("/businesses");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your businesses", { timeout: LONG });
    await expect(page.locator(`[data-business-row="${NORTHWIND_BUSINESS_ID}"]`)).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("example-businesses")).toHaveCount(0);
  });
});

/** The second account: an auth user that belongs to no business (see the header). */
const EXAMPLE_VIEWER_ID = E2E_EXAMPLE_VIEWER_ID;

/** Signs the second account in through the dev bypass and lands on New business (its profile is completed once). */
async function signInAsExampleViewer(page: Page): Promise<void> {
  await signInAs(page, EXAMPLE_VIEWER_ID, "/new");
  // /new sends a founder without a profile on to /onboarding, so the URL can read /new for a moment before that
  // redirect lands: wait for whichever screen actually renders, then branch on it.
  const form = page.getByTestId("first-profile");
  await expect(form.or(page.getByTestId("doors"))).toBeVisible({ timeout: LONG });
  if (await form.isVisible()) {
    // The three questions create the profile (WP-04 T1); a new account confirms it is 18 or older there, once (0100).
    await answerFirstProfile(page, "Example Explorer");
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
  }
  await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
}

/** An api client signed in as the second account (the same `dev:<uuid>` bearer the cookie carries). */
async function viewerApi(playwright: PlaywrightWorkerArgs["playwright"]): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer dev:${EXAMPLE_VIEWER_ID}` } });
}

test.describe("the example business, as an example viewer", () => {
  test.setTimeout(240_000);

  test("the third door opens Northwind as a read-only example: the chip, Start your own, no Stop all agents, every write refused", async ({ page }) => {
    await signInAsExampleViewer(page);
    // Their first business: the example membership never counts as one of their own.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your first business");
    await expect(page.getByTestId("doors")).toHaveAttribute("data-doors", "3");
    const door = page.getByTestId("door-example");
    await expect(door).toBeVisible();
    await expect(door).toHaveAttribute("data-example-business", NORTHWIND_BUSINESS_ID);
    await expect(page.locator("[data-door='example']")).toContainText("Walk around a business two years in, with paying customers and a team at full stretch. Your first weeks will look like its Day one, much smaller. Nothing you do there is saved.");
    await door.click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/today$`), { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await settled(page);

    // The Example frame: the quiet "Sample business" marker beside the name, whose line says the figures are made up and nothing is saved.
    await expect(page.getByTestId("kitbar-business-name")).toHaveText("Northwind Skincare");
    const chip = page.getByTestId("sample-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("Sample project");
    await expect(chip).toHaveAttribute("data-example", "true");
    await chip.hover();
    await expect(page.getByRole("tooltip")).toContainText("Its figures are made up for the example: nothing here is real money or real customers. Nothing you do here is saved.", { timeout: LONG });
    // Start your own in Continue's slot, routing to New business; Stop all agents is not on the bar.
    const start = page.getByRole("button", { name: "Start your own" });
    await expect(start).toBeVisible();
    await expect(page.locator("[data-coachmark='start-your-own']")).toHaveCount(1);
    await expect(page.getByTestId("stop-all-trigger")).toBeHidden();
    // The callout under it says when to leave (guidance on; "Got it" puts it away).
    const callout = page.locator("[data-coachmark][data-tour='example-start']");
    if (await callout.isVisible().catch(() => false)) {
      await expect(callout).toContainText("When you are ready, start your own business here.");
      await callout.getByRole("button", { name: "Got it" }).click();
      await expect(callout).toHaveCount(0);
    }

    // A refused write: the Inbox's decision bar says why, in the example's words, and the api refuses too.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/inbox`);
    await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
    await settled(page);
    // The reason sits in the decision bar of an open decision, and the first item is not always one (answered items show none): look down the list.
    const rows = page.getByTestId("inbox-list").getByRole("option");
    const readOnlyNote = page.getByTestId("decision-read-only");
    let openDecision = false;
    for (let i = 0; i < (await rows.count()) && !openDecision; i++) {
      await rows.nth(i).click();
      await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
      openDecision = await readOnlyNote.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false);
    }
    expect(openDecision, "an open decision in Northwind shows the example's read-only reason").toBe(true);
    await expect(readOnlyNote).toContainText("This is an example project: look around, then start your own.");

    await start.click();
    await page.waitForURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
  });

  test("a refused write through the api, and the example in Your businesses with Leave", async ({ page, playwright }) => {
    const api = await viewerApi(playwright);
    expect((await exampleGet(api))?.membership).toBe("example");
    const update = await api.post("/trpc/business.update", { data: { json: { businessId: NORTHWIND_BUSINESS_ID, name: "Renamed by the example viewer" } } });
    expect(update.status()).toBe(403);
    const cont = await api.post("/trpc/business.continue", { data: { json: { businessId: NORTHWIND_BUSINESS_ID } } });
    expect(cont.status()).toBe(403);
    await api.dispose();

    await signInAsExampleViewer(page);
    await page.goto("/businesses");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your businesses", { timeout: LONG });
    const panel = page.getByTestId("example-businesses");
    await expect(panel).toBeVisible({ timeout: LONG });
    const row = panel.locator(`[data-business-row="${NORTHWIND_BUSINESS_ID}"]`);
    await expect(row).toContainText("Northwind Skincare");
    await expect(row.getByTestId("example-row-chip")).toHaveText("Example");
    await expect(row).toContainText("Its figures are made up for the example: nothing here is real money or real customers. Nothing you do here is saved.");
    await expect(row.getByRole("link", { name: "Open Northwind Skincare" })).toHaveAttribute("href", `/b/${NORTHWIND_BUSINESS_ID}/today`);
    // Not among their own businesses.
    await expect(page.getByTestId("active-businesses").locator(`[data-business-row="${NORTHWIND_BUSINESS_ID}"]`)).toHaveCount(0);

    // Leave: the dialog states the consequence, then the row goes; the door offers the example again.
    await row.getByRole("button", { name: "Leave Northwind Skincare" }).click();
    const dialog = page.getByTestId("example-leave-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("example-leave-consequence")).toContainText("Nothing is deleted; you can open it again from New business.");
    await dialog.getByTestId("example-leave-confirm").click();
    await expect(panel).toHaveCount(0, { timeout: LONG });
    await page.goto("/new");
    await expect(page.getByTestId("door-example")).toBeVisible({ timeout: LONG });
    const after = await viewerApi(playwright);
    expect((await exampleGet(after))?.membership).toBe("none");
    await after.dispose();
  });
});

/**
 * The sample's numbers agree with each other and stay current (first-time founder report, Phase 3 group K item 3:
 * "Home: 0 customers this week … Milestones: 1,000th customer"). The api rolls the demo forward with the calendar
 * (DECISIONS 2026-11-10), so the seeded week is this week; Home's Customers this week is the ribbon's own server figure;
 * the customer milestones reached are the ones the first-payment total has passed; and Finance names Northwind's
 * monthly figure for what it is (a skincare brand's customers buy once) over the same months as its revenue.
 */
test.describe("the sample's numbers agree", () => {
  test.setTimeout(180_000);

  test("Home's customers this week, Milestones and Finance tell one story on Northwind", async ({ page, playwright }) => {
    const api = await devApi(playwright);
    const res = await api.get(`/trpc/journey.ribbon?input=${encodeURIComponent(JSON.stringify({ json: { businessId: NORTHWIND_BUSINESS_ID, slim: true } }))}`);
    expect(res.ok(), `journey.ribbon answered ${res.status()}`).toBe(true);
    const ribbon = ((await res.json()) as Json<{ customers: { thisWeek: number; total: number }; milestones: { ref?: { trophyKey?: string | null } | null }[] }>).result.data.json;
    await api.dispose();
    // Rolled forward: the sample's last week is the calendar's.
    expect(ribbon.customers.thisWeek, "the sample has customers this week (it rolls forward with the calendar)").toBeGreaterThan(0);
    const reached = new Set(ribbon.milestones.map((m) => m.ref?.trophyKey).filter(Boolean));
    for (const [key, threshold] of [["customer_1", 1], ["customer_10", 10], ["customer_100", 100], ["customer_1000", 1000]] as const) {
      expect(reached.has(key), `${key} reached iff ${ribbon.customers.total} first payments ≥ ${threshold}`).toBe(ribbon.customers.total >= threshold);
    }

    // Home (Details): the tile shows the server's figure.
    await openBusiness(page, "home");
    const tile = page.locator("[data-widget='status_strip'] [data-metric-tile]").filter({ hasText: "Customers this week" }).first();
    await expect(tile.locator("[data-value]")).toHaveAttribute("data-value", ribbon.customers.thisWeek.toLocaleString("en-US"), { timeout: LONG });

    // Milestones: the same reached set, as cards.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/milestones`);
    await expect(page.getByTestId("milestones-screen")).toBeVisible({ timeout: LONG });
    await expect(page.locator("[data-trophy='customer_1']")).toBeVisible({ timeout: LONG });
    // The count they are reached at sits beside them, the same server figure.
    await expect(page.getByTestId("trophy-cabinet-panel")).toContainText(`${ribbon.customers.total.toLocaleString("en-US")} paying customers so far`);
    for (const key of ["customer_1", "customer_10", "customer_100", "customer_1000"]) await expect(page.locator(`[data-trophy='${key}'][data-achieved]`)).toHaveCount(reached.has(key) ? 1 : 0);

    // Finance: one-off sales, so the monthly figure is the average month of the same three months as the revenue.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/d/finance/overview`);
    await expect(page.getByTestId("module-screen")).toHaveAttribute("data-module", "finance/overview", { timeout: LONG });
    await page.getByTestId("finance-more").getByText("More numbers").click();
    await expect(page.locator("[data-metric='mrr'] [data-metric-label]")).toHaveText("Average monthly revenue", { timeout: LONG });
    const revenueCaption = (await page.locator("[data-metric='revenue'] [data-metric-caption]").innerText()).trim();
    const months = revenueCaption.replace(/, 3 full months$/, "");
    expect(revenueCaption).toMatch(/^\S.*, 3 full months$/);
    await expect(page.locator("[data-metric='mrr'] [data-metric-caption]")).toHaveText(`a month: the ${months} revenue ÷ 3`);
  });
});
