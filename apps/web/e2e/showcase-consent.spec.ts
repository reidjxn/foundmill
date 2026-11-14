import { expect, test, type Page, type Route } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, dismissCoachmarks, openBusiness } from "./helpers";

/**
 * A founder's own showcase ask in Needs you (0103; docs/THESIS_REVIEW.md §13 item 15), at 390 px and at 1280 px. The
 * test stack has no house business and no Runway, so no real ask can go out here (a simulated clip never goes out for a
 * yes, and the api suite covers the whole path): the note and the ask are replayed onto a real Northwind note, the way
 * settings-plain.spec.ts replays a live connector. The founder sees exactly what would be posted (the video, the words,
 * the link and the networks), the sentence that a posted video cannot be pulled back, and answers signed in: the
 * answer goes to `showcase.answer` with their own ask's id.
 */
const bid = NORTHWIND_BUSINESS_ID;
const REQUEST_ID = "5ca5e000-0000-4000-8000-000000000001";
const CONSENT_ID = "5ca5e000-0000-4000-8000-000000000002";
const RECALL = "You can withdraw any time before it's posted. Once Foundmill posts it, it can't be pulled back from those networks.";
const LINK = "http://localhost:3000/p/northwind-skincare/story?via=p.northwind-skincare";

const ask = {
  consentId: CONSENT_ID,
  requestId: REQUEST_ID,
  preview: {
    slug: "northwind-skincare",
    projectName: "Northwind Skincare",
    brandPrimary: "#1b4fd8",
    brandSecondary: "#f5c400",
    shots: [{ milestoneId: "5ca5e000-0000-4000-8000-000000000003", key: "page_live", label: "Page live", on: "Nov 12, 2026", imageUrl: "http://localhost:3000/m/x/story-image", caption: "Nov 12: page live" }],
    postText: "How Northwind Skincare was built. Page live on Nov 12, 2026.",
    link: LINK,
    networks: ["instagram", "tiktok", "x", "linkedin"],
    video: { clips: [{ milestoneId: "5ca5e000-0000-4000-8000-000000000003", taskId: "5ca5e000-0000-4000-8000-000000000004", url: "http://localhost:3000/showcase-e2e.mp4" }] },
  },
  answer: null,
  withdrawn: false,
  expiresAt: "2026-11-28T12:00:00.000Z",
  state: "asking",
  canAnswer: true,
  canWithdraw: false,
};

/**
 * Runs one replay. On a phone the list gives way to the note, so the browser can drop a request before its answer
 * arrives; its response is then gone and there is nothing to replay. The request the page keeps is replayed.
 */
async function replayed(route: Route, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (/disposed|Target page, context or browser has been closed|Request context disposed/i.test(String(err))) return;
    throw err;
  }
}

const procedures = (route: Route) => decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");

/** Replays the Inbox's note as the founder's own ask, and `showcase.ask` as that ask; records `showcase.answer`. */
async function replayAsk(page: Page): Promise<{ answered: () => Record<string, unknown> | null }> {
  let answered: Record<string, unknown> | null = null;
  await page.route(/\/trpc\/[^?]*inbox\.get/, (route) => replayed(route, async () => {
    const response = await route.fetch();
    const names = procedures(route);
    const body = (await response.json()) as { result?: { data?: { json?: Record<string, unknown> } } }[];
    const data = body[names.indexOf("inbox.get")]?.result?.data?.json as { item?: Record<string, unknown>; approval?: unknown; signoff?: unknown; decisions?: unknown[]; plan?: unknown } | undefined;
    if (data?.item) {
      Object.assign(data.item, { type: "decision", state: "unread", subject: "Foundmill would like to feature Northwind Skincare in a short video", bodyMd: "Open this note to watch it and answer.", decision: { key: "showcase_consent", requestId: REQUEST_ID, consentId: CONSENT_ID, options: [] }, blocksContinue: false, exhibit: { kind: "none" }, statusStrip: [] });
      Object.assign(data, { approval: null, signoff: null, decisions: [], plan: null });
    }
    await route.fulfill({ response, json: body });
  }));
  await page.route(/\/trpc\/[^?]*showcase\.ask/, (route) => replayed(route, async () => {
    const names = procedures(route);
    const response = await route.fetch();
    const body = (await response.json()) as unknown[];
    body[names.indexOf("showcase.ask")] = { result: { data: { json: ask } } };
    await route.fulfill({ response, json: body, status: 200 });
  }));
  await page.route(/\/trpc\/[^?]*showcase\.answer/, async (route) => {
    const sent = JSON.parse(route.request().postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
    answered = Object.values(sent)[0]?.json ?? null;
    await route.fulfill({ status: 200, json: [{ result: { data: { json: { ...ask, answer: "yes", canAnswer: false, canWithdraw: true } } } }] });
  });
  return { answered: () => answered };
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function openAsk(page: Page) {
  await openBusiness(page, "inbox?tab=respond");
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
  await dismissCoachmarks(page);
  await page.getByTestId("inbox-list").getByRole("option").first().click();
  await expect(page).toHaveURL(new RegExp(`/b/${bid}/inbox/[0-9a-f-]{36}`));
  const consent = page.getByTestId("showcase-consent");
  await expect(consent).toBeVisible({ timeout: LONG });
  return consent;
}

for (const width of [390, 1280]) {
  test(`the showcase ask at ${width} px: exactly what would be posted, the sentence that it cannot be pulled back, and the founder's own yes`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const replay = await replayAsk(page);
    const consent = await openAsk(page);
    await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
    await expect(consent.getByTestId("showcase-recall")).toHaveText(RECALL);
    await expect(consent.getByTestId("showcase-post")).toHaveText(ask.preview.postText);
    await expect(consent.getByTestId("showcase-link")).toHaveAttribute("href", LINK);
    await expect(consent.getByTestId("showcase-networks")).toHaveText("Instagram, TikTok, X, LinkedIn");
    await expect(consent.locator("video")).toHaveAttribute("src", ask.preview.video.clips[0]!.url);
    // The generic decision bar is not offered: the ask is answered here.
    await expect(page.getByTestId("decision-bar")).toHaveCount(0);
    await expect.poll(() => overflow(page), { timeout: LONG }).toBeLessThanOrEqual(0);
    const box = (await consent.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    for (const name of ["Yes, post it", "No, thanks"]) {
      const b = (await consent.getByRole("button", { name }).boundingBox())!;
      expect(b.height, `${name} is finger-sized`).toBeGreaterThanOrEqual(43.5);
    }
    await consent.getByRole("button", { name: "Yes, post it" }).click();
    await expect.poll(() => replay.answered(), { timeout: LONG }).toEqual({ businessId: bid, consentId: CONSENT_ID, answer: "yes" });
  });
}
