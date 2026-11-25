import { expect, test, type APIRequestContext } from "@playwright/test";
import { LEDGERLY_BUSINESS_ID, LONG, NORTHWIND_BUSINESS_ID, devApi, dismissCoachmarks, openBusiness, openSettings, settingsScreen, settled, signIn } from "./helpers";

/**
 * The Chief of Staff's build recommendation (founder, Nov 25, 2026): the note names the founder's own words that decide
 * it and both costs, with Build it ourselves and Build it with Lovable as its two buttons. With Lovable not connected,
 * Build it with Lovable answers with the link that opens Lovable with the plan. In Settings › Integrations, Lovable is a
 * connector to choose, and a refused sign-in says why and offers the same link: never a dead end. The notes are written
 * through `dev.seedBuildChoice` (development and test only), in the Ledgerly sample, so Northwind's Inbox counts stay as
 * the other specs expect.
 */
const L = `/b/${LEDGERLY_BUSINESS_ID}`;
const B = `/b/${NORTHWIND_BUSINESS_ID}`;

async function call<T>(api: APIRequestContext, path: string, input: unknown): Promise<T> {
  const res = await api.post(`/trpc/${path}`, { data: { json: input } });
  expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

async function query<T>(api: APIRequestContext, path: string, input: unknown): Promise<T> {
  const res = await api.get(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

test.describe("build it ourselves or with Lovable", () => {
  let api: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    api = await devApi(playwright);
  });
  test.afterAll(async () => api?.dispose());

  test("the note quotes the idea, states both costs, and Build it with Lovable gives the link when Lovable is not connected", async ({ page }) => {
    const { inboxItemId } = await call<{ inboxItemId: string }>(api, "dev.seedBuildChoice", { businessId: LEDGERLY_BUSINESS_ID, ideaText: "A web app where tutors log in and track each student's homework on a dashboard." });
    await signIn(page);
    await page.goto(`${L}/inbox/${inboxItemId}`);
    await dismissCoachmarks(page);
    const item = page.getByTestId("inbox-item");
    await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
    await expect(item).toContainText("I recommend building it with Lovable.");
    await expect(item).toContainText("homework on a dashboard");
    await expect(item).not.toContainText("No cost");
    await expect(item).toContainText("its credits are Lovable's, billed by Lovable");
    await expect(item).toContainText("use your Foundmill credits");
    await expect(item).toContainText("Estimate");
    const bar = page.getByTestId("decision-bar");
    await expect(bar.getByRole("button", { name: "Build it ourselves" })).toBeVisible();
    await bar.getByRole("button", { name: "Build it with Lovable" }).click();
    // The note is answered first (one press, one project); the outcome follows as the Chief of Staff's next note.
    await expect.poll(async () => (await query<{ item: { state: string } }>(api, "inbox.get", { businessId: LEDGERLY_BUSINESS_ID, itemId: inboxItemId })).item.state, { timeout: LONG }).toBe("answered");
    const list = await query<{ items: { id: string; subject: string; createdAt: string }[] }>(api, "inbox.list", { businessId: LEDGERLY_BUSINESS_ID, tab: "all" });
    const next = list.items.find((i) => i.subject === "Build it with Lovable");
    expect(next, "the follow-up note").toBeTruthy();
    await page.goto(`${L}/inbox/${next!.id}`);
    const answer = page.getByTestId("inbox-item");
    await expect(answer).toContainText("Lovable is not connected, so I did not create the project for you.", { timeout: LONG });
    await expect(answer.getByRole("link", { name: "Open Lovable with your plan" })).toHaveAttribute("href", /^https:\/\/lovable\.dev\/#prompt=/);
  });

  test("Lovable is a connector to choose; a refused sign-in says why and offers the link; a refused scope is asked once with fewer", async ({ page }) => {
    await openBusiness(page);
    const screen = await openSettings(page, "integrations");
    await expect(screen.locator('[data-connector="lovable_mcp"]')).toContainText("Lovable", { timeout: LONG });

    await page.goto(`${B}/settings/integrations?oauth_connector=lovable_mcp&oauth_error=access_denied`);
    await settled(page);
    const refused = settingsScreen(page).getByTestId("lovable-way-in");
    await expect(refused).toContainText("You did not allow access on Lovable's page, so Lovable was not connected.", { timeout: LONG });
    await expect(refused.getByTestId("lovable-build-link")).toHaveAttribute("href", /^https:\/\/lovable\.dev\/#prompt=/, { timeout: LONG });

    // invalid_scope: the connect starts again by itself with fewer permissions, once. The request is caught here.
    let sent: Record<string, unknown> | null = null;
    await page.route(/\/trpc\/[^?]*integrations\.connect/, async (route) => {
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
      sent = body[String(procedures.indexOf("integrations.connect"))]?.json ?? null;
      await route.abort();
    });
    await page.goto(`${B}/settings/integrations?oauth_connector=lovable_mcp&oauth_error=invalid_scope`);
    await expect.poll(() => sent, { timeout: LONG }).toMatchObject({ connectorKey: "lovable_mcp", input: { retryScopes: true } });
    // A second refusal in the same tab is not retried: it says why and offers the link.
    await page.goto(`${B}/settings/integrations?oauth_connector=lovable_mcp&oauth_error=invalid_scope`);
    await expect(settingsScreen(page).getByTestId("lovable-way-in")).toContainText("Lovable did not allow the access we asked for", { timeout: LONG });
  });
});
