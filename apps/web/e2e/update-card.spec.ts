import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { API_URL, LONG, NORTHWIND_BUSINESS_ID, devApi, expectTapTarget, signIn, toast } from "./helpers";

/**
 * A Customer Update shared as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; docs/DESIGN.md §9f; migration
 * 0136). Harbor Bikes is the seed's one real project (packages/db/src/seed/e2e-project.ts, `SEED_E2E_PROJECT=1`): its
 * page is live and its one Customer Update came from a real payment. Its founder opens that Customer Update, presses
 * "Share as a card", sees the card as a visitor will, adds a line of their own and presses "Make the card". Signed
 * out, at 390 px and 1280 px, `/m/update/<id>` shows the project, the day, "New customer", "Verified by Foundmill",
 * the lead channel and the standout agent (an AI agent) and the founder's line; nothing of the customer, no amount,
 * no number but the date; noindex; both share images. "Stop sharing" takes the card and its images down. Northwind
 * Skincare is an example business: its Customer Updates carry no share action, and the api refuses one. Stack and
 * commands: e2e/README.md.
 */
const HARBOR_ID = "b1e5e5e5-0000-4000-8000-0000000000e2";
const HARBOR_NAME = "Harbor Bikes";
const CUSTOMER = { name: "Marguerite Okonkwo-Bell", first: "Marguerite", email: "marguerite@customer.example" };
const NOTE = "Our first repair booked from a search. Thank you.";
const US_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

const input = (json: unknown) => encodeURIComponent(JSON.stringify({ json }));

async function firstJourneyId(api: APIRequestContext, businessId: string): Promise<string> {
  const res = await api.get(`/trpc/journey.list?input=${input({ businessId, limit: 1 })}`);
  expect(res.ok(), `journey.list answered ${res.status()}`).toBe(true);
  const id = ((await res.json()) as { result: { data: { json: { items: { id: string }[] } } } }).result.data.json.items[0]?.id;
  expect(id, "the seed gives this business a Customer Update").toBeTruthy();
  return id!;
}

