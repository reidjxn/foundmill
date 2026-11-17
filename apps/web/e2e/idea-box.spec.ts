import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, answerFirstProfile } from "./helpers";
import { PLACEHOLDER_IDEAS } from "../components/landing/idea-box/typing";

/**
 * The landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md) against the local stack (mock models, the mock
 * Turnstile token): a signed-out visitor types a line and gets a card streamed in, keeps it by signing in (the stack's
 * developer sign-in stands in for the email link), keeps it with one press, and lands on the card in their deck; "Shape
 * it in the Ideation Studio" keeps it the same way and opens the Studio with the card in the deck (founder, 2026-11-16);
 * "Try another idea" warns first, then replaces the card with one from edited words (WP-03 T7); at 1440 px the card is
 * wide with its choices beside it; on a phone at 390 px the hero works on its own, Surprise me drafts from an interest,
 * the choices and the warning fit, and nothing scrolls sideways.
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
    // The visitor's card lands in the hero; the example beside the box steps aside for it.
    const card = page.locator("#hero [data-idea-box] [data-idea-card]");
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await expect(card.locator("[data-idea-rating][data-arrived]")).toHaveCount(9);
    await expect(card.locator("[data-idea-rating=founder_fit][data-unmeasured]")).toHaveCount(1);
    await expect(card.locator("[data-idea-raise]")).toContainText("What would raise it most");
    // The mock models wrote it: the card says so.
    await expect(card.locator("[data-idea-sample]")).toBeVisible();
    const name = (await card.locator("[data-idea-name]").textContent())!.trim();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} is yours to keep.`);
    await expect(page.locator("#hero [data-screen-frame]")).toBeHidden();
    // At 1440 the card is wide and its choices sit beside it, filling the hero's column (founder, 2026-11-16).
    const cardBox = (await card.boundingBox())!;
    const keepBox = (await page.getByTestId("idea-keep").boundingBox())!;
    expect(cardBox.width).toBeGreaterThan(560);
    expect(keepBox.x).toBeGreaterThan(cardBox.x + cardBox.width);
    expect(keepBox.x + keepBox.width - cardBox.x).toBeGreaterThan(1000);
    await expect(page.getByTestId("idea-open-studio")).toBeVisible();
    await expect(page.getByTestId("idea-build")).toBeVisible();
    if (process.env.E2E_UX_AUDIT === "1") await page.screenshot({ path: path.join(AUDIT_DIR, "46-idea-box-landed-1440.png") });

    // A reload lands on the same card (the cookie keeps it).
    await page.reload();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await expect(page.locator("#hero [data-idea-box] [data-idea-name]")).toHaveText(name);

    // Start building it now: sign in (the developer sign-in stands in for the email link) and land on the card.
    await page.getByTestId("idea-build").click();
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

test("Shape it in the Ideation Studio keeps the card through sign-in and opens the Studio on it, highlighted and focused", async ({ browser }) => {
  const { page, close } = await visitor(browser, 1440, 900);
  try {
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    await page.route("**/idea-box/draft", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }));
    await page.goto("/");
    await page.getByTestId("idea-input").fill("Meal plans for students cooking with one burner");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    const name = (await page.locator("#hero [data-idea-box] [data-idea-name]").textContent())!.trim();
    await page.getByTestId("idea-open-studio").click();
    await expect(page).toHaveURL(/\/login\?next=%2Fstart%3Fclaim%3D[^&]+%26then%3Dstudio/);
    await page.getByRole("button", { name: "Continue as developer" }).click();
    // The same keep step (kept only with a press), then the Studio instead of the card's page.
    await expect(page).toHaveURL(/\/new\/card\/keep\?.*then=studio/, { timeout: LONG });
    await page.getByTestId("card-keep").click();
    await expect(page).toHaveURL(/\/new\/ideate\/[0-9a-f-]{36}$/, { timeout: LONG });
    await expectStudioOnCard(page, name);
  } finally {
    await close();
  }
});

/** The Studio opened on the kept card: it wears the just-landed highlight, is in view, and focus is inside it. */
async function expectStudioOnCard(page: Page, name: string) {
  const ideaId = new URL(page.url()).pathname.split("/").pop()!;
  const card = page.locator(`#concept-${ideaId}`);
  await expect(card).toBeVisible({ timeout: LONG });
  await expect(card).toHaveAttribute("data-fresh", "true");
  await expect(card).toContainText(name);
  await expect(card).toBeInViewport();
  await expect.poll(() => card.evaluate((el) => el.contains(document.activeElement)), { timeout: LONG }).toBe(true);
}

/**
 * A new account that chose "Shape it in the Ideation Studio" (founder, 2026-11-16): the same keep step with `then=studio`
 * that the first sign-in after admission reaches. The waitlist's own half (`waitlist.join` keeping the choice with the
 * card, and `ideaBox.preview` returning it on admission) is the api test "the Studio choice goes with the waitlist's
 * card…"; it cannot run here, as the stack's developer accounts have no confirmed address and the join refuses them.
 */
