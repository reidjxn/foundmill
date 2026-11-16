import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { LONG, devApi, signInAs } from "./helpers";

/**
 * "I am 18 or older", confirmed once at sign-up, for the whole product (CLAUDE.md, founder 2026-11-11; the api's
 * `adult_confirmations`, 0100). Stack and commands: e2e/README.md.
 *
 *   - 1280 px: a new account meets the box on the profile form; Continue stays on the form until it is ticked, then the
 *     profile is created and the person goes on; editing the profile afterwards never shows the box again;
 *   - 390 px: the sign-in page says the age and has no box (it is asked once, after the first sign-in, never on every
 *     sign-in); an invitation shows the box above Accept for a new account, at 44 px, without horizontal scroll, and
 *     Accept waits for it; the seeded founder, who confirmed long ago, is never shown it.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe("18 or older at sign-up", () => {
  test("1280 px: a new account confirms on the profile form, once", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await signInAs(page, randomUUID(), "/onboarding");
      await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
      const adult = page.getByTestId("profile-adult");
      await expect(adult).toContainText("I am 18 or older");
      await expect(adult).toContainText("You confirm this once.");
      await page.getByLabel(/What the team calls you/).fill("Adult Founder");
      await page.getByLabel("First-time founder").check();
      await page.getByLabel("Full time").check();
      // Without the box, nothing is saved and the form says why.
      await page.getByTestId("profile-submit-bottom").click();
      await expect(adult).toContainText("Confirm that you are 18 or older to continue.");
      await expect(page).toHaveURL(/\/onboarding$/);
      // With it, the save that creates the profile carries it.
      await adult.getByRole("checkbox", { name: "I am 18 or older" }).check();
      const save = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("founder.profile.update"), { timeout: LONG });
      await page.getByTestId("profile-submit-bottom").click();
      expect((await save).postData() ?? "").toContain('"confirmAdult":true');
      await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
      // Never asked again: the profile opens for editing without the box.
      await page.goto("/onboarding");
      await expect(page.getByTestId("profile-submit")).toHaveText(/Save and continue/, { timeout: LONG });
      await expect(page.getByTestId("profile-adult")).toHaveCount(0);
      await expect(page.getByTestId("adult-step")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("390 px: the sign-in page names the age and asks for nothing on every sign-in", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await expect(page.getByTestId("login-legal")).toContainText("18 or older", { timeout: LONG });
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
      await noHorizontalScroll(page);
    } finally {
      await context.close();
    }
  });

  test("390 px: an invitee confirms once on the invitation; Accept waits for the box", async ({ browser, playwright }) => {
    // A link-only collaborator invitation (any account may take it) to a project of the seeded founder's own: the
    // seeded businesses are samples, which nobody can be invited to, so one is started here through the api.
    const api = await devApi(playwright);
    let path: string;
    try {
      const drafted = await api.post("/trpc/idea.generate", { data: { json: { prompt: "bike repair bookings for commuters" } } });
      expect(drafted.ok(), `idea.generate answered ${drafted.status()}: ${await drafted.text()}`).toBe(true);
      const ideaId = ((await drafted.json()) as { result: { data: { json: { ideas: { id: string }[] } } } }).result.data.json.ideas[0]!.id;
      const committed = await api.post("/trpc/idea.commit", { data: { json: { ideaId, name: "Adult Check Cycles", archetype: "b2b_saas" } } });
      expect(committed.ok(), `idea.commit answered ${committed.status()}: ${await committed.text()}`).toBe(true);
      const businessId = ((await committed.json()) as { result: { data: { json: { business: { id: string } } } } }).result.data.json.business.id;
      const made = await api.post("/trpc/invitation.create", { data: { json: { businessId, role: "collaborator" } } });
      expect(made.ok(), `invitation.create answered ${made.status()}: ${await made.text()}`).toBe(true);
      path = new URL(((await made.json()) as { result: { data: { json: { link: string } } } }).result.data.json.link).pathname;
    } finally {
      await api.dispose();
    }

    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    try {
      await signInAs(page, randomUUID(), path);
      await expect(page.getByTestId("invitation")).toHaveAttribute("data-state", "pending", { timeout: LONG });
      const adult = page.getByTestId("invitation-adult");
      await expect(adult).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
      await noHorizontalScroll(page);
      expect((await adult.getByText("I am 18 or older").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByTestId("invitation-accept").click();
      await expect(adult).toContainText("Confirm that you are 18 or older to accept.");
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await adult.getByRole("checkbox", { name: "I am 18 or older" }).check();
      const accept = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("invitation.accept"), { timeout: LONG });
      await page.getByTestId("invitation-accept").click();
      expect((await accept).postData() ?? "").toContain('"confirmAdult":true');
      // A new account names itself on the card before it goes into the project (WP-12 T2).
      await page.getByTestId("invitation-name").fill("Adult Check", { timeout: LONG });
      await page.getByTestId("invitation-continue").click();
      await page.waitForURL((u) => !u.pathname.startsWith("/i/"), { timeout: LONG });
    } finally {
      await context.close();
    }
  });
});