async function cardState(api: APIRequestContext, businessId: string, journeyId: string) {
  const res = await api.get(`/trpc/journey.updateCard?input=${input({ businessId, journeyId })}`);
  expect(res.ok(), `journey.updateCard answered ${res.status()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: { canShare: boolean; refusal: string | null; card: { id: string; url: string } | null } } } }).result.data.json;
}

/** A signed-out visitor's page at `width`. */
async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 600, isMobile: width < 600 });
  return { page: await context.newPage(), close: () => context.close() };
}

async function expectCard(page: Page, path: string, width: number): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  const card = page.locator("[data-update-card]");
  await expect(card).toBeVisible({ timeout: LONG });
  await expect(card.locator("[data-project-name]")).toHaveText(HARBOR_NAME);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New customer");
  await expect(card.locator("time")).toHaveText(US_DATE);
  // A date, never a time of day.
  expect(await card.locator("time").getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const verified = card.locator("[data-verified]");
  await expect(verified).toHaveText("Verified by Foundmill");
  await expect(verified.locator("svg")).toHaveCount(1);
  await expect(card.locator("[data-card-note]")).toHaveText("Foundmill recorded this payment when it arrived. It was not typed in.");
  await expect(card.locator("[data-update-channel]")).toHaveText(/\S/);
  await expect(card.locator("[data-update-agent]")).toHaveText(/\S.* \(AI agent\)$/);
  // The founder's own line, apart from what the platform recorded and named as theirs.
  const note = card.locator("[data-update-note]");
  await expect(note.locator("figcaption")).toHaveText(`A note from ${HARBOR_NAME}`);
  await expect(note.locator("blockquote")).toHaveText(NOTE);
  await expect(card.locator("[data-card-project]")).toHaveAttribute("href", "/p/harbor-bikes");
  // The free plan's one small line, for a visitor.
  await expect(card.locator('[data-project-mark="visitor"]')).toContainText(`${HARBOR_NAME} is built on Foundmill.`);

  // No personal data, no amount, no count: the whole document, markup and metadata included.
  const html = await page.content();
  for (const hidden of [CUSTOMER.name, CUSTOMER.first, "Okonkwo", CUSTOMER.email, "customer.example", "137.50", "13750", "13,750"]) expect(html, `the card's page holds "${hidden}"`).not.toContain(hidden);
  const text = (await card.innerText()).replace(await card.locator("time").innerText(), "");
  expect(text, "no number on the card but its date").not.toMatch(/\d/);

  // Not indexed, with its own title; from 390 px without the larger-window note or a sideways scroll.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page).toHaveTitle(`New customer: ${HARBOR_NAME}`);
  await expect(page.getByTestId("needs-larger-window")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
  const links = card.locator("a");
  for (let i = 0; i < (await links.count()); i++) await expectTapTarget(links.nth(i), `link ${i + 1} tap target at ${width} px`);
  const smallest = await card.evaluate((el) => Math.min(...[...el.querySelectorAll<HTMLElement>("p, h1, dt, dd, span, a, time, figcaption, blockquote")].filter((e) => e.textContent?.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))));
  expect(smallest, `smallest text at ${width} px`).toBeGreaterThanOrEqual(11);
}

test.describe("a Customer Update shared as a card", () => {
  test.describe.configure({ timeout: 300_000 });

  test("an example business has no share action, and the api refuses one", async ({ page, playwright }) => {
    const api = await devApi(playwright);
    try {
      const journeyId = await firstJourneyId(api, NORTHWIND_BUSINESS_ID);
      expect(await cardState(api, NORTHWIND_BUSINESS_ID, journeyId)).toMatchObject({ canShare: false, refusal: "sample", card: null });
      const refused = await api.post("/trpc/journey.shareUpdate", { data: { json: { businessId: NORTHWIND_BUSINESS_ID, journeyId } } });
      expect(refused.ok()).toBe(false);
      expect(await refused.text()).toContain("sample business");

      await signIn(page);
      const state = page.waitForResponse((r) => r.url().includes("journey.updateCard") && r.ok(), { timeout: LONG });
      await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/journey/${journeyId}`);
      await expect(page.getByTestId("journey-screen")).toBeVisible({ timeout: LONG });
      await state;
      await expect(page.getByTestId("journey-crm-link")).toBeVisible();
      for (const id of ["update-card-share", "update-card-shared", "update-card-needs-page"]) await expect(page.getByTestId(id)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Share as a card" })).toHaveCount(0);
    } finally {
      await api.dispose();
    }
  });

  test("a real project's founder shares one; the public card shows no personal data; stopping takes it down", async ({ page, browser, playwright }) => {
    const api = await devApi(playwright);
    try {
      const journeyId = await firstJourneyId(api, HARBOR_ID);
      // A run that stopped half-way may have left it shared: start from private, as every Customer Update does.
      await api.post("/trpc/journey.unshareUpdate", { data: { json: { businessId: HARBOR_ID, journeyId } } });
      expect(await cardState(api, HARBOR_ID, journeyId)).toMatchObject({ canShare: true, refusal: null, card: null });

      await signIn(page);
      await page.goto(`/b/${HARBOR_ID}/journey/${journeyId}`);
      await expect(page.getByTestId("journey-screen")).toBeVisible({ timeout: LONG });
      const share = page.getByTestId("update-card-share");
      await expect(share).toBeVisible({ timeout: LONG });
      await expect(share).toHaveText("Share as a card");
      await expect(page.getByTestId("update-card-shared")).toHaveCount(0);

      // The dialog says what the card shows and leaves out, and shows the card before anything is public.
      await share.click();
      const dialog = page.getByTestId("update-card-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("It leaves out the customer's name, the amount and everything else about them.");
      await expect(dialog).toContainText("Nothing is public until you press Make the card");
      const preview = dialog.getByTestId("update-card-preview");
      await expect(preview.locator("[data-update-headline]")).toHaveText("New customer");
      await expect(preview.locator("[data-project-name]")).toHaveText(HARBOR_NAME);
      await expect(preview).not.toContainText(CUSTOMER.first);
      // Opening the dialog shared nothing; so does closing it.
      expect((await cardState(api, HARBOR_ID, journeyId)).card).toBeNull();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      expect((await cardState(api, HARBOR_ID, journeyId)).card).toBeNull();

      await share.click();
      await dialog.getByTestId("update-card-note").fill(NOTE);
      await expect(preview.locator("[data-update-note] blockquote")).toHaveText(NOTE);
      await dialog.getByTestId("update-card-confirm").click();
      await expect(toast(page, /The card is public|Copy this link/)).toBeVisible({ timeout: LONG });
      const shared = page.getByTestId("update-card-shared");
      await expect(shared).toBeVisible();
      await expect(shared).toContainText("Shared as a card");
      await expect(page.getByTestId("update-card-share")).toHaveCount(0);

      const state = await cardState(api, HARBOR_ID, journeyId);
      const cardId = state.card!.id;
      const path = `/m/update/${cardId}`;
      expect(await shared.getAttribute("data-card-url")).toBe(state.card!.url);
      expect(state.card!.url.endsWith(path)).toBe(true);
      expect(cardId, "the card's address is its own id, not the Customer Update's").not.toBe(journeyId);

      for (const [width, height] of [[390, 844], [1280, 800]] as const) {
        const v = await visitor(browser, width, height);
        try {
          await expectCard(v.page, path, width);
          // Both share images, as a visitor.
          for (const image of [`${path}/opengraph-image`, `${path}/story-image`]) {
            const res = await v.page.request.get(image);
            expect(res.status(), image).toBe(200);
            expect(res.headers()["content-type"], image).toContain("image/png");
          }
          // The public read itself holds nothing of the customer either.
          const read = await v.page.request.get(`${API_URL}/trpc/publicPage.updateCardById?input=${input({ id: cardId })}`);
          const body = await read.text();
          for (const hidden of [CUSTOMER.first, CUSTOMER.email, journeyId, HARBOR_ID, "amount"]) expect(body).not.toContain(hidden);
        } finally {
          await v.close();
        }
      }

      // Stop sharing: the founder's press again, and the card, its images and the read are gone at once.
      await page.getByTestId("update-card-stop").click();
      await expect(toast(page, "The card is no longer public")).toBeVisible({ timeout: LONG });
      await expect(page.getByTestId("update-card-share")).toBeVisible();
      const v = await visitor(browser, 390, 844);
      try {
        const gone = await v.page.goto(path);
        expect(gone?.status()).toBe(404);
        await expect(v.page.getByTestId("update-card-not-found")).toBeVisible({ timeout: LONG });
        await expect(v.page.getByText("No card here")).toBeVisible();
        await expect(v.page.getByTestId("needs-larger-window")).toHaveCount(0);
        await expectTapTarget(v.page.getByRole("link", { name: "Go to Foundmill" }));
        expect((await v.page.request.get(`${path}/story-image`)).status()).toBe(404);
        expect((await v.page.request.get(`${path}/opengraph-image`)).status()).toBe(404);
      } finally {
        await v.close();
      }
    } finally {
      await api.dispose();
    }
  });
});