async function newAccountChoosesStudio(page: Page) {
  const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  await page.route("**/idea-box/draft", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }));
  await page.goto("/");
  await page.getByTestId("idea-input").fill("Plant care visits for busy offices");
  await page.getByTestId("idea-generate").click();
  await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
  const name = (await page.locator("#hero [data-idea-box] [data-idea-name]").textContent())!.trim();
  await page.getByTestId("idea-open-studio").click();
  await expect(page).toHaveURL(/\/login\?next=%2Fstart%3Fclaim%3D[^&]+%26then%3Dstudio/);
  const next = new URL(page.url()).searchParams.get("next")!;
  await page.goto(`/auth/dev?as=${randomUUID()}&next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(/\/new\/card\/keep\?.*then=studio/, { timeout: LONG });
  await page.getByTestId("card-keep").click();
  // A new account answers the three questions first; they go on to the Studio, opened on the card.
  await expect(page).toHaveURL(/\/onboarding\?next=%2Fnew%2Fideate%2F[0-9a-f-]{36}$/, { timeout: LONG });
  await answerFirstProfile(page, "Studio Founder");
  await expect(page).toHaveURL(/\/new\/ideate\/[0-9a-f-]{36}$/, { timeout: LONG });
  return name;
}

test("a new account that chose the Studio answers three questions and lands in the Studio on the card", async ({ browser }) => {
  const { page, close } = await visitor(browser, 1440, 900);
  try {
    const name = await newAccountChoosesStudio(page);
    await expectStudioOnCard(page, name);
  } finally {
    await close();
  }
});

test("on a phone, the Studio choice ends at the Studio's own page: it opens on a computer and offers the link", async ({ browser }) => {
  const { page, close } = await visitor(browser, 390, 844);
  try {
    await newAccountChoosesStudio(page);
    // The Studio is desktop-only: the page says so and offers a link to this card's Studio page, never a dead end.
    await expect(page.getByTestId("needs-larger-window")).toBeVisible({ timeout: LONG });
    await expect(page.getByRole("button", { name: "Email me a link" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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
    const name = (await page.locator("#hero [data-idea-box] [data-idea-name]").textContent())!.trim();
    await expect(page.getByTestId("idea-keep")).toContainText("2 more today");
    // The warning first: keeping the card leaves it as it was.
    await page.getByTestId("idea-try-another").click();
    const warning = page.getByTestId("idea-redraw-confirm");
    await expect(warning).toContainText(`${name} will be discarded.`);
    await expect(warning).toBeFocused();
    await page.getByRole("button", { name: `Keep ${name}` }).click();
    await expect(warning).toHaveCount(0);
    await expect(page.getByTestId("idea-try-another")).toBeFocused();
    await page.getByTestId("idea-try-another").click();
    await page.getByTestId("idea-redraw-confirm-yes").click();
    await expect(page.getByTestId("idea-input")).toHaveValue("A repair service for old film cameras");
    await page.getByTestId("idea-input").fill("A repair service for old film cameras, by mail");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("idea-landed-words")).toHaveText("A repair service for old film cameras, by mail");
    await expect(page.getByTestId("idea-keep")).toContainText("1 more today");
    // The browser holds the new card, not a second one.
    await page.reload();
    await expect(page.getByTestId("idea-landed-words")).toHaveText("A repair service for old film cameras, by mail", { timeout: LONG });
  } finally {
    await close();
  }
});

test("WP-04 T1: a new account on a phone keeps a card, answers three questions and lands on that card's Commit", async ({ browser }) => {
  const { page, close } = await visitor(browser, 390, 844);
  try {
    // Its own address, as above, so this card fills no other test's window.
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    await page.route("**/idea-box/draft", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }));
    await page.goto("/");
    await page.getByTestId("idea-input").fill("Dog walking rounds for people who work late");
    await page.getByTestId("idea-generate").click();
    await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
    await page.getByTestId("idea-build").click();
    await expect(page).toHaveURL(/\/login\?next=%2Fstart%3Fclaim%3D/);
    // A new account signs in (the developer sign-in as a fresh id stands in for the email link) and keeps the card.
    const next = new URL(page.url()).searchParams.get("next")!;
    await page.goto(`/auth/dev?as=${randomUUID()}&next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/new\/card\/keep/, { timeout: LONG });
    await page.getByTestId("card-keep").click();
    await expect(page).toHaveURL(/\/new\/card\/[0-9a-f-]{36}$/, { timeout: LONG });
    const ideaId = new URL(page.url()).pathname.split("/").pop()!;
    // The card's next step is the three questions, a link on a phone, with the card's Commit as where they go on to.
    const step = page.getByTestId("card-kept-next");
    await expect(step).toHaveText("Three quick things about you");
    await expect(step).toHaveAttribute("href", `/onboarding?next=/new/commit/${ideaId}`);
    await step.click();
    await expect(page.getByTestId("first-profile")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await page.getByTestId("first-profile-adult").getByRole("checkbox", { name: "I am 18 or older" }).check();
    await page.getByTestId("first-profile-submit").click();
    await expect(page).toHaveURL(new RegExp(`/new/commit/${ideaId}$`), { timeout: LONG });
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
    const box = (await page.locator("#hero [data-idea-box] [data-idea-card]").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await overflow()).toBeLessThanOrEqual(0);
    if (process.env.E2E_UX_AUDIT === "1") await page.screenshot({ path: path.join(AUDIT_DIR, "47-idea-box-phone-390.png") });
    // The choices stack under the card, full width and tap-sized; the Studio one says it opens on a computer.
    const keep = (await page.getByTestId("idea-keep").boundingBox())!;
    expect(keep.y).toBeGreaterThan(box.y + box.height - 1);
    for (const id of ["idea-open-studio", "idea-build", "idea-try-another"]) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("idea-keep")).toContainText("The Ideation Studio opens on a computer.");
    // The warning fits the phone too.
    await page.getByTestId("idea-try-another").click();
    const warning = (await page.getByTestId("idea-redraw-confirm").boundingBox())!;
    expect(warning.x).toBeGreaterThanOrEqual(0);
    expect(warning.x + warning.width).toBeLessThanOrEqual(390);
    for (const id of ["idea-redraw-confirm-yes", "idea-redraw-confirm-no"]) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    expect(await overflow()).toBeLessThanOrEqual(0);
  } finally {
    await close();
  }
});

