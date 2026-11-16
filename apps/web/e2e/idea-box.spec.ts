import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG } from "./helpers";

/**
 * The landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md) against the local stack (mock models, the mock
 * Turnstile token): a signed-out visitor types a line and gets a card streamed in, keeps it by signing in (the stack's
 * developer sign-in stands in for the email link), keeps it with one press, and lands on the card in their deck; "Try
 * another idea" replaces the card with one from edited words (WP-03 T7); on a phone at 390 px the hero
 * works on its own, Surprise me drafts from an interest, and nothing scrolls sideways.
 *
 * With `E2E_UX_AUDIT=1` the pages are saved as docs/ux-audit/46-idea-box-landed-1440.png and 47-idea-box-phone-390.png.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(here, "../../../docs/ux-audit");

async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const small = width < 600;
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: small ? 2 : 1, hasTouch: small, isMobile: small });
  return { page: await context.newPage(), close: () => context.close() };
}

test("a visitor types an idea, watches the card arrive, keeps it by signing in and lands on it", async ({ browser }) => {
  const { page, close } = await visitor(browser, 1440, 900);
  try {
    await page.goto("/");
    // The placeholder types ideas until the field is focused.
    await expect(page.getByTestId("idea-placeholder")).toHaveText(/\w{3,}/, { timeout: LONG });
    await page.getByTestId("idea-input").click();
    await expect(page.getByTestId("idea-placeholder")).toHaveCount(0);
    await page.getByTestId("idea-input").fill("Restored film cameras for people buying their first one");
    await page.getByTestId("idea-generate").click();
    // The visitor's card lands in the hero; the example card further down steps aside for it.
    const card = page.locator("#hero [data-idea-card]");
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await expect(card.locator("[data-idea-rating][data-arrived]")).toHaveCount(9);
    await expect(card.locator("[data-idea-rating=founder_fit][data-unmeasured]")).toHaveCount(1);
    await expect(card.locator("[data-idea-raise]")).toContainText("What would raise it most");
    // The mock models wrote it: the card says so.
    await expect(card.locator("[data-idea-sample]")).toBeVisible();
    const name = (await card.locator("[data-idea-name]").textContent())!.trim();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} is yours to keep.`);
    await expect(page.locator("#card [data-screen-frame]")).toBeHidden();
    if (process.env.E2E_UX_AUDIT === "1") await page.screenshot({ path: path.join(AUDIT_DIR, "46-idea-box-landed-1440.png") });

    // A reload lands on the same card (the cookie keeps it).
    await page.reload();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await expect(page.locator("#hero [data-idea-name]")).toHaveText(name);

    // Keep it: sign in (the developer sign-in stands in for the email link) and land on the card in the deck.
    await page.getByTestId("idea-keep-email").click();
    await expect(page).toHaveURL(/\/login\?next=%2Fstart%3Fclaim%3D/);
    await page.getByRole("button", { name: "Continue as developer" }).click();
    // The keep step: the card and its words, kept only with a press (security review 2026-11-13).
    await expect(page).toHaveURL(/\/new\/card\/keep/, { timeout: LONG });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Keep ${name}?`);
    await expect(page.getByTestId("card-keep-words")).toContainText("Restored film cameras for people buying their first one");
    await page.getByTestId("card-keep").click();
    await expect(page).toHaveURL(/\/new\/card\/[0-9a-f-]{36}$/, { timeout: LONG });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} is yours`);
    await expect(page.getByTestId("card-kept-next")).toBeVisible();
  } finally {
    await close();
  }
});

test("Try another idea replaces the card: the field comes back with the words, and the new card is the one kept", async ({ browser }) => {
  const { page, close } = await visitor(browser, 1440, 900);
  try {
    // Its own address (the api reads the last X-Forwarded-For on a test stack), so these cards fill no other test's window.
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    await page.route("**/idea-box/draft", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }));
    await page.goto("/");
    await page.getByTestId("idea-input").fill("A repair service for old film cameras");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await page.getByRole("button", { name: "Try another idea" }).click();
    await expect(page.getByTestId("idea-input")).toHaveValue("A repair service for old film cameras");
    await page.getByTestId("idea-input").fill("A repair service for old film cameras, by mail");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("idea-landed-words")).toHaveText("A repair service for old film cameras, by mail");
    // The browser holds the new card, not a second one.
    await page.reload();
    await expect(page.getByTestId("idea-landed-words")).toHaveText("A repair service for old film cameras, by mail", { timeout: LONG });
  } finally {
    await close();
  }
});

test("on a phone at 390 px the same page works: Surprise me drafts from an interest, nothing scrolls sideways", async ({ browser }) => {
  const { page, close } = await visitor(browser, 390, 844);
  try {
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    for (const id of ["idea-generate", "idea-surprise"]) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    await page.getByTestId("idea-surprise").click();
    await page.getByTestId("idea-interests").getByRole("button", { name: "Pets" }).click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    const box = (await page.locator("#hero [data-idea-card]").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await overflow()).toBeLessThanOrEqual(0);
    if (process.env.E2E_UX_AUDIT === "1") await page.screenshot({ path: path.join(AUDIT_DIR, "47-idea-box-phone-390.png") });
  } finally {
    await close();
  }
});
