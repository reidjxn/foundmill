import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

/**
 * The proof for the first-timer's page at `/` (DESIGN §9a; docs/holistic-plan/landing/DIRECTION.md §8): at 390, 768,
 * 1280 and 1440 px the same sections, one h1, no sideways scroll, the idea box reachable and labeled, and axe clean
 * against WCAG 2.2 AA, at rest and with a card landed (mock model). Signed out. The people block follows the build's
 * LIVE_MODE (the page's `data-people`); both sides are also covered by LandingPage.test.tsx.
 *
 * axe-core is injected from the web's own dev dependency (the same way claude/blissful-fermat-q03yq1's e2e/axe.ts does;
 * once that lands, this file can use its helper). Cloudflare's Turnstile frame is not ours and is left out.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const require = createRequire(import.meta.url);
const AXE_SOURCE: string = (require("axe-core") as { source: string }).source;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LONG = 60_000;

async function axeViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
    const r = await axe.run({ include: [["html"]], exclude: [["iframe[src*='challenges.cloudflare.com']"]] }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  }, AXE_TAGS);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const SECTIONS = ["hero", "result", "ways", "studio", "people", "first-week", "control", "questions", "start"];

for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
] as const) {
  test(`at ${width} px: one page, one h1, no sideways scroll, the box reachable and labeled, axe clean`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    expect(await page.locator("main > section").evaluateAll((s) => s.map((e) => e.id))).toEqual(SECTIONS);
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The box: labeled, reachable by keyboard from the top of the page, its button on the first screen and 44 px tall.
    const field = page.getByLabel("What do you want to make?");
    await expect(page.getByTestId("idea-generate")).toBeInViewport();
    expect((await page.getByTestId("idea-generate").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (let i = 0; i < 6 && !(await field.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(field).toBeFocused();

    // Every section once on screen (nothing waits for a scroll to exist), then axe on the whole page.
    for (const id of SECTIONS) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 768 px a card lands with the mock model, the page stays one column wide and axe stays clean", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.getByLabel("What do you want to make?").fill("Dog walking in my neighborhood, booked by text");
  await page.getByTestId("idea-generate").click();
  await expect(page.getByTestId("idea-keep")).toBeVisible({ timeout: LONG });
  const name = (await page.locator("#hero [data-idea-name]").textContent())!.trim();
  await expect(page.locator("h1")).toHaveText(`${name} is yours to keep.`);
  await expect(page.locator("#hero [data-screen-frame]")).toBeHidden();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("under reduced motion the hero does not animate in", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/");
  const names = await page.locator("#hero .motion-safe\\:animate-rise-in").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toBe("none");
  await context.close();
});

test("finding people follows the build's people layer (off in production today, on in CI), and nothing says it is coming", async ({ page }) => {
  await page.goto("/");
  const open = (await page.getByTestId("landing").getAttribute("data-people")) === "open";
  await expect(page.getByTestId("people-find")).toHaveCount(open ? 1 : 0);
  await expect(page.getByRole("link", { name: "Find people" })).toHaveCount(open ? 2 : 0);
  await expect(page.locator("body")).not.toContainText(/coming soon|opening soon/i);
  // The true people lines are there whatever the switch.
  await expect(page.locator("#people")).toContainText("Invite anyone.");
  await expect(page.locator("#people")).toContainText("People are free.");
});
