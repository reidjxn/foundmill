import { expect, test, type APIRequestContext, type Locator, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
// Relative imports on purpose (as playwright.config.ts does for the seed constants): Node-only modules with no
// imports of their own, from packages apps/web does not depend on.
import { DEMO_OWNER_DISPLAY_NAME } from "../../../packages/db/src/seed/constants";
import { makePng } from "../../../packages/shared/src/testing/logo-fixtures";

/**
 * Shared steps for the apps/web screen specs (e2e/README.md). The stack is the PGlite-backed local one: the dev bypass
 * signs in as the seed owner, who owns Northwind Skincare and Ledgerly (packages/db/src/seed/constants.ts).
 *
 * The seed may run with SEED_OWNER_PROFILE=0 (no founder profile), in which case every /b/* and /new/* route bounces
 * to /onboarding (AC-11.1.1). `signIn` completes the profile once so the other specs run against the business
 * screens; onboarding.spec.ts asserts the gate itself before that happens (it runs first, see playwright.config.ts).
 *
 * The specs address the seeded business by its fixed id rather than through `/`: that redirect follows the
 * last-opened business, which the Commit specs change to a fresh business with no seeded data.
 */
export const NORTHWIND_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000001";
/** The dev founder's second seeded business (Scale, LIVE, a demo). */
export const LEDGERLY_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-000000000002";
export const UUID = "[0-9a-f-]{36}";
/** Long waits: the api answers tRPC against PGlite and next dev compiles each route on first visit. */
export const LONG = 60_000;

/** Signs in through the dev bypass; makes sure the founder profile exists; lands on /new or a business Home. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  // Already signed in (a spec that opens a second screen): the login page sends the founder on, so there is no button.
  const dev = page.getByRole("button", { name: "Continue as developer" });
  await Promise.race([dev.waitFor({ state: "visible", timeout: LONG }), page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: LONG })]).catch(() => undefined);
  if (await dev.isVisible().catch(() => false)) await dev.click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/|\/onboarding|\/new/, { timeout: LONG });
  if (/\/onboarding/.test(page.url())) await completeProfile(page);
}

/**
 * Signs in as another account through the dev bypass (`/auth/dev?as=<uuid>`, development and test only): the dev-as
 * cookie makes every bearer the web sends `dev:<uuid>`, which the api and the stream map to that account. Lands on
 * `next` (default New business), or on /onboarding when the account has no founder profile yet: the caller completes
 * it with its own answers (completeProfile writes the seed owner's). The account is the browser context's until it
 * closes, or until a plain `signIn` (whose /auth/dev clears the choice).
 */
export async function signInAs(page: Page, userId: string, next = "/new"): Promise<void> {
  expect(userId, "signInAs needs an account id (a UUID)").toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await page.goto(`/auth/dev?as=${encodeURIComponent(userId)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/dev"), { timeout: LONG });
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "fm_dev_as")?.value, "/auth/dev?as= set the dev-as cookie (development and test only)").toBe(userId.toLowerCase());
}

/** Signs in and opens the seeded Northwind Skincare Home (the AppShell is visible on return). */
export async function openBusiness(page: Page, path = "home"): Promise<string> {
  await signIn(page);
  await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/${path}`);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  // The shell is server-rendered; its handlers and the inbox/cycle queries arrive with hydration. Network idle means
  // those first queries have answered, so a click or a key press right after this reaches a live handler.
  await page.waitForLoadState("networkidle", { timeout: LONG });
  await settled(page);
  return NORTHWIND_BUSINESS_ID;
}

/** The founder areas of the sidebar (docs/DESIGN.md §8): Plan, Customers, Money, Product, Team. */
export type AreaKey = "plan" | "customers" | "money" | "product" | "team";

/** An area's sidebar item (founder areas, 2026-11-09): departments are no longer sidebar items. */
export function areaLink(page: Page, area: AreaKey): Locator {
  return page.locator(`[data-testid=app-shell] nav [data-sidebar-item='area-${area}']`);
}

/**
 * The base of a department's tabs ("/b/<id>/d/<slug>"). The sidebar lists areas, not departments, so a spec names the
 * department by its slug; the seeded businesses keep the module keys as slugs (renames change only the names), and a
 * module key whose department moved is forwarded by the department screen.
 */
export function departmentBase(slug: string, businessId = NORTHWIND_BUSINESS_ID): string {
  return `/b/${businessId}/d/${slug}`;
}

/** The current area's tab bar ("Product tabs") and its "More detail" menu trigger. */
export function areaTabBar(page: Page, areaLabel: string): Locator {
  return page.getByRole("tablist", { name: `${areaLabel} tabs` });
}

/** Opens a tab that sits behind the tab bar's "More detail" menu (docs/DESIGN.md §9). */
export async function openMoreDetail(page: Page, label: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: /^More detail/ }).click();
  await page.getByTestId("more-detail-menu").getByRole("menuitem", { name: label }).click();
}

