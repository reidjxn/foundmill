import { expect, test, type PlaywrightWorkerArgs } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, devApi, openBusiness, settingsScreen } from "./helpers";

/** The dev founder's guidance switch (Settings › Preferences): the guided layer renders only while it is on. */
async function guidanceOn(playwright: PlaywrightWorkerArgs["playwright"]): Promise<boolean> {
  const api = await devApi(playwright);
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { guidance: "on" | "off" } } } };
  await api.dispose();
  return body.result.data.json.guidance === "on";
}

/**
 * Home's first-visit tour and the first-Continue callout are tours.spec's and first-days.spec's to assert. Here they are
 * marked done before the page opens (what Skip tour and Got it do, for the whole dev account): an open card takes the
 * keyboard (Esc skips the tour instead of leaving Edit mode), and the callout's card sits over New below Continue.
 */
async function toursOutOfTheWay(playwright: PlaywrightWorkerArgs["playwright"]): Promise<void> {
  const api = await devApi(playwright);
  const res = await api.post("/trpc/founder.preferences.update", { data: { json: { toursDone: { home: true, "first-continue": true } } } });
  expect(res.ok(), `founder.preferences.update answered ${res.status()}`).toBe(true);
  await api.dispose();
}

/** Cycles Northwind's team has finished (`cycle.status.completedCount`): the seed has none; a spec that runs one adds one. */
async function cyclesCompleted(playwright: PlaywrightWorkerArgs["playwright"]): Promise<number> {
  const api = await devApi(playwright);
  const res = await api.get(`/trpc/cycle.status?input=${encodeURIComponent(JSON.stringify({ json: { businessId: NORTHWIND_BUSINESS_ID } }))}`);
  expect(res.ok(), `cycle.status answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { completedCount: number } } } };
  await api.dispose();
  return body.result.data.json.completedCount;
}

/** Home dashboards (BUILD §11.2, AC-11.2.4) on the seeded Northwind Skincare. Stack and commands: e2e/README.md. */
test.describe("home", () => {
  test.beforeEach(async ({ page, playwright }) => {
    await toursOutOfTheWay(playwright);
    await openBusiness(page);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
  });

  test("renders the active dashboard as a tab with the widget grid", async ({ page }) => {
    const screen = page.getByTestId("home-screen");
    await expect(screen).toHaveAttribute("data-dashboard-id", /[0-9a-f-]{36}/);
    await expect(page.getByTestId("home-grid")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Dashboards" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Dashboards" }).getByRole("tab", { selected: true })).toBeVisible();
  });

  test("the status strip's runway agrees with the top bar, and inbox rows wrap instead of clipping", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Status" });
    await expect(strip).toBeVisible({ timeout: LONG });
    await expect(strip.getByText("Runway", { exact: true })).toBeVisible({ timeout: LONG });
    const bar = page.getByTestId("kit-bar");
    // No runway figure: the bar and the tile say the same words, never a bare dash: "No limit" when cash-flow
    // positive, "Not known yet" without a bank or enough history, "Cash is below zero" when the balance is negative
    // (the shared runway wording, UX plan B8), the reason under the tile and in the bar's tooltip.
    await expect(bar).not.toContainText("No runway yet");
    const barWords = bar.locator("[data-runway-words]");
    if (await barWords.count()) {
      const words = (await barWords.innerText()).trim();
      expect(words).toMatch(/^(No limit|Not known yet|Cash is below zero)$/);
      await expect(strip.getByText(words, { exact: true })).toBeVisible({ timeout: LONG });
    }
    // Inbox preview rows: the subject wraps to two lines; nothing in a row is cut sideways.
    const rows = page.locator("[data-inbox-row]");
    if (await rows.count()) {
      const clipped = await rows.evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll<HTMLElement>("*")]).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === "ellipsis").length);
      expect(clipped).toBe(0);
    }
  });

  test("the status strip and the department cards speak in words, with the formula kept for the provenance tooltip", async ({ page }) => {
    const strip = page.getByRole("region", { name: "Status" });
    await expect(strip).toBeVisible({ timeout: LONG });
    // "Team health" with its count (UX plan B10), never "Business health"; runway captioned in words (B9).
    await expect(strip.getByText("Team health", { exact: true })).toBeVisible({ timeout: LONG });
    await expect(strip).not.toContainText("Business health");
    await expect(strip).toContainText(/\d+ of \d+ \w+ healthy|No \w+ hired yet/, { timeout: LONG });
    await expect(strip).toContainText(/Months of cash left|Under \d+ months of cash left|No limit|Not known yet|Cash is below zero/, { timeout: LONG });
    await expect(strip).toContainText("Money in this month");
    await expect(strip).toContainText(/Paying \w+, last 7 days/);
    // The formula is the provenance tooltip's, not a caption: nothing on the strip reads "Cash ÷ net burn" or "Cash basis".
    await expect(strip).not.toContainText("÷");
    await expect(strip).not.toContainText("Cash basis");
    await expect(strip.getByRole("button", { name: /Where this number comes from: Cash ÷ net burn/ })).toHaveCount(1);
    // Department cards: "Working on now" and "Next" (E6), the team strip counting agents on a task (B19).
    const card = page.locator("[data-department]").first();
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(card).toContainText("Working on now");
    await expect(card).toContainText("Next");
    await expect(card).not.toContainText("Next up");
    await expect(card).not.toContainText("Nothing queued");
    await expect(card.locator("[data-team-strip-words]")).toHaveText(/^\d+ of \d+ working$|^\d+ agents?, |^No agents yet$/);
  });

  test("the guided layer on Home: defined words on the strip, plain words under every figure, the next step in one line (UX plan §7.8)", async ({ page, playwright }) => {
    const guided = await guidanceOn(playwright);
    const strip = page.getByRole("region", { name: "Status" });
    await expect(strip).toBeVisible({ timeout: LONG });
    await expect(strip.locator("[data-metric-tile][aria-busy='true']")).toHaveCount(0, { timeout: LONG });
    // "Runway" and "Revenue this month" are defined words (Term) on their tiles' labels, whatever the switch.
    const runway = strip.locator("[data-term='runway']");
    await expect(runway).toHaveText("Runway");
    await expect(strip.locator("[data-term='revenue']")).toContainText("Revenue");
    if (guided) {
      // Dotted means something to learn: the word is a button whose definition opens on hover and focus.
      expect(await runway.evaluate((el) => el.tagName)).toBe("BUTTON");
      // Hover (or a real Tab) opens it: a script's focus() does not, by design (guidance/keyboardFocus.ts).
      await runway.hover();
      const card = page.locator("[data-definition-card]");
      await expect(card).toBeVisible({ timeout: LONG });
      await expect(card).toContainText("How many months your cash lasts at today's spending.");
      await page.keyboard.press("Escape");
      await expect(card).toHaveCount(0);
      // Every tile says its figure in plain words under it.
      const tiles = await strip.locator("[data-metric-tile]").count();
      await expect(strip.locator("[data-metric-tile] [data-plain-line]")).toHaveCount(tiles, { timeout: LONG });
      // Northwind is past Home's day one (it has customers), so the next step sits on its own plate above the grid,
      // never in the Day one panel. Once a cycle has finished it is the one most relevant line; before that (the seed
      // finishes none, and a seeded business has no first draft to read) it is the notes, if any, then Continue
      // (nextStepsFor's "none" foundations case, UX plan §6.2 NextStep).
      const next = page.getByTestId("next-step-strip");
      await expect(next).toBeVisible({ timeout: LONG });
      if ((await cyclesCompleted(playwright)) > 0) {
        await expect(next.locator("[data-next-step]")).toHaveAttribute("data-rows", "1");
        await expect(next).toContainText(/needs? your answer|is running|new notes? from the team|Start distribution|Nothing waiting/);
      } else {
        await expect(next.locator("[data-next-step]")).toHaveAttribute("data-rows", /^[12]$/);
        await expect(next.locator("[data-next-step-row]").last()).toContainText(/Press Continue|is running/);
      }
      await expect(page.getByTestId("day-one")).toHaveCount(0);
      // The Edit key cap is an operator's affordance: it shows only when guidance is off; the shortcut works either way.
      await expect(page.getByTestId("edit-layout").locator("kbd")).toHaveCount(0);
      // The Autopilot sentence beside the chip defines its first word.
      await expect(page.getByTestId("home-autopilot").locator("[data-autopilot-guide] [data-term='autopilot']")).toHaveText("Autopilot", { timeout: LONG });
    } else {
      await expect(runway).toHaveAttribute("data-guided", "off");
      await expect(strip.locator("[data-plain-line]")).toHaveCount(0);
      await expect(page.getByTestId("next-step-strip")).toHaveCount(0);
      await expect(page.getByTestId("edit-layout").locator("kbd")).toHaveCount(1);
      await expect(page.getByTestId("home-autopilot").locator("[data-autopilot-guide]")).toHaveCount(0);
    }
  });

  test("the Team pulse hour labels fit their boxes at 1280 px, one every three hours", async ({ page }) => {
    // Each label's box spans three hour columns; at one column (about 24 px) "12 AM" spilled out (no-clip.spec, Oct 2026).
    await page.setViewportSize({ width: 1280, height: 900 });
    // Seeded on Northwind's Home (`squad_pulse` in the seed's dashboard); it renders once its data has loaded, so wait
    // for it rather than counting at once. An earlier edit of the dashboard may have removed it.
    const pulse = page.locator("[data-squad-pulse]").first();
    const shown = await pulse.waitFor({ state: "visible", timeout: LONG }).then(
      () => true,
      () => false,
    );
    test.skip(!shown, "the active dashboard has no Team pulse widget");
    const labels = () => pulse.locator("[role=columnheader]:not(.sr-only)").evaluateAll((els) => els.map((el) => ({ text: el.textContent ?? "", box: el.clientWidth, needs: el.scrollWidth })));
    await expect.poll(async () => (await labels()).map((l) => l.text), { timeout: LONG }).toEqual(["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]);
    // Polled while the grid settles at the new width; a label too wide for its box never passes.
    await expect.poll(async () => (await labels()).filter((l) => l.needs > l.box + 1).map((l) => `"${l.text}" ${l.box}<${l.needs}`), { timeout: LONG }).toEqual([]);
    await expect(pulse.locator("[role=columnheader]")).toHaveCount(24);
  });

  test("E toggles Edit mode; the toolbar button mirrors it; Esc leaves it", async ({ page }) => {
    // The shortcut works whether or not the key cap shows (it shows only when guidance is off, UX plan §7.7).
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-keyshortcuts", "E");
    await page.keyboard.press("e");
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-screen")).not.toHaveAttribute("data-editing", "true");
    await expect(page.getByTestId("edit-layout")).toHaveAttribute("aria-pressed", "false");
  });

  test("a new dashboard from New never becomes the default Home", async ({ page }) => {
    const first = (await page.getByTestId("home-screen").getAttribute("data-dashboard-id"))!;
    await page.getByTestId("new-dashboard").click();
    await page.locator("[data-preset=investor]").click();
    await page.waitForURL(/\/home\/[0-9a-f-]{36}/, { timeout: LONG });
    const second = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    expect(second).not.toBe(first);
    // /home still opens the original dashboard.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-dashboard-id", first, { timeout: LONG });
    // Clean up: delete the new tab.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home/${second}`);
    await page.getByTestId("dashboard-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByTestId("confirm-delete-dashboard").click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
  });

  test("AC-11.2.4: a second dashboard works independently, persists its version and can be deleted", async ({ page }) => {
    const first = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    await page.getByTestId("new-dashboard").click();
    await page.locator("[data-preset=seller]").click();
    await page.waitForURL(/\/home\/[0-9a-f-]{36}/, { timeout: LONG });
    const second = await page.getByTestId("home-screen").getAttribute("data-dashboard-id");
    expect(second).not.toBe(first);
    const version = Number(await page.getByTestId("home-screen").getAttribute("data-dashboard-version"));
    expect(version).toBeGreaterThanOrEqual(1);
    // Two tabs at least: the original and the new one.
    expect(await page.getByRole("tablist", { name: "Dashboards" }).getByRole("tab").count()).toBeGreaterThanOrEqual(2);
    await page.getByTestId("dashboard-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByTestId("confirm-delete-dashboard").click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home$`), { timeout: LONG });
    await expect(page.getByTestId("home-screen")).toHaveAttribute("data-dashboard-id", first!);
  });
});

