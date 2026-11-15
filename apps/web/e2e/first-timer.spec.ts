import { expect, test, type Page } from "@playwright/test";

/**
 * The first-timer's page at `/` (DESIGN §9a; docs/holistic-plan/landing/DIRECTION.md): one page for every width from
 * 390 px, one h1, the idea box the one main action, people in the first half. Signed out: a fresh context. The web
 * stack runs with every landing switch off (sign-up closed, the people layer closed on the page, no platform mail), so
 * the page here is the one production has today. The card itself is idea-box.spec.ts.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const SECTIONS = ["hero", "card", "people", "first-week", "control", "cost", "questions", "start"];
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width} px: the same sections, one h1, no sideways scroll, the box first and labeled`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Start something of your own, with a team of AI agents.");
    expect(await page.locator("main > section").evaluateAll((s) => s.map((e) => e.id))).toEqual(SECTIONS);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The idea box: a visible label, the button on the first screen, the page's one filled thing there.
    const field = page.getByLabel("What do you want to make?");
    await expect(field).toBeVisible();
    const button = page.getByTestId("idea-generate");
    await expect(button).toBeInViewport();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator("header .idea-gen-filled, header button")).toHaveCount(0);
    for (const a of ["Your first card is free and needs no sign-up", "Your idea stays private until you choose to share it", "Nothing spends money or signs in your name without you"]) {
      await expect(page.getByText(a, { exact: true })).toBeVisible();
    }

    // People sit in the first half of the page; the find block is off with the people layer closed.
    const people = (await page.locator("#people").boundingBox())!;
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(people.y).toBeLessThan(total / 2);
    await expect(page.getByTestId("people-find")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Find people" })).toHaveCount(0);

    // The closing button takes the visitor back to the box with the cursor in it.
    await page.getByTestId("start-shape").click();
    await expect(field).toBeFocused();

    // The footer's tour link is for wide screens only.
    await expect(page.getByRole("link", { name: "How the team works" })).toBeVisible({ visible: width >= 1280 });
  });
}

test("under reduced motion the placeholder shows its first idea, still", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("idea-placeholder")).toHaveText("Sneaker cleaning for people at my school");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("idea-placeholder")).toHaveText("Sneaker cleaning for people at my school");
  await context.close();
});

test("/tour is the earlier page, signed out, on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tour");
  await expect(page).toHaveURL(/\/tour$/);
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Watch it run" })).toBeVisible();
});

test("search and share: the first-timer's title, one JSON-LD block, its own share image, and no index while sign-up is closed", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Foundmill | Start your first project with one sentence");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/[^/]+\/?$/);
  const ld = page.locator('script[type="application/ld+json"]');
  await expect(ld).toHaveCount(1);
  const graph = JSON.parse((await ld.textContent())!)["@graph"] as { "@type": string }[];
  expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  const res = await page.request.get(new URL(image!).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  // The paragraph an answer engine quotes is on the page as plain text.
  await expect(page.getByTestId("what-foundmill-is")).toContainText("Foundmill is a web app where one person, or a few people together");
});