/**
 * React's parked copy of a streamed screen: the server sends the shell with a skeleton in the main region, then the
 * screen itself in a hidden `<div hidden id="S:0">` at the end of the body, and a reveal script moves it in once the
 * page has painted (React batches reveals, about 300 ms after the first paint). Until the move the document holds the
 * screen twice if the browser rendered it first (see `settled`).
 */
export const STREAMED_COPY = 'div[hidden][id^="S:"]';

/**
 * Waits until the screen in the shell's main region is the live one. Two things must hold:
 *  1. the streamed copy (`STREAMED_COPY`) is gone: while it is parked outside the shell, an unscoped locator can match
 *     the screen twice (strict mode) or the wrong copy;
 *  2. the screen's own root carries React's fiber, i.e. it is hydrated. The server HTML has no handlers, and a boundary
 *     that was still pending when the shell hydrated is client-rendered (a provider above it changes value in the
 *     first commit), which swaps the nodes: a click, a typed value or a key press before this point can land on nodes
 *     that are thrown away, or on a tab that is not listening yet (docs/DECISIONS.md, 2026-10-14).
 * Call it after any `page.goto` to a /b/* or LIVE screen that is followed by an interaction; `openBusiness` does.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator(STREAMED_COPY)).toHaveCount(0, { timeout: LONG });
  await page.waitForFunction(
    () => {
      const first = document.querySelector('[data-testid="shell-content"]')?.firstElementChild;
      return !!first && !first.matches('[data-testid="screen-skeleton"]') && Object.keys(first).some((k) => k.startsWith("__reactFiber$"));
    },
    undefined,
    { timeout: LONG },
  );
}

/**
 * Open a DataTable's saved view by name when it is not open already. Views and the open view are saved per person
 * (founder.tableViews, audit #204), so a spec that depends on a view picks it rather than assuming the default.
 */
export async function chooseTableView(page: Page, name: string, scope: Page | Locator = page): Promise<void> {
  const trigger = scope.getByRole("button", { name: /^View: / }).first();
  await expect(trigger).toBeVisible({ timeout: LONG });
  if (((await trigger.getAttribute("aria-label")) ?? "") === `View: ${name}`) return;
  await trigger.click();
  // A built-in view's menu item reads "All Built in": its own name, then the badge.
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( Built in)?$`) }).click();
  await expect(scope.getByRole("button", { name: `View: ${name}` }).first()).toBeVisible();
}

/**
 * The Settings screen inside the shell's main region. While a page streams, React parks its finished HTML in a hidden
 * `div#S:*` outside the shell (`STREAMED_COPY`) until the reveal script moves it in; if the boundary is client-rendered
 * meanwhile, both copies exist for a moment, so an unscoped `getByTestId("settings-screen")`, or any locator for
 * something inside it, can match two elements (strict mode) or the hidden one. Every locator for a Settings tab's own
 * content goes through this one; dialogs and toasts are portals outside the shell and use `page` (see `toast`).
 */
export function settingsScreen(page: Page): Locator {
  return page.getByTestId("shell-content").getByTestId("settings-screen");
}

/**
 * Opens a Settings tab on the seeded business and waits for it to settle (`settled`): the right tab is showing and no
 * streamed copy is left. Returns the screen, for `screen.getByTestId(...)` and friends.
 */
export async function openSettings(page: Page, tab: string, businessId = NORTHWIND_BUSINESS_ID): Promise<Locator> {
  await page.goto(`/b/${businessId}/settings/${tab}`);
  const screen = settingsScreen(page);
  await expect(screen).toHaveAttribute("data-tab", tab, { timeout: LONG });
  await settled(page);
  return screen;
}

/**
 * A toast by its title. Toasts stack in the Dugout viewport, outside the shell; Radix also announces each one in a
 * visually hidden live region ("Notification <title>") for about a second, so `page.getByText(title)` matches the toast
 * and its announcer (strict mode) for that long. This looks only in the viewport and matches the whole title.
 */
export function toast(page: Page, title: string | RegExp): Locator {
  return page.locator("[data-dugout-toasts]").getByText(title, { exact: true });
}

/** Fills the founder profile on /onboarding (the page the dev user is held at without one) and saves it. */
export async function completeProfile(page: Page): Promise<void> {
  await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/What the team calls you/).fill("Playwright Founder");
  await page.getByLabel("First-time founder").check();
  await page.getByLabel("Full time").check();
  // The profile is two passes (UX plan §7.3): budget, markets, constraints and risk sit behind the collapsed "Add
  // detail" panel for a first-time founder; open it before filling them.
  const toggle = page.getByTestId("profile-detail-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByLabel(/Budget you can commit/).fill("25k");
  // The chip input and its suggestions list share the "Target markets" label prefix; the textbox is the field.
  const markets = page.getByRole("textbox", { name: "Target markets" });
  await markets.fill("Nordics");
  await markets.press("Enter");
  await page.getByRole("button", { name: "Remote only" }).click();
  await page.getByLabel("Medium").check();
  await page.getByTestId("profile-submit-bottom").click();
  await expect(page).toHaveURL(/\/new$/, { timeout: LONG });
  await expect(page.getByTestId("doors")).toBeVisible();
}

/** Opens the Ideation Studio and waits until idea.list has answered (the grid only renders then). */
export async function openStudio(page: Page): Promise<void> {
  await page.goto("/new/ideate");
  await expect(page.getByTestId("prompt-box")).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId("concept-grid")).toBeAttached({ timeout: LONG });
}

