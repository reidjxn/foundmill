import { expect, test } from "@playwright/test";
import { devApi, LONG, NORTHWIND_BUSINESS_ID, openBusiness, openSettings, toast } from "./helpers";

/**
 * The return loop (retention plan, founder 2026-11-11; one sender and one preference since 2026-11-12). Settings ›
 * Preferences › Email lists every kind of email with its switch, the brief's hour, browser notifications and the pause, and a change saves at once. The browser title
 * carries how many things need the founder. The one-click answer and pause pages open without a session (a founder
 * email is often read on a phone) and change nothing until their button is pressed; a made-up link says it no longer
 * works. The dev founder is shared by every spec, so the switch this spec turns off is turned back on.
 */
test.describe("the return loop", () => {
  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    await api.post("/trpc/founder.preferences.update", { data: { json: { email: { daily_brief: true } } } });
    await api.post("/trpc/founder.email.update", { data: { json: { emailsPaused: false } } });
  });

  test("Settings › Preferences › Email: every kind has a switch, a change saves, the latest emails show", async ({ page }) => {
    await openBusiness(page, "today");
    const screen = await openSettings(page, "preferences");
    const panel = screen.getByTestId("email-notifications-panel");
    await expect(panel).toBeVisible({ timeout: LONG });
    for (const kind of ["decision-waiting", "win", "milestone", "run-finished", "credits", "daily-brief", "weekly-review"]) await expect(panel.getByTestId(`email-${kind}-switch`)).toBeVisible();
    const brief = panel.getByTestId("email-daily-brief-switch");
    await expect(brief).toHaveAttribute("aria-checked", "true", { timeout: LONG });
    await brief.click();
    await expect(toast(page, "Email off")).toBeVisible({ timeout: LONG });
    await expect(brief).toHaveAttribute("aria-checked", "false");
    await brief.click();
    await expect(brief).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("email-brief-hour")).toBeVisible();
    await expect(panel.getByTestId("browser-notifications-switch")).toBeVisible();
    await expect(panel.getByTestId("email-recent")).toContainText("Latest emails");
  });

  test("the browser title starts with how many things need the founder", async ({ page }) => {
    await openBusiness(page, "today");
    const badge = await page.getByRole("link", { name: /Needs you/ }).first().textContent();
    const count = Number((badge ?? "").replace(/\D+/g, "")) || 0;
    if (count > 0) await expect(page).toHaveTitle(new RegExp(`^\\(${count}\\) Today · `), { timeout: LONG });
    else await expect(page).toHaveTitle(/^Today · /, { timeout: LONG });
  });

  test("a made-up one-click answer link and pause link open without a session and say they no longer work", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`/a/${"x".repeat(43)}`);
    await expect(page.getByTestId("email-answer")).toHaveAttribute("data-state", "unavailable", { timeout: LONG });
    await expect(page.getByText("This link no longer works")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Needs you" })).toBeVisible();
    await page.goto("/email/pause?t=forged.token");
    const pause = page.getByTestId("email-pause");
    await expect(pause).toHaveAttribute("data-state", "ready", { timeout: LONG });
    await pause.getByRole("button", { name: "Pause every email" }).click();
    await expect(pause).toHaveAttribute("data-state", "refused", { timeout: LONG });
    await context.close();
  });

  test("on a phone, the email pages and the landing page's idea box render (founder, 2026-11-12 and 2026-11-13)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`/a/${"x".repeat(43)}`);
    await expect(page.getByTestId("email-answer")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    const box = await page.getByTestId("brand-panel").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    expect((await page.getByRole("link", { name: "Open Needs you" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.goto("/email/pause?t=forged.token");
    await expect(page.getByTestId("email-pause")).toBeVisible({ timeout: LONG });
    // The landing page is one page for every width from 390 px (DESIGN §9a); the app itself still asks for a larger
    // window (gate0-screens.spec.ts).
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("idea-input")).toBeVisible();
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await context.close();
  });

  test("on a phone, the one-click answer is a 44 px button, and a failed answer says so with Try again (WP-04 T14)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    // A real ready link needs a sent email; the read is replayed as ready and the answer is cut off, as a lost connection would.
    await page.route(/\/trpc\/[^?]*email\.action\.get/, async (route) => {
      const response = await route.fetch();
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      const body = (await response.json()) as { result?: { data?: { json?: Record<string, unknown> } } }[];
      const view = body[procedures.indexOf("email.action.get")]?.result?.data?.json;
      if (view) Object.assign(view, { state: "ready", subject: "Pick a launch day", optionLabel: "Tuesday" });
      await route.fulfill({ response, json: body });
    });
    await page.route(/\/trpc\/[^?]*email\.action\.answer/, (route) => route.abort());
    await page.goto(`/a/${"x".repeat(43)}`);
    const card = page.getByTestId("email-answer");
    await expect(card).toHaveAttribute("data-state", "ready", { timeout: LONG });
    const answer = card.getByRole("button", { name: "Answer “Tuesday”" });
    const box = await answer.boundingBox();
    expect(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await answer.click();
    await expect(card.getByRole("alert")).toHaveText("That did not go through. Try again.", { timeout: LONG });
    const retry = card.getByRole("button", { name: "Try again" });
    expect((await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test("Today shows the founder's streak quietly, low on the page, today counted once they are in (WP-04 D5)", async ({ page }) => {
    await openBusiness(page, "today");
    const strip = page.getByTestId("streak-strip");
    await expect(strip).toBeVisible({ timeout: LONG });
    await expect(strip.getByTestId("streak-headline")).toHaveText(/\d+ days? in a row|Start a streak today/);
    // Only the days the founder came, and never a warning that the streak is about to end.
    await expect(strip).not.toContainText(/Not opened|Open your business today/);
    // The ping on open counts today: a reload draws at least today's dot.
    await page.reload();
    await expect(page.getByTestId("streak-strip").getByRole("list", { name: "Days you opened it this week" }).locator("li").last()).toBeAttached({ timeout: LONG });
    // It sits under the week plan, after the goal.
    const order = await page.locator("[data-testid=today-screen] [data-order]").getAttribute("data-order");
    expect(order!.split(" ").indexOf("streak")).toBeGreaterThan(order!.split(" ").indexOf("week"));
  });

  test("the presence ping records the founder in the business", async ({ page, playwright }) => {
    await openBusiness(page, "today");
    const api = await devApi(playwright);
    const res = await api.get(`/trpc/founder.presence.get?input=${encodeURIComponent(JSON.stringify({ json: { businessId: NORTHWIND_BUSINESS_ID } }))}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { result: { data: { json: { sessions: number } | null } } };
    expect(body.result.data.json?.sessions ?? 0).toBeGreaterThanOrEqual(1);
  });
});
