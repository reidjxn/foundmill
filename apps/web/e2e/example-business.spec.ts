import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, devApi, openBusiness, settled, signIn } from "./helpers";

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
 *  2. An example viewer: an account that is not a member of the example business. The stack has no second account
 *     (the api maps every bearer to `DEV_AUTH_USER_ID` in test; the seed creates one stub user), so the second
 *     describe signs in through `E2E_EXAMPLE_VIEWER_ID`, the id of a stub auth user that belongs to no business,
 *     handed to the dev bypass as `/auth/dev?as=<uuid>`. Until the stack offers that (see the slice's requests:
 *     apps/web/app/auth/dev/route.ts, apps/web/lib/auth/server.ts, apps/api/src/auth.ts, the seed), those tests fail
 *     early with a message that says what is missing (no spec skips itself, e2e/README.md).
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

  test("Your businesses lists nothing under Example, and Northwind's own frame carries no Example chip", async ({ page }) => {
    await openBusiness(page);
    await expect(page.getByTestId("kitbar-business-name")).toHaveText("Northwind Skincare", { timeout: LONG });
    await expect(page.getByTestId("example-chip")).toHaveCount(0);
    await expect(page.getByTestId("stop-all-trigger")).toBeVisible();
    await page.goto("/businesses");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your businesses", { timeout: LONG });
    await expect(page.locator(`[data-business-row="${NORTHWIND_BUSINESS_ID}"]`)).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("example-businesses")).toHaveCount(0);
  });
});

/** The second account (an auth user that belongs to no business), when the stack offers one; see the header. */
const EXAMPLE_VIEWER_ID = process.env.E2E_EXAMPLE_VIEWER_ID ?? null;

/** Signs the second account in through the dev bypass and lands on New business (its profile is completed once). */
async function signInAsExampleViewer(page: Page): Promise<void> {
  expect(EXAMPLE_VIEWER_ID, "an account that is not a member of the example business: set E2E_EXAMPLE_VIEWER_ID to the id of a stub auth user that belongs to no business and let /auth/dev?as=<uuid> sign it in (see the header of this spec)").not.toBeNull();
  await page.goto(`/auth/dev?as=${EXAMPLE_VIEWER_ID}&next=%2Fnew`);
  await page.waitForURL(/\/onboarding|\/new/, { timeout: LONG });
  if (/\/onboarding/.test(page.url())) {
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await page.getByLabel(/What the team calls you/).fill("Example Explorer");
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    await page.getByLabel(/Budget you can commit/).fill("25k");
    const markets = page.getByRole("textbox", { name: "Target markets" });
    await markets.fill("Nordics");
    await markets.press("Enter");
    await page.getByRole("button", { name: "Remote only" }).click();
    await page.getByLabel("Medium").check();
    await page.getByTestId("profile-submit-bottom").click();
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
  }
  await expect(page.getByTestId("doors")).toBeVisible({ timeout: LONG });
}

/** An api client signed in as the second account (the same `dev:<uuid>` bearer the cookie carries). */
async function viewerApi(playwright: PlaywrightWorkerArgs["playwright"]): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000", extraHTTPHeaders: { authorization: `Bearer dev:${EXAMPLE_VIEWER_ID}` } });
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
    await expect(page.locator("[data-door='example']")).toContainText("Walk around a running business before you start yours. Nothing you do there is saved.");
    await door.click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await settled(page);

    // The Example frame: the neutral chip beside the name, with its tooltip.
    await expect(page.getByTestId("kitbar-business-name")).toHaveText("Northwind Skincare");
    const chip = page.getByTestId("example-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("Example");
    await chip.hover();
    await expect(page.getByRole("tooltip")).toContainText("A seeded example business. Nothing you do here is saved.", { timeout: LONG });
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
    await page.getByTestId("inbox-list").getByRole("option").first().click();
    await expect(page.getByTestId("inbox-item")).toBeVisible({ timeout: LONG });
    await expect(page.getByText("This is an example business: look around, then start your own.")).toBeVisible({ timeout: LONG });

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
    await expect(row).toContainText("A seeded example business. Nothing you do here is saved.");
    await expect(row.getByRole("link", { name: "Open Northwind Skincare" })).toHaveAttribute("href", `/b/${NORTHWIND_BUSINESS_ID}/home`);
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