/** The Studio keeps the drafted deck on the server (idea.list); drafts one only when fewer than `minimum` cards exist. */
export async function ensureDeck(page: Page, minimum = 1): Promise<void> {
  await openStudio(page);
  const cards = page.getByTestId("concept-grid").locator("[data-concept]");
  if ((await cards.count()) < minimum) {
    await page.getByTestId("generate-button").click();
    await expect(cards.nth(minimum - 1)).toBeVisible({ timeout: LONG });
  }
}

/** Commits a throwaway business from the first concept card (the seeded ones are never archived or changed); its id. */
export async function commitThrowaway(page: Page, name: string): Promise<string> {
  await signIn(page);
  await ensureDeck(page, 1);
  await page.getByTestId("commit-link").first().click();
  await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/`), { timeout: LONG });
  return page.url().match(new RegExp(`/b/(${UUID})/`))![1]!;
}

/** Opens the top bar's Switch business; the popover, once open. */
export async function openSwitcher(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^Switch business/ }).click();
  const switcher = page.getByRole("dialog", { name: "Switch business" });
  await expect(switcher).toBeVisible({ timeout: LONG });
  return switcher;
}

/** Fails the test early with a clear message when the seed lacks something a spec relies on (never a skip). */
export function seedExpectation(condition: boolean, what: string): void {
  expect(condition, `${what}: re-seed with \`SEED_TARGET=pglite SEED_PGLITE_DIR=./.pglite/e2e pnpm --filter @foundmill/db seed\` (apps/web/e2e/README.md)`).toBe(true);
}

/** A real 256 px PNG logo in a saturated orange, for the upload specs. */
export function logoPng(): Buffer {
  return Buffer.from(makePng(256, 256, [214, 92, 38, 255]));
}

/** The api the dev bearer reaches (playwright.config.ts starts it on :4000 unless NEXT_PUBLIC_API_URL says otherwise). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** The founder profile fields `founder.profile.update` takes (packages/db FounderProfileInput). */
const PROFILE_FIELDS = ["displayName", "experience", "skills", "timeCommitment", "budgetMinor", "currency", "citizenship", "residence", "targetMarkets", "constraints", "riskAppetite", "visibility"] as const;
export type FounderProfileSnapshot = Partial<Record<(typeof PROFILE_FIELDS)[number], unknown>>;

/** An api client signed in as the dev founder (the literal `dev` bearer, e2e/README.md). Dispose it after use. */
export async function devApi(playwright: PlaywrightWorkerArgs["playwright"]): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: "Bearer dev" } });
}

