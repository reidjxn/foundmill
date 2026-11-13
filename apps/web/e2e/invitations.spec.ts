import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { commitThrowaway, LONG, openSettings, signIn, signInAs } from "./helpers";

/**
 * Invitations to a project and the way in (THESIS_REVIEW packages 2.2, 3.1 and 3.3; docs/DESIGN.md §9f). Stack and
 * commands: e2e/README.md.
 *
 *   - Settings › People: "Invite someone" as a cofounder makes a link shown once; the invitation is listed as waiting;
 *     Revoke takes it away and its link stops working;
 *   - `/i/<token>` signed out at 390 px: who invited you, to what, as what, "Sign in to accept" that comes back here, no
 *     horizontal scroll, every control at least 44 px tall, never indexed;
 *   - a second account (the dev sign-in's `as`) signs in, accepts and is taken into the project as a cofounder, and the
 *     owner's People list shows them as one;
 *   - with open sign-up at a ceiling of 0 (`E2E_SIGNUP_CEILING=0`, the api started with `SIGNUP_OPEN=1
 *     SIGNUP_DAILY_CEILING=0`), a new account that signs in meets "You're on the list." at 390 px on whatever page it
 *     opened, with Sign out and a link onward; and the invited account above got in all the same (an invitation is an
 *     admission). Skipped on a stack without it.
 */
const PHONE = { width: 390, height: 844 };

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function invite(page: Page, bid: string, role: "Cofounder" | "Collaborator"): Promise<string> {
  const screen = await openSettings(page, "members", bid);
  await expect(screen.getByRole("heading", { name: "People", exact: true }).first()).toBeVisible();
  const panel = screen.getByTestId("invite-someone");
  await panel.getByLabel(role).check();
  await panel.getByTestId("invite-create").click();
  const link = (await screen.getByTestId("invite-link-value").textContent({ timeout: LONG }))!.trim();
  expect(link).toMatch(/\/i\/[A-Za-z0-9_-]{43}$/);
  return new URL(link).pathname;
}

test.describe("invitations", () => {
  test.describe.configure({ mode: "serial" });
  let bid = "";
  let path = "";

  test("a founder invites a cofounder from Settings › People; revoking an invitation stops its link", async ({ page }) => {
    bid = await commitThrowaway(page, "Invitation Bakery");
    // Revoke first: a collaborator invitation, listed as waiting, then gone, its link no longer works.
    const revoked = await invite(page, bid, "Collaborator");
    const list = page.getByTestId("invitation-list");
    await expect(list.getByTestId("invitation-row")).toHaveCount(1);
    await list.getByTestId("invitation-revoke").click();
    await expect(page.getByTestId("invitation-list")).toHaveCount(0, { timeout: LONG });
    await page.goto(revoked);
    await expect(page.getByTestId("invitation")).toHaveAttribute("data-state", "unavailable", { timeout: LONG });
    // The cofounder invitation used below.
    path = await invite(page, bid, "Cofounder");
    await expect(page.getByTestId("invitation-list").getByTestId("invitation-row")).toHaveCount(1);
    // The old silent add is gone.
    await expect(page.getByText(/account ID/i).first()).toBeHidden();
  });

  test("the invitation, signed out, at 390 px", async ({ browser }) => {
    test.skip(!path, "needs the invitation made above");
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    const response = await page.goto(path);
    expect(response?.headers()["cache-control"] ?? "").not.toMatch(/public/);
    const card = page.getByTestId("invitation");
    await expect(card).toHaveAttribute("data-state", "pending", { timeout: LONG });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/invited you to Invitation Bakery/);
    await expect(page.getByText("As a cofounder")).toBeVisible();
    const signIn = page.getByTestId("invitation-sign-in");
    expect(await signIn.getAttribute("href")).toBe(`/login?next=${encodeURIComponent(path)}`);
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
    await noHorizontalScroll(page);
    for (const control of await card.locator("a, button").all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test("a second account signs in, accepts, and is taken into the project", async ({ browser }) => {
    test.skip(!path, "needs the invitation made above");
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, randomUUID(), path);
    await expect(page.getByTestId("invitation")).toHaveAttribute("data-state", "pending", { timeout: LONG });
    await page.getByTestId("invitation-accept").click();
    // Into the project; a new person first meets their profile (the project's layout asks for it).
    await page.waitForURL(new RegExp(`/b/${bid}/|/onboarding`), { timeout: LONG });
    await expect(page.getByTestId("on-waitlist")).toHaveCount(0);
    await expect(page.getByTestId("not-invited")).toHaveCount(0);
    // The link is used up.
    await page.goto(path);
    await expect(page.getByTestId("invitation")).toHaveAttribute("data-state", "unavailable", { timeout: LONG });
    await context.close();
  });

  test("the owner's People list shows the new cofounder, and nothing is waiting", async ({ page }) => {
    test.skip(!path, "needs the invitation accepted above");
    await signIn(page);
    const screen = await openSettings(page, "members", bid);
    await expect(screen.getByTestId("member-list").getByTestId("member-meta").filter({ hasText: /^Cofounder · since / })).toHaveCount(1, { timeout: LONG });
    await expect(screen.getByTestId("invitation-list")).toHaveCount(0);
  });
});

test.describe("open sign-up past the day's ceiling", () => {
  test.skip(process.env.E2E_SIGNUP_CEILING !== "0", "needs the api started with SIGNUP_OPEN=1 SIGNUP_DAILY_CEILING=0 (and E2E_SIGNUP_CEILING=0 here)");

  test("a new account that signs in meets \"You're on the list.\" at 390 px, with Sign out and a link onward", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    await signInAs(page, randomUUID(), "/start");
    const panel = page.getByTestId("on-waitlist");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're on the list.");
    await expect(panel.getByText("We'll email you when you're in.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Look around an example" })).toHaveAttribute("href", /^\/examples\//);
    await noHorizontalScroll(page);
    for (const control of await panel.locator("a, button").all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Any page that asks the api says the same, never a dead end or a request for a larger window.
    await page.goto("/new");
    await expect(page.getByTestId("on-waitlist")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    // Sign out works from here.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/, { timeout: LONG });
    await context.close();
  });
});