/** Home's Autopilot chip: always there, in words (Off, On, Needs your answer, Paused: reason); it opens Settings > Mode. */
test.describe("home > Autopilot chip", () => {
  test("shows the state and opens Settings > Mode", async ({ page }) => {
    await openBusiness(page);
    const chip = page.getByTestId("home-autopilot").getByTestId("autopilot-chip");
    await expect(chip).toBeVisible({ timeout: LONG });
    await expect(chip).toContainText("Autopilot");
    await expect(chip).toHaveAttribute("data-autopilot-state", /^(off|on|waiting|paused)$/);
    await chip.click();
    await expect(page).toHaveURL(/\/settings\/mode$/);
    await expect(settingsScreen(page).getByTestId("autopilot-section")).toBeVisible({ timeout: LONG });
  });
});

/**
 * Home's blocker banner (Nov 1, 2026): when the team's last round of work could not start (the model account out of
 * credit, no key) and nothing has run since, Home says so at the top, with the way to fix it, instead of "Healthy". The
 * seed has no failed cycle, so `cycle.status` is rewritten on the way to the page.
 */
test.describe("home > blocker banner", () => {
  test("a last cycle that failed for credit is a banner at the top of Home with the way to Settings › Keys", async ({ page }) => {
    await page.route(/\/trpc\/[^?]*cycle\.status/, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as unknown;
      const failed = { lastOutcome: "failed", running: false, lastFailure: { kind: "billing", message: "The model account has no credit left, so the team could not start.", at: new Date().toISOString() } };
      const rewrite = (entry: unknown) => {
        const data = (entry as { result?: { data?: { json?: Record<string, unknown> } } }).result?.data?.json;
        if (data && "completedCount" in data) Object.assign(data, failed);
      };
      if (Array.isArray(body)) body.forEach(rewrite);
      else rewrite(body);
      await route.fulfill({ response, body: JSON.stringify(body), headers: { ...response.headers(), "content-type": "application/json" } });
    });
    await openBusiness(page);
    const banner = page.getByTestId("home-blocker");
    await expect(banner).toBeVisible({ timeout: LONG });
    await expect(banner).toHaveAttribute("data-blocker-kind", "billing");
    await expect(banner.getByRole("heading", { name: "The team's model account is out of credit" })).toBeVisible();
    await expect(banner).toContainText("no credit left");
    await expect(banner).toContainText("Team stopped");
    await banner.getByRole("button", { name: "Open Settings › Keys" }).click();
    await expect(page).toHaveURL(/\/settings\/keys$/, { timeout: LONG });
  });

  test("a completed last cycle shows no banner", async ({ page }) => {
    await openBusiness(page);
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("home-blocker")).toHaveCount(0);
  });
});
