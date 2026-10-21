import { expect, test, type APIRequestContext } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, devApi, openBusiness, settingsScreen, settled, toast } from "./helpers";

/**
 * The first-visit tours (docs/UX_AUDIT_AND_PLAN.md §6.2 Coachmark, §10 Phase 3) on the seeded Northwind Skincare: the
 * Home tour appears for the seeded owner on the first visit while guidance is on, Next walks its steps (each ringing
 * its target), Skip marks it done in the account's row, a second visit shows nothing, and "Replay the tour" in
 * Settings › Preferences brings it back. The Inbox and department tours start on their own first visits. Tours are
 * account-level (account_preferences.tours_done), so the dev founder's guidance preferences are reset in beforeAll
 * through the preferences api and put back afterwards (the founder is shared by every spec).
 */
type Guidance = { guidance: "on" | "off"; textSize: "standard" | "comfortable"; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissedAt: string | null };

const GUIDANCE_DEFAULTS: Guidance = { guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null };

async function readGuidance(api: APIRequestContext): Promise<Guidance> {
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: Guidance } } }).result.data.json;
}

/** The dev founder's tours cleared and guidance on: every test starts as a first visit. */
async function resetTours(api: APIRequestContext): Promise<void> {
  const reset = await api.post("/trpc/founder.preferences.update", { data: { json: { guidance: "on", reset: true } } });
  expect(reset.ok(), await reset.text()).toBe(true);
}

const HOME_CARD = "[data-coachmark][data-tour='home']";
const FIRST_CONTINUE = "[data-coachmark][data-tour='first-continue']";

