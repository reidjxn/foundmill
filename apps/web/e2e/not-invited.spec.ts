import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LONG, signInAs } from "./helpers";

/**
 * The gate at 390 px (docs/holistic-plan/WP-03-the-door.md T1). Stack and commands: e2e/README.md.
 *
 * With an invite-only stack (`E2E_SIGNUP_ALLOWLIST=1`, the api started with `SIGNUP_ALLOWLIST=someone-else@example.com`:
 * its own seeded PGlite directory and ports, as `invitations.spec.ts`'s ceiling case), a new account that signs in at
 * 390 px meets "A few people at a time" on `/start` in place (never a request for a larger window), its place is saved
 * on arrival without a press (or, where the save did not go through, "Save my place" is offered to try again), no
 * screen promises an email, nothing scrolls sideways, and every control is at least 44 px tall. Skipped on a stack
 * without the list (the shared stack is unrestricted).
 */
const PHONE = { width: 390, height: 844 };

test.describe("the not-invited page at 390 px", () => {
  test.skip(process.env.E2E_SIGNUP_ALLOWLIST !== "1", "needs the api started with SIGNUP_ALLOWLIST=someone-else@example.com (and E2E_SIGNUP_ALLOWLIST=1 here)");

  test("a new address meets the place-saved page on /start, with every control at least 44 px tall", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    await signInAs(page, randomUUID(), "/start");
    const panel = page.getByTestId("not-invited");
    await expect(panel).toBeVisible({ timeout: LONG });
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(panel).toHaveAttribute("data-reason", "not_listed");
    await expect(page.getByText("A few people at a time")).toBeVisible();
    await expect(page.getByText(/has a place in line$/)).toBeVisible();
    // The join runs on arrival: it settles into the saved line or, where it did not go through, the retry.
    await expect(panel.getByTestId("waitlist-joined").or(panel.getByRole("button", { name: "Save my place" }))).toBeVisible({ timeout: LONG });
    await expect(page.getByText(/email you when/i)).toHaveCount(0);
    // The stack runs platform mail on its mock, so the saved line promises no email (WP-03 T2: `waitlistEmails`).
    await expect(page.getByText(/We email/)).toHaveCount(0);
    // Once saved, the person's own link to share (WP-03 T10), and never a place number or a count.
    if (await panel.getByTestId("waitlist-joined").isVisible()) {
      const share = panel.getByTestId("waitlist-share");
      await expect(share).toBeVisible();
      await expect(share).toContainText(/\?via=w\.[a-z2-7]{10}/);
      await expect(share.getByRole("button", { name: "Copy link" })).toBeVisible();
      await expect(panel.getByText(/position|people ahead|#\d/i)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    for (const control of await panel.locator("a, button").all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/, { timeout: LONG });
    await context.close();
  });
});
