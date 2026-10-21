import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import {
  DEMO_OWNER_DISPLAY_NAME,
  LONG,
  NORTHWIND_BUSINESS_ID,
  completeProfile,
  devApi,
  readFounderProfile,
  restoreFounderProfile,
  type FounderProfileSnapshot,
} from "./helpers";

/** The dev founder's guidance switch (Settings › Preferences): the example founder is offered only while it is on. */
async function guidanceOn(playwright: PlaywrightWorkerArgs["playwright"]): Promise<boolean> {
  const api = await devApi(playwright);
  const res = await api.get("/trpc/founder.preferences.guidance");
  expect(res.ok(), `founder.preferences.guidance answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { guidance: "on" | "off" } } } };
  await api.dispose();
  return body.result.data.json.guidance === "on";
}

/**
 * /onboarding — the founder profile (BUILD §11.1, AC-11.1.1; docs/UX_AUDIT_AND_PLAN.md §7.3 two passes). Stack and
 * commands: e2e/README.md. This file runs before every other spec (the `profile` project in playwright.config.ts): on
 * a database seeded with SEED_OWNER_PROFILE=0 the first test meets the gate and saves the profile; on a later run it
 * finds the profile saved and asserts the other half of the contract (business routes open, the form is pre-filled).
 *
 * The tests save the profile as "Playwright Founder". The dev founder is the one every other spec and screen shows, so
 * the profile as it was before this file is put back when it finishes (`restoreFounderProfile`).
 */

/** Opens "Add detail (optional, improves the ideas)" when it is closed (a first-timer's default; a saved profile opens it). */
async function openDetail(page: Page): Promise<void> {
  const toggle = page.getByTestId("profile-detail-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test.describe("onboarding", () => {
  let before: FounderProfileSnapshot | null = null;
  test.beforeAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    before = await readFounderProfile(api);
    await api.dispose();
  });
  test.afterAll(async ({ playwright }) => {
    const api = await devApi(playwright);
    await restoreFounderProfile(api, before);
    // The name every screen shows is the one it had before (or the seed's, when this file created the profile).
    expect((await readFounderProfile(api))?.displayName).toBe(
      before?.displayName ?? DEMO_OWNER_DISPLAY_NAME,
    );
    await api.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(/\/b\/[0-9a-f-]+\/|\/onboarding|\/new/, { timeout: LONG });
  });

  test("AC-11.1.1: a founder without a profile is held at /onboarding from / and /b/* and /new until the profile is saved", async ({
    page,
  }) => {
    // `/` sends a founder without a profile to /onboarding and everyone else to a business Home or /new.
    const gated = /\/onboarding/.test(page.url());
    test
      .info()
      .annotations.push({
        type: "profile",
        description: gated
          ? "missing: gate exercised, then the profile was saved"
          : "present: the gate stays closed and the pre-filled form saves",
      });
    if (/^(1|true|yes)$/i.test(process.env.E2E_EXPECT_PROFILE_GATE ?? ""))
      expect(
        gated,
        "E2E_EXPECT_PROFILE_GATE is set: `/` must redirect the dev user to /onboarding",
      ).toBe(true);
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("profile-submit")).toHaveText(
      gated ? /^Continue$/ : /Save and continue/,
    );
    if (gated) {
      // The gate: /b/* and /new/* both bounce to /onboarding before the profile exists.
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/new/ideate");
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/businesses");
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.goto("/onboarding");
      await completeProfile(page);
    } else {
      await page.getByTestId("profile-submit-bottom").click();
      await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
      await expect(page.getByTestId("doors")).toBeVisible();
    }
    // With the profile saved, business routes and the studio open.
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await page.goto("/new/ideate");
    await expect(page).toHaveURL(/\/new\/ideate$/);
    await expect(page.getByTestId("prompt-box")).toBeVisible({ timeout: LONG });
    // `/` now resolves to a business Home (the seed owner owns Northwind and Ledgerly).
    await page.goto("/");
    await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/home/, { timeout: LONG });
  });

  test("two passes: four questions first, the rest behind Add detail, and the rail counts the optional section as one (§7.3, A1)", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    for (const id of ["name", "experience", "time", "place", "detail"])
      await expect(page.locator(`[data-section="${id}"]`)).toBeVisible();
    await expect(page.locator("[data-section-link]")).toHaveCount(5);
    await expect(page.getByRole("navigation", { name: "Profile sections" })).toContainText(
      "Add detail (optional)",
    );
    await expect(page.getByTestId("studio-frame")).toHaveAttribute("data-step", "profile");
    // Continue is there from the start; the optional section opens and closes, and holds the five sliders with their pickers.
    await expect(page.getByTestId("profile-submit")).toBeEnabled();
    await expect(page.locator('[data-section="detail"]')).toContainText(
      "Add detail (optional, improves the ideas)",
    );
    await openDetail(page);
    await expect(page.getByRole("slider")).toHaveCount(5);
    await expect(page.locator("[data-skill-anchors]")).toHaveCount(5);
    await expect(page.getByTestId("skill-legend")).toHaveText(
      "1–5 never done it · 6–10 could manage with help · 11–15 done it for real · 16–20 done it professionally",
    );
    await expect(page.getByTestId("profile-skills")).toContainText(
      "Be honest: the team hires to cover what you don't have.",
    );
    // A word sets the number; the band word beside the figure follows (one /20 scale with its word).
    await page
      .getByRole("group", { name: "Sales: level" })
      .getByRole("button", { name: "Expert" })
      .click();
    await expect(page.locator('[data-skill-value="sales"]')).toHaveText("18");
    await expect(page.locator('[data-skill="sales"] [data-scale-label]')).toHaveText("Excellent");
    await page
      .getByRole("group", { name: "Sales: level" })
      .getByRole("button", { name: "Some" })
      .click();
    await expect(page.locator('[data-skill-value="sales"]')).toHaveText("8");
    // Empty is a choice: the "no budget" card sits beside the amount (A11).
    await expect(page.getByLabel("I have no budget yet")).toBeVisible();
    await page.getByTestId("profile-detail-toggle").click();
    await expect(page.getByTestId("profile-detail-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("slider")).toHaveCount(0);
    // A co-founder joining someone else's business finds their account ID here, before any business exists (WEB-12),
    // behind a disclosure so the first screen stays about the founder (A17).
    const account = page.getByTestId("profile-account-id");
    await account.locator("summary").click();
    await expect(account.getByTestId("account-id")).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("Show me an example fills every answer but the name with a labeled example founder, holds Continue, and Hide the example clears only what it filled (§6.2 ExampleToggle)", async ({
    page,
    playwright,
  }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    const toggle = page.getByTestId("profile-example-toggle");
    // Tutoring: no toggle, no example, while guidance is off.
    if (!(await guidanceOn(playwright))) {
      await expect(toggle).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Show me an example" })).toHaveCount(0);
      return;
    }
    const name = page.getByLabel(/What the team calls you/);
    const nameBefore = await name.inputValue();
    const residence = page.getByLabel("Residence");
    const residenceBefore = await residence.inputValue();
    await toggle.getByRole("button", { name: "Show me an example" }).click();
    // The section opens inside the dashed Example frame; the first-pass panels it filled carry the chip; the name stays.
    const frame = page.getByTestId("profile-detail-example");
    await expect(frame).toBeVisible();
    await expect(frame.getByText("Example", { exact: true })).toBeVisible();
    await expect(page.getByTestId("profile-detail-toggle")).toHaveAttribute("aria-expanded", "true");
    for (const id of ["experience", "time", "place"])
      await expect(page.locator(`[data-section="${id}"] [data-example-meta]`)).toHaveText("Example");
    await expect(page.locator('[data-section="name"] [data-example-meta]')).toHaveCount(0);
    await expect(name).toHaveValue(nameBefore);
    // The example founder: first time, evenings and weekends, £5,000, the UK, the UK and Ireland, two constraints, low risk.
    await expect(page.getByLabel("First-time founder")).toBeChecked();
    await expect(page.getByLabel("Evenings and weekends")).toBeChecked();
    await expect(residence).toHaveValue("United Kingdom");
    await expect(page.getByLabel(/Budget you can commit/)).toHaveValue(/^5,?000$/);
    await expect(page.locator('[data-section="detail"]').getByText("GBP").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Target markets chosen" })).toContainText("Ireland");
    await expect(page.getByRole("list", { name: "Constraints chosen" })).toContainText("Keep my day job for now");
    await expect(page.getByRole("list", { name: "Constraints chosen" })).toContainText("No physical inventory");
    await expect(page.getByLabel("Low", { exact: true })).toBeChecked();
    await expect(page.locator('[data-skill-value="domain"]')).toHaveText("16");
    await expect(page.getByTestId("profile-summary")).toContainText("First-time founder · evenings and weekends · GBP 5,000 · UK, Ireland");
    // Continue waits, and says why where the reassurance line was.
    await expect(page.getByTestId("profile-submit")).toBeDisabled();
    await expect(page.getByTestId("profile-submit-bottom")).toBeDisabled();
    await expect(page.getByTestId("profile-example-line")).toHaveText("Replace the example with your own answers to continue.");
    await expect(page.getByTestId("profile-reassurance")).toHaveCount(0);
    // Hide the example: what it filled goes back to what it was; Continue is live again; nothing was saved.
    await toggle.getByRole("button", { name: "Hide the example" }).click();
    await expect(frame).toHaveCount(0);
    await expect(page.locator("[data-example-meta]")).toHaveCount(0);
    await expect(residence).toHaveValue(residenceBefore);
    await expect(name).toHaveValue(nameBefore);
    await expect(page.getByTestId("profile-submit")).toBeEnabled();
    await expect(page.getByTestId("profile-example-line")).toHaveCount(0);
    await expect(page.getByTestId("profile-reassurance")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("refuses values the API would reject, inline and in plain words (audit FR-14)", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    await openDetail(page);
    await page.getByLabel(/Budget you can commit/).fill("99999999999999m");
    await page.getByTestId("profile-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: /Use a budget below/ })).toBeVisible();
    await expect(page.getByText(/budgetMinor|Too big/)).toHaveCount(0);
    // The country fields stop at 80 characters instead of accepting text the API refuses.
    const citizenship = page.locator("#profile-citizenship");
    await citizenship.fill("x".repeat(100));
    await expect(citizenship).toHaveValue("x".repeat(80));
  });

  test("refuses an incomplete profile, then saves and lands on /new", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
    const name = page.getByLabel(/What the team calls you/);
    await name.fill("");
    await page.getByTestId("profile-submit").click();
    // The field error and the footer count are both alerts: the name field's error is the one that matters here.
    await expect(
      page.getByRole("alert").filter({ hasText: "Tell the team what to call you." }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: /field(s)? to complete/ }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
    await name.fill("Playwright Founder");
    await page.getByLabel("First-time founder").check();
    await page.getByLabel("Full time").check();
    // Where you live says what it decides: the first market and the currency.
    await page.getByLabel("Residence").fill("United Kingdom");
    await expect(page.getByTestId("profile-place-derived")).toContainText(
      /Ideas will aim at UK first|Money is counted in/,
    );
    await openDetail(page);
    await page.getByLabel(/Budget you can commit/).fill("25k");
    // The chip input and its suggestions list share the "Target markets" label prefix; the textbox is the field.
    const markets = page.getByRole("textbox", { name: "Target markets" });
    await markets.fill("Nordics");
    await markets.press("Enter");
    await expect(page.getByRole("list", { name: "Target markets chosen" })).toContainText(
      "Nordics",
    );
    // A suggestion chip moves to the chosen list once picked (and is already there on a profile saved by an earlier run).
    const remoteOnly = page.getByRole("button", { name: "Remote only", exact: true });
    if (await remoteOnly.count()) await remoteOnly.click();
    await expect(page.getByRole("list", { name: "Constraints chosen" })).toContainText(
      "Remote only",
    );
    await page.getByLabel("Medium").check();
    // The summary names the currency by its ISO code before the grouped amount (the currency follows the residence
    // on a new profile; a stored profile keeps its own).
    await expect(page.getByTestId("profile-summary")).toContainText(
      /First-time founder · full time · [A-Z]{3} 25,000/,
    );
    await expect(page.getByText("5 of 5 done")).toBeVisible();
    await page.getByTestId("profile-submit-bottom").click();
    await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
    await expect(page.getByTestId("doors")).toBeVisible();
  });
});