/**
 * The field at rest (founder, 2026-11-17: "the example text should never come out of the text box"): at every width
 * from 390 px, each example the placeholder types fits inside the field whole, the "Shape my idea" button is whole,
 * beside the field or under it and never over it, and the page never scrolls sideways. Each example is set into the
 * typing overlay directly, so the longest is measured without waiting for the animation to reach it.
 */
for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1080, 800],
  [1280, 800],
  [1440, 900],
] as const) {
  test(`at ${width} px the examples stay inside the field, the button is whole and the example label fits`, async ({ browser }) => {
    const { page, close } = await visitor(browser, width, height);
    try {
      await page.goto("/");
      await expect(page.getByTestId("idea-placeholder")).toBeVisible({ timeout: LONG });
      const report = await page.evaluate((ideas) => {
        const overlay = document.querySelector<HTMLElement>("[data-testid=idea-placeholder]")!;
        const text = overlay.firstElementChild as HTMLElement;
        const input = document.querySelector<HTMLElement>("[data-testid=idea-input]")!.getBoundingClientRect();
        const field = document.querySelector<HTMLElement>("[data-testid=idea-field]")!.getBoundingClientRect();
        const button = document.querySelector<HTMLElement>("[data-testid=idea-generate]")!;
        const b = button.getBoundingClientRect();
        const problems: string[] = [];
        for (const idea of ideas) {
          text.textContent = idea;
          const o = overlay.getBoundingClientRect();
          const t = text.getBoundingClientRect();
          if (t.right > input.right + 0.5 || o.right > input.right + 0.5) problems.push(`"${idea}" runs past the field (${Math.round(Math.max(t.right, o.right))} > ${Math.round(input.right)})`);
          if (text.scrollWidth > text.clientWidth + 0.5) problems.push(`"${idea}" is cut short (${text.scrollWidth} > ${text.clientWidth})`);
        }
        if (b.right > window.innerWidth + 0.5 || b.left < -0.5) problems.push(`the button leaves the view (${Math.round(b.left)}–${Math.round(b.right)} of ${window.innerWidth})`);
        if (button.scrollWidth > button.clientWidth + 0.5) problems.push("the button's label is cut short");
        const beside = b.left >= field.right - 0.5;
        const under = b.top >= field.bottom - 0.5;
        if (!beside && !under) problems.push("the button overlaps the field");
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) problems.push("the page scrolls sideways");
        // The example's label (founder, 2026-11-17): whole, on one line, inside its frame.
        const frame = document.querySelector<HTMLElement>("#hero [data-screen-frame]")!;
        const chip = frame.querySelector<HTMLElement>("figcaption")!;
        const c = chip.getBoundingClientRect();
        const fr = frame.getBoundingClientRect();
        if (chip.textContent !== "Example companies you can create") problems.push(`the label reads "${chip.textContent}"`);
        if (chip.scrollWidth > chip.clientWidth + 0.5 || chip.scrollHeight > chip.clientHeight + 0.5) problems.push("the label is cut short or wraps");
        if (c.left < fr.left - 0.5 || c.right > fr.right + 0.5) problems.push(`the label leaves its frame (${Math.round(c.left)}–${Math.round(c.right)} of ${Math.round(fr.left)}–${Math.round(fr.right)})`);
        // The examples in the founder's order (2026-11-17), on one line from 768 px (founder, 2026-11-16).
        const pills = [...frame.querySelectorAll<HTMLElement>("[role=radio]")];
        const names = pills.map((p) => p.textContent);
        if (names.join(",") !== "Northwind,Tutorlane,Sole Revival,Glitchwick") problems.push(`the examples read ${names.join(", ")}`);
        if (window.innerWidth >= 768 && new Set(pills.map((p) => Math.round(p.getBoundingClientRect().top))).size !== 1) problems.push("the examples wrap onto two lines");
        return problems;
      }, [...PLACEHOLDER_IDEAS]);
      expect(report, report.join("\n")).toEqual([]);
    } finally {
      await close();
    }
  });
}

