import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, expectTapTarget } from "./helpers";

/**
 * The sign-in page at 1280 and 390 px (CLAUDE.md "Small screens": sign-in works from 390 px): the frame renders at both
 * widths with no horizontal scroll and 44 px targets, the notices a callback sends back included, and Continue with
 * Google is there exactly when NEXT_PUBLIC_AUTH_GOOGLE=on. The stack has no Supabase, so with the flag on the button
 * meets its own "isn't available" line and the email form stays as it was; the developer sign-in still works. Run it
 * twice to see both states (e2e/README.md): as is (off, what CI runs) and with NEXT_PUBLIC_AUTH_GOOGLE=on given to the
 * runner and the web server.
 */
const GOOGLE_ON = process.env.NEXT_PUBLIC_AUTH_GOOGLE?.trim().toLowerCase() === "on";
const SUPABASE_STUB = process.env.E2E_SUPABASE_STUB === "1";
const WIDTHS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const;

async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const small = width < 600;
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, hasTouch: small, isMobile: small });
  return { page: await context.newPage(), close: () => context.close() };
}

async function expectFits(page: Page, width: number, what: string): Promise<void> {
  await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what}: horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
  // Every control on the panel is a 44 px target and inside the viewport.
  const controls = page.getByTestId("brand-panel").locator("button, [data-input-wrapper]");
  const count = await controls.count();
  expect(count, `${what}: controls on the panel`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = (await controls.nth(i).boundingBox())!;
    const name = (await controls.nth(i).getAttribute("aria-label")) ?? (await controls.nth(i).textContent()) ?? (await controls.nth(i).getAttribute("name"));
    await expectTapTarget(box, `${what}: ${name} is a 44 px target at ${width} px`);
    expect(box.x + box.width, `${what}: ${name} inside ${width} px`).toBeLessThanOrEqual(width);
  }
}

for (const { width, height } of WIDTHS) {
  test.describe(`sign-in page at ${width} px`, () => {
    test(`renders the email form ${GOOGLE_ON ? "under Continue with Google" : "without Continue with Google (the flag is off)"}, with no horizontal scroll and 44 px targets`, async ({ browser }) => {
      const { page, close } = await visitor(browser, width, height);
      try {
        await page.goto("/login");
        await expect(page.getByTestId("login-form")).toBeVisible({ timeout: LONG });
        await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
        await expect(page.getByLabel("Email")).toBeVisible();
        const google = page.getByRole("button", { name: "Continue with Google" });
        if (GOOGLE_ON) {
          await expect(google).toBeVisible();
          // Above the email form.
          const [g, form] = [(await google.boundingBox())!, (await page.getByTestId("login-form").boundingBox())!];
          expect(g.y + g.height).toBeLessThanOrEqual(form.y);
          await expect(google.locator("[data-google-mark]")).toBeVisible();
        } else {
          await expect(google).toHaveCount(0);
          await expect(page.getByTestId("login-google")).toHaveCount(0);
        }
        await expect(page.getByText("Sign-in works on any screen.", { exact: false })).toBeVisible();
        await expectFits(page, width, "the form");
      } finally {
        await close();
      }
    });

    test("the notices a callback sends back fit too, above a form that still works", async ({ browser }) => {
      const { page, close } = await visitor(browser, width, height);
      try {
        for (const [error, title] of [
          ["other_address", "Link opened on a different address"],
          ["signups_closed", "New sign-ups are closed"],
          ["google_failed", "Google sign-in didn't finish"],
          ["google_unverified", "Google address not verified"],
        ] as const) {
          await page.goto(`/login?error=${error}&next=%2Fb%2Fx`);
          await expect(page.getByTestId("login-link-problem")).toContainText(title, { timeout: LONG });
          await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
          await expectFits(page, width, `the ${error} notice`);
        }
      } finally {
        await close();
      }
    });

    test("a Google sign-in Supabase refused for closed sign-ups comes back through the callback as the plain notice, not a broken page", async ({ browser }) => {
      const { page, close } = await visitor(browser, width, height);
      try {
        await page.goto("/auth/callback?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed&via=google&next=%2Fb%2Fx");
        // The e2e stack has no Supabase, so the callback reports that first; with Supabase the reason is signups_closed
        // (app/__tests__/auth-callback.test.ts).
        await expect(page).toHaveURL(/\/login\?error=(not_configured|signups_closed)&next=%2Fb%2Fx$/, { timeout: LONG });
        await expect(page.getByTestId("login-link-problem")).toBeVisible();
        await expectFits(page, width, "the callback's notice");
      } finally {
        await close();
      }
    });

    test("once the email is sent: at 390 px the code field comes before the link sentence; on a desktop the link comes first (WP-03 T4)", async ({ browser }) => {
      // The stack has no Supabase, so the form cannot send. With a web built against a stand-in Supabase address
      // (E2E_SUPABASE_STUB=1, e2e/README.md) the browser's send is answered here and the sent state is shown.
      test.skip(!SUPABASE_STUB, "needs the web built with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (and E2E_SUPABASE_STUB=1 here)");
      const { page, close } = await visitor(browser, width, height);
      try {
        await page.route("**/auth/v1/otp**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.getByLabel("Email").fill("new-person@example.com");
        await page.getByRole("button", { name: "Send sign-in link" }).click();
        const sent = page.getByTestId("login-sent");
        await expect(sent).toBeVisible({ timeout: LONG });
        await expect(sent.getByText("Check your email")).toBeVisible();
        const code = (await page.getByTestId("login-code").boundingBox())!;
        if (width < 1280) {
          await expect(sent.getByText("Type the 6-digit code we sent to new-person@example.com.")).toBeVisible();
          const link = (await sent.getByText("Or open the link in that email on this device.").boundingBox())!;
          expect(code.y + code.height).toBeLessThanOrEqual(link.y);
        } else {
          const link = (await sent.getByText(/for a sign-in link and open it in this browser/).boundingBox())!;
          expect(link.y + link.height).toBeLessThanOrEqual(code.y);
        }
        await expectFits(page, width, "the sent state");
      } finally {
        await close();
      }
    });

    if (GOOGLE_ON) {
      test("Continue with Google that cannot start says so under the button and keeps the email form", async ({ browser }) => {
        const { page, close } = await visitor(browser, width, height);
        try {
          await page.goto("/login");
          const google = page.getByRole("button", { name: "Continue with Google" });
          await expect(google).toBeVisible({ timeout: LONG });
          // Hydrated before the click (the button's handler arrives with the page's script).
          await page.waitForLoadState("networkidle");
          await google.click();
          const error = page.getByTestId("login-google-error");
          await expect(error).toHaveText("Google sign-in isn't available right now. Use the email link below.");
          await expect(page).toHaveURL(/\/login$/);
          await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
          await expect(page.getByLabel("Email")).toBeVisible();
          await expectFits(page, width, "the Google error");
        } finally {
          await close();
        }
      });
    }
  });
}

test("the developer sign-in still works from the page (the stack's stand-in for the email link), with next", async ({ browser }) => {
  const { page, close } = await visitor(browser, 1280, 900);
  try {
    await page.goto(`/login?next=${encodeURIComponent(`/b/${NORTHWIND_BUSINESS_ID}/home`)}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Continue as developer" }).click();
    await page.waitForURL(new RegExp(`/b/${NORTHWIND_BUSINESS_ID}/home|/onboarding`), { timeout: LONG });
  } finally {
    await close();
  }
});