/** The dev founder's stored profile (only the editable fields), or null before the profile exists. */
export async function readFounderProfile(api: APIRequestContext): Promise<FounderProfileSnapshot | null> {
  const res = await api.get("/trpc/founder.profile.get");
  expect(res.ok(), `founder.profile.get answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { result: { data: { json: { profile: Record<string, unknown> | null } } } };
  const profile = body.result.data.json.profile;
  return profile ? Object.fromEntries(PROFILE_FIELDS.map((k) => [k, profile[k]])) : null;
}

/**
 * Puts the dev founder's profile back as `before` held it. The dev founder is shared by every spec and every screen
 * (the Inbox, the Hierarchy and the live pages show the name), so a spec that edits the profile restores it. A profile
 * that did not exist before (a database seeded with SEED_OWNER_PROFILE=0) keeps what the spec saved, under the name
 * the seed gives the demo founder.
 */
export async function restoreFounderProfile(api: APIRequestContext, before: FounderProfileSnapshot | null): Promise<void> {
  const patch = before ?? { displayName: DEMO_OWNER_DISPLAY_NAME };
  const res = await api.post("/trpc/founder.profile.update", { data: { json: patch } });
  expect(res.ok(), `founder.profile.update answered ${res.status()}: ${await res.text()}`).toBe(true);
}

/**
 * Turns the dev founder's Builder view on or off (docs/DESIGN.md "Builder view"; global-setup.ts starts every run with
 * it off) and answers what it was, so a spec that needs the engine on can restore it in afterAll:
 *   test.beforeAll(async ({ playwright }) => (before = await setBuilderView(playwright, true)));
 *   test.afterAll(async ({ playwright }) => void (await setBuilderView(playwright, before)));
 */
export async function setBuilderView(playwright: PlaywrightWorkerArgs["playwright"], on: boolean): Promise<boolean> {
  const api = await devApi(playwright);
  try {
    const read = await api.get("/trpc/founder.preferences.guidance");
    expect(read.ok(), `founder.preferences.guidance answered ${read.status()}`).toBe(true);
    const was = ((await read.json()) as { result: { data: { json: { builderView?: boolean } } } }).result.data.json.builderView === true;
    const res = await api.post("/trpc/founder.preferences.update", { data: { json: { builderView: on } } });
    expect(res.ok(), `founder.preferences.update answered ${res.status()}: ${await res.text()}`).toBe(true);
    return was;
  } finally {
    await api.dispose();
  }
}

export { DEMO_OWNER_DISPLAY_NAME, test, expect };

/* ---------- The first days (founder, 2026-10-18) ---------- */

/**
 * Take charge from the Commit screen the caller is on: lands on the new business's Today, its front door (founder,
 * 2026-11-07; the Chief of Staff's welcome note is in the Inbox; the foundations draft in the background and two
 * sign-off notes follow).
 */
export async function takeChargeToToday(page: Page, name: string): Promise<{ bid: string }> {
  await expect(page.getByTestId("commit-form")).toBeVisible({ timeout: LONG });
  await page.getByLabel(/Business name/).fill(name);
  await page.getByTestId("take-charge").click();
  await page.waitForURL(new RegExp(`/b/${UUID}/today`), { timeout: LONG });
  const bid = page.url().match(new RegExp(`/b/(${UUID})/today`))![1]!;
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
  return { bid };
}

/** The name the specs used while Home was the front door; it lands on Today now. */
export const takeChargeToHome = takeChargeToToday;

export const SPEC_SIGNOFF = "Sign off the product specification";
export const ROADMAP_SIGNOFF = "Sign off the product roadmap";

/** The Inbox row of a note by its subject. */
export function inboxRow(page: Page, subject: string | RegExp): Locator {
  return page.getByTestId("inbox-list").getByRole("option").filter({ hasText: subject }).first();
}

/**
 * A first-visit tour card or a one-step callout (the Coachmark stamps `data-coachmark` and `data-tour` on its card; its
 * ring and its targets carry only one of the two).
 */
export const COACHMARK_CARD = "[data-coachmark][data-tour]";

/**
 * Closes every tour card and callout showing now: Skip tour on a tour, Got it on a callout. Either marks it done for the
 * whole dev account (tours.spec.ts resets them before it asserts them). A card is a `role="dialog"` popover, and an
 * open dialog holds the Inbox's number keys (ReadingPane), so a spec that decides from the keyboard closes them first.
 */
export async function dismissCoachmarks(page: Page): Promise<void> {
  const cards = page.locator(COACHMARK_CARD);
  for (let i = 0; i < 5 && (await cards.count()) > 0; i++) {
    const card = cards.first();
    const tour = await card.getAttribute("data-tour");
    await card.getByRole("button", { name: /^(Skip tour|Got it)$/ }).click();
    await expect(page.locator(`[data-coachmark][data-tour="${tour}"]`)).toHaveCount(0, { timeout: LONG });
  }
}

/** Opens the note from the Inbox list and approves it with the keyboard (1 = the recommended option). */
export async function approveFromInbox(page: Page, bid: string, subject: string): Promise<void> {
  await page.goto(`/b/${bid}/inbox`);
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
  await settled(page);
  const row = inboxRow(page, subject);
  await expect(row, `the Inbox lists "${subject}"`).toBeVisible({ timeout: LONG });
  await row.click();
  const item = page.getByTestId("inbox-item");
  await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
  await expect(page.getByTestId("signoff-panel")).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
  // The number keys decide the note from the page (the shell's main content), not from the list row that opened it.
  // On the account's first Inbox visit the Inbox tour opens, and once it closes the first-decision callout can follow
  // (UX plan §6.2, §7.9; each waits for the other): an open card holds the keys, so close what shows, then press, and
  // try again if a card opened in between. A second press after the decision landed does nothing (the bar is locked).
  await expect(async () => {
    await dismissCoachmarks(page);
    await page.getByTestId("shell-content").focus();
    await page.keyboard.press("1");
    await expect(item).toHaveAttribute("data-state", "answered", { timeout: 10_000 });
  }).toPass({ timeout: LONG * 2 });
  await expect(item).toHaveAttribute("data-state", "answered", { timeout: LONG });
  await expect(page.getByTestId("answered-panel")).toBeVisible({ timeout: LONG });
}

/** Both sign-offs approved from the Inbox: the build starts (Development › Plan gets its first tasks). */
export async function approveBothSignoffs(page: Page, bid: string): Promise<void> {
  await approveFromInbox(page, bid, SPEC_SIGNOFF);
  await approveFromInbox(page, bid, ROADMAP_SIGNOFF);
  await expect(inboxRow(page, /Building starts:/)).toBeVisible({ timeout: LONG });
}

/**
 * Start distribution from Distribution › Board (owners and admins): the Board's question lands in the Inbox. Its id
 * comes back from `business.startDistribution` (the question's subject is the archetype's own, so the specs open the
 * note by id rather than by its words).
 */
export async function startDistributionFromBoard(page: Page, bid: string): Promise<{ boardItemId: string }> {
  await page.goto(`/b/${bid}/d/distribution/formation`);
  const waiting = page.getByTestId("distribution-waiting");
  await expect(waiting).toBeVisible({ timeout: LONG });
  await settled(page);
  await page.getByTestId("start-distribution").click();
  const answer = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("business.startDistribution"), { timeout: LONG });
  await page.getByTestId("start-distribution-confirm").click();
  const body = (await (await answer).json()) as { result: { data: { json: { boardItemId: string | null } } } } | { result: { data: { json: { boardItemId: string | null } } } }[];
  const boardItemId = (Array.isArray(body) ? body[0] : body)?.result.data.json.boardItemId;
  expect(boardItemId, "Start distribution posts the Board's question").toBeTruthy();
  await expect(waiting).toHaveCount(0, { timeout: LONG });
  return { boardItemId: boardItemId! };
}

/** Opens the Board's question by id: a decision from the Chief of Staff with at least two options, open for the founder. */
export async function openBoardQuestion(page: Page, bid: string, boardItemId: string): Promise<void> {
  await page.goto(`/b/${bid}/inbox/${boardItemId}`);
  const item = page.getByTestId("inbox-item");
  await expect(item).toHaveAttribute("data-type", "decision", { timeout: LONG });
  await expect(item).toHaveAttribute("data-item-id", boardItemId);
  await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open", { timeout: LONG });
  expect(await page.getByTestId("decision-bar").getByRole("group", { name: "Options" }).getByRole("button").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(`[data-inbox-row="${boardItemId}"]`)).toHaveAttribute("data-needs-answer", "true", { timeout: LONG });
}