test.describe("tours", () => {
  let before: Guidance | null = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    before = await readGuidance(api);
    await resetTours(api);
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    const b = before ?? GUIDANCE_DEFAULTS;
    // Marks only ever merge, so the maps are cleared first and what was seen is marked again.
    const put = await api.post("/trpc/founder.preferences.update", { data: { json: { guidance: b.guidance, textSize: b.textSize, reset: true } } });
    expect(put.ok(), await put.text()).toBe(true);
    const marks = {
      ...(Object.keys(b.explainersSeen).length ? { explainersSeen: b.explainersSeen } : {}),
      ...(Object.keys(b.toursDone).length ? { toursDone: b.toursDone } : {}),
      ...(b.checklistDismissedAt ? { checklistDismissed: true } : {}),
    };
    if (Object.keys(marks).length) {
      const again = await api.post("/trpc/founder.preferences.update", { data: { json: marks } });
      expect(again.ok(), await again.text()).toBe(true);
    }
    await api.dispose();
  });

  test("the Home tour runs once: Next walks the steps, Skip marks it done, a second visit shows nothing, Replay the tour brings it back", async ({ page, playwright }) => {
    test.setTimeout(240_000);
    await openBusiness(page);
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });

    // Two coach marks never show at once: on a business with fewer than two finished cycles the first-Continue
    // callout may start first, and the tour waits for its "Got it".
    const home = page.locator(HOME_CARD);
    const firstContinue = page.locator(FIRST_CONTINUE);
    await expect(home.or(firstContinue).first()).toBeVisible({ timeout: LONG });
    if (await firstContinue.isVisible()) {
      await firstContinue.getByRole("button", { name: "Got it" }).click();
      await expect(firstContinue).toHaveCount(0);
    }

    // Step 1: the sidebar, ringed; the card is a non-modal popover (no backdrop) with the count and the three actions.
    await expect(home).toBeVisible({ timeout: LONG });
    await expect(home).toHaveAttribute("data-step", "1");
    await expect(home).toHaveAttribute("role", "dialog");
    await expect(home).toContainText("Your business, one place per department.");
    await expect(home.locator("[data-coachmark-count]")).toHaveText("1 of 5");
    await expect(page.locator("[data-coachmark='sidebar'][data-coachmark-active]")).toHaveCount(1);
    await expect(page.locator("[data-coachmark-ring][data-tour='home']")).toHaveCount(1);
    await expect(home.getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(page.getByTestId("app-shell")).not.toHaveAttribute("aria-hidden", "true");

    // Step 2: Continue in the top bar.
    await home.getByRole("button", { name: "Next" }).click();
    await expect(home).toHaveAttribute("data-step", "2");
    await expect(home).toContainText("This runs the team; what they need from you lands in the Inbox.");
    await expect(page.locator("[data-coachmark='continue'][data-coachmark-active]")).toHaveCount(1);
    await expect(page.locator("[data-coachmark='sidebar'][data-coachmark-active]")).toHaveCount(0);

    // Step 3: the processing strip under it. Back goes to Continue again; the arrow keys move too.
    await home.getByRole("button", { name: "Next" }).click();
    await expect(home).toHaveAttribute("data-step", "3");
    await expect(home).toContainText("A light here means the team is working.");
    await expect(page.locator("[data-coachmark='processing-strip'][data-coachmark-active]")).toHaveCount(1);
    await home.getByRole("button", { name: "Back" }).click();
    await expect(home).toHaveAttribute("data-step", "2");
    await page.keyboard.press("ArrowRight");
    await expect(home).toHaveAttribute("data-step", "3");

    // Step 4: the status strip widget (stamped data-coachmark="status-strip" by the tour).
    await home.getByRole("button", { name: "Next" }).click();
    await expect(home).toHaveAttribute("data-step", "4");
    await expect(home).toContainText("anything marked Estimate is worked out, not measured.");
    await expect(page.locator("[data-widget='status_strip'][data-coachmark='status-strip'][data-coachmark-active]")).toHaveCount(1);

    // Skip tour ends it and marks it done in the account's row.
    await home.getByRole("button", { name: "Skip tour" }).click();
    await expect(home).toHaveCount(0);
    await expect(page.locator("[data-coachmark-active]")).toHaveCount(0);
    await expect(page.locator("[data-coachmark-ring]")).toHaveCount(0);
    const api = await devApi(playwright);
    await expect.poll(async () => (await readGuidance(api)).toursDone.home === true, { timeout: LONG }).toBe(true);

    // A second visit shows nothing.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });
    await settled(page);
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await expect(home).toHaveCount(0);

    // "Replay the tour" in Settings › Preferences clears the mark; Home shows the tour again, from the first step.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/settings/preferences`);
    const screen = settingsScreen(page);
    await expect(screen).toHaveAttribute("data-tab", "preferences", { timeout: LONG });
    await settled(page);
    const replay = screen.getByTestId("replay-tour");
    await expect(replay).not.toHaveAttribute("aria-disabled", "true");
    await replay.click();
    await expect(toast(page, "Starting over")).toBeVisible({ timeout: LONG });
    await expect(replay).toHaveAttribute("aria-disabled", "true");
    await expect.poll(async () => (await readGuidance(api)).toursDone.home, { timeout: LONG }).toBeUndefined();

    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });
    await settled(page);
    await expect(home.or(firstContinue).first()).toBeVisible({ timeout: LONG });
    if (await firstContinue.isVisible()) {
      await firstContinue.getByRole("button", { name: "Got it" }).click();
      await expect(firstContinue).toHaveCount(0);
    }
    await expect(home).toBeVisible({ timeout: LONG });
    await expect(home.locator("[data-coachmark-count]")).toHaveText("1 of 5");
    // Esc skips as well, and marks it done.
    await page.keyboard.press("Escape");
    await expect(home).toHaveCount(0);
    await expect.poll(async () => (await readGuidance(api)).toursDone.home === true, { timeout: LONG }).toBe(true);
    await api.dispose();
  });

  test("the Inbox and department tours start on their own first visits; with guidance off none of them starts", async ({ page, playwright }) => {
    test.setTimeout(240_000);
    const api = await devApi(playwright);
    await resetTours(api);

    // The Inbox: the list pane first (stamped by the tour), then the reading pane; with no decision open those are the
    // steps with a target, and Skip marks the tour done.
    await openBusiness(page, "inbox");
    await expect(page.getByTestId("inbox-pane")).toBeVisible({ timeout: LONG });
    const inbox = page.locator("[data-coachmark][data-tour='inbox']");
    await expect(inbox).toBeVisible({ timeout: LONG });
    await expect(inbox).toContainText("the tag on each one says what kind of note it is.");
    await expect(inbox.locator("[data-coachmark-count]")).toHaveText("1 of 4");
    await expect(page.locator("[data-testid='inbox-pane'][data-coachmark='inbox-pane'][data-coachmark-active]")).toHaveCount(1);
    await inbox.getByRole("button", { name: "Next" }).click();
    await expect(inbox).toHaveAttribute("data-step", "2");
    await expect(inbox).toContainText("A note says the fact, why it matters and what it asks.");
    await expect(page.locator("[data-testid='reading-pane'][data-coachmark-active]")).toHaveCount(1);
    await inbox.getByRole("button", { name: "Skip tour" }).click();
    await expect(inbox).toHaveCount(0);
    await expect.poll(async () => (await readGuidance(api)).toursDone.inbox === true, { timeout: LONG }).toBe(true);

    // A department tab: the tabs first; the explainer when the tab has one; Skip marks it done for every department.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/d/product/vision`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await settled(page);
    const department = page.locator("[data-coachmark][data-tour='department']");
    await expect(department).toBeVisible({ timeout: LONG });
    await expect(department).toContainText("Each tab is one screen of this department.");
    await expect(department.locator("[data-coachmark-count]")).toHaveText("1 of 3");
    await expect(page.locator("[role='tablist'][data-coachmark='tabs'][data-coachmark-active]")).toHaveCount(1);
    await department.getByRole("button", { name: "Skip tour" }).click();
    await expect(department).toHaveCount(0);
    await expect.poll(async () => (await readGuidance(api)).toursDone.department === true, { timeout: LONG }).toBe(true);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/d/finance/overview`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await settled(page);
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await expect(department).toHaveCount(0);

    // Guidance off: the tours are cleared again, and still none of them starts.
    await resetTours(api);
    const off = await api.post("/trpc/founder.preferences.update", { data: { json: { guidance: "off" } } });
    expect(off.ok(), await off.text()).toBe(true);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-grid")).toBeVisible({ timeout: LONG });
    await settled(page);
    await page.waitForLoadState("networkidle", { timeout: LONG });
    await expect(page.locator("[data-coachmark][data-tour]")).toHaveCount(0);
    await expect(page.locator("[data-coachmark-ring]")).toHaveCount(0);
    await api.dispose();
  });
});
