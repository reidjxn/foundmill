import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Browser, type PlaywrightWorkerArgs } from "@playwright/test";
import { API_URL, expectTapTarget, LONG, signIn, signInAs } from "./helpers";

/**
 * Reporting a person (docs/NETWORK.md F21): a second account publishes /u/<handle>; a third, signed in at 390 px, sees
 * Report under the page, reports it and blocks in the same step; the page's own person and a signed-out visitor see no
 * Report control; the operator (the dev founder in this stack, OPERATOR_USER_IDS) finds the report at /operator/reports
 * and marks it reviewed; anyone else gets not found there.
 */

async function as(playwright: PlaywrightWorkerArgs["playwright"], userId: string): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer dev:${userId}` } });
}

async function call(api: APIRequestContext, path: string, json: unknown): Promise<void> {
  const res = await api.post(`/trpc/${path}`, { data: { json } });
  expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
}

async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  return { context, page: await context.newPage() };
}

test.describe("reports", () => {
  const owner = randomUUID();
  const reporter = randomUUID();
  const handle = `report-${owner.slice(0, 8)}`;
  const name = `Rae ${owner.slice(0, 4)}`;

  test.beforeAll(async ({ playwright }) => {
    for (const [id, displayName] of [
      [owner, name],
      [reporter, "Reporter"],
    ] as const) {
      const api = await as(playwright, id);
      await call(api, "founder.profile.update", { displayName, confirmAdult: true });
      if (id === owner) await call(api, "founder.publicProfile.publish", { handle, content: { headline: "Sells bread by bike", about: "", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "" } });
      await api.dispose();
    }
  });

  test("a signed-in visitor reports a profile at 390 px and blocks in the same step; the operator reviews it", async ({ browser }) => {
    test.setTimeout(LONG * 6);
    // Signed out: the page shows, with no Report control.
    const out = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    const outPage = await out.newPage();
    await outPage.goto(`/u/${handle}`);
    await expect(outPage.locator("[data-person-page]")).toBeVisible({ timeout: LONG });
    // Settled first: a control drawn after a late answer would otherwise slip past the count.
    await outPage.waitForLoadState("networkidle");
    await expect(outPage.getByTestId("profile-report-open")).toHaveCount(0);
    await expect(outPage.getByTestId("profile-report")).toHaveCount(0);
    await out.close();

    // The page's own person: no Report control on their own page.
    const self = await phone(browser);
    await signInAs(self.page, owner, `/u/${handle}`);
    await expect(self.page.locator("[data-person-page]")).toBeVisible({ timeout: LONG });
    await self.page.waitForLoadState("networkidle");
    await expect(self.page.getByTestId("profile-report-open")).toHaveCount(0);
    await self.context.close();

    // Another person reports it at 390 px, and blocks.
    const v = await phone(browser);
    await signInAs(v.page, reporter, `/u/${handle}`);
    const open = v.page.getByTestId("profile-report-open");
    await expect(open).toBeVisible({ timeout: LONG });
    await expectTapTarget(open);
    await open.click();
    const dialog = v.page.getByTestId("report-person-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Report this profile" })).toBeVisible();
    await dialog.getByLabel("Pretending to be someone else").check();
    await dialog.getByLabel("Anything we should know").fill("Uses my photos");
    await dialog.getByTestId("report-person-block").click();
    await dialog.getByTestId("report-person-send").click();
    await expect(dialog).toBeHidden({ timeout: LONG });
    await expect(v.page.getByText("Report sent").first()).toBeVisible({ timeout: LONG });
    // Not an operator: the queue is not found (at a desktop width; below it the page asks for a larger window first).
    await v.page.setViewportSize({ width: 1440, height: 900 });
    await v.page.goto("/operator/reports");
    await expect(v.page.getByTestId("reports-queue")).toHaveCount(0);
    await expect(v.page.getByTestId("public-person-not-found").or(v.page.getByText(/not found/i)).first()).toBeVisible({ timeout: LONG });
    await v.context.close();

    // The operator (the dev founder) sees it at 1280 px and marks it reviewed.
    const op = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await op.newPage();
    await signIn(page);
    await page.goto("/operator/reports");
    const queue = page.getByTestId("reports-queue");
    await expect(queue).toBeVisible({ timeout: LONG });
    const row = queue.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: LONG });
    await expect(row).toContainText("Pretending to be someone else");
    await expect(row).toContainText("Uses my photos");
    await expect(row).toContainText("Reporter");
    await row.getByTestId("report-review").click();
    await page.getByTestId("report-resolve-no_action").click();
    await expect(queue.getByRole("row").filter({ hasText: name })).toHaveCount(0, { timeout: LONG });
    await op.close();
  });
});
