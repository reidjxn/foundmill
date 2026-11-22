import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, devApi, dismissCoachmarks, expectTapTarget, settled } from "./helpers";
// Only node:crypto behind it, so the spec signs the customer's link the way the gateway does (the stack has no
// SESSION_TOKEN_SECRET unless the environment sets one, and then the api uses that).
import { DEV_BOOKING_LINK_SECRET, bookingManageToken } from "../../../packages/connectors/src/connectors/platform_mail/booking";

/**
 * Foundmill's own booking (founder, Nov 22, 2026), on the mock stack. A throwaway project publishes its page; through
 * the api the founder saves one 60-minute service with weekday hours in America/Chicago and turns booking on. A
 * visitor at 390 px whose browser is in Berlin sees the booking block on the page, opens the booking page, reads times
 * in Berlin (the first one is the Berlin wall time of that instant), books, and is told "You are booked." The founder's
 * Customers › Bookings lists it at the Chicago wall time of the same instant. The visitor opens their own link,
 * picks another time and sees it moved; the first time is offered again, and a second visitor is not offered the new
 * one. On the desktop the founder cancels the booking and the row reads Canceled. Stack and commands: e2e/README.md.
 */
const PITCH = "Bike repairs at your door";
const ABOUT = "We come to you with a van full of parts and fix the bike where it stands.";
const EMAIL = "ana.visitor@example.com";
const SECRET = process.env.SESSION_TOKEN_SECRET && process.env.SESSION_TOKEN_SECRET.length >= 16 ? process.env.SESSION_TOKEN_SECRET : DEV_BOOKING_LINK_SECRET;
const WEEKDAY = [{ start: 540, end: 1020 }];

/** A signed-out visitor's phone whose browser is in `timezoneId`. */
async function visitor(browser: Browser, timezoneId: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, timezoneId, locale: "en-US" });
  return { page: await context.newPage(), close: () => context.close() };
}

const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");
const clock = (iso: string, timeZone: string) => plain(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)));
const day = (iso: string, timeZone: string) => plain(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso)));

async function publish(page: Page, bid: string): Promise<string> {
  await page.goto(`/b/${bid}/today`);
  await expect(page.getByTestId("today-screen")).toBeVisible({ timeout: LONG });
  const check = page.getByTestId("needs-you").getByRole("button", { name: "Check it and publish" });
  await expect(async () => {
    await page.reload();
    await expect(check).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: LONG });
  await dismissCoachmarks(page);
  await check.click();
  await page.waitForURL(new RegExp(`/b/${bid}/d/[^/]+/public-page$`), { timeout: LONG });
  await settled(page);
  await dismissCoachmarks(page);
  const editor = page.getByTestId("public-page-editor");
  await editor.getByLabel(/One-line pitch/).fill(PITCH);
  await editor.getByRole("textbox", { name: /^About/ }).fill(ABOUT);
  await editor.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByTestId("page-confirm-publish").click();
  await expect(page.getByTestId("page-state")).toHaveText(/Live since/, { timeout: LONG });
  return new URL((await page.getByTestId("page-url").innerText()).trim()).pathname;
}

const trpc = async <T = unknown>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> => {
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
};
const query = (api: APIRequestContext, path: string, input: Record<string, unknown>) => api.get(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
const mutate = (api: APIRequestContext, path: string, input: Record<string, unknown>) => api.post(`/trpc/${path}`, { data: { json: input } });

test.describe("booking", () => {
  test("a visitor in Berlin books a Chicago project's time at 390 px, moves it from their link, and the founder sees it at Chicago time and cancels it", async ({ page, browser, playwright }) => {
    test.setTimeout(420_000);
    const bid = await commitThrowaway(page, `Booking Bikes ${Date.now().toString(36)}`);
    const pagePath = await publish(page, bid);
    const slug = pagePath.replace("/p/", "");
    const api = await devApi(playwright);
    const first = await visitor(browser, "Europe/Berlin");
    const second = await visitor(browser, "Europe/Berlin");

    try {
      // The founder's setup, through the api: Chicago hours Monday to Friday, one 60-minute service, then the press that turns it on.
      await trpc(await mutate(api, "business.setTimeZone", { businessId: bid, timeZone: "America/Chicago" }));
      const setup = await trpc<{ services: { id: string }[] }>(
        await mutate(api, "booking.save", {
          businessId: bid,
          timeZone: "America/Chicago",
          weeklyHours: { "1": WEEKDAY, "2": WEEKDAY, "3": WEEKDAY, "4": WEEKDAY, "5": WEEKDAY },
          services: [{ name: "Intro call", durationMin: 60, minNoticeMin: 0, maxDaysAhead: 60, questions: [] }],
        }),
      );
      await trpc(await mutate(api, "booking.setLive", { businessId: bid, live: true }));
      const serviceId = setup.services[0]!.id;
      const openSlots = async (): Promise<string[]> => {
        const from = new Date();
        const to = new Date(from.getTime() + 14 * 86_400_000);
        return (await trpc<{ slots: string[] }>(await query(api, "publicBooking.slots", { slug, serviceId, from: from.toISOString(), to: to.toISOString() }))).slots;
      };
      const before = await openSlots();
      expect(before.length).toBeGreaterThan(3);
      const firstSlot = before[0]!;

      // The console's Booking panel says it is live, with its public address.
      await page.reload();
      await settled(page);
      const panel = page.getByTestId("booking-panel");
      await expect(panel.getByTestId("booking-url")).toHaveText(new RegExp(`${pagePath}/book$`), { timeout: LONG });
      await expect(panel.getByText(/^Live on your page since/)).toBeVisible();

      // The visitor, from Berlin on a phone: the block on the project page, then the booking page.
      const v = first.page;
      await v.goto(pagePath);
      const block = v.locator("[data-booking-block]");
      await expect(block).toBeVisible({ timeout: LONG });
      await expect(block).toContainText("Intro call");
      const open = block.getByRole("link", { name: "See open times" });
      await expectTapTarget(open, "See open times is a 44 px target");
      await open.click();
      await v.waitForURL(`**${pagePath}/book`);
      await expect(v.getByRole("heading", { level: 1 })).toHaveText(/^Book a time with Booking Bikes/);
      await expect(v.locator("[data-booking-zone]")).toHaveText(/^Times shown in Berlin time \((GMT\+[12]|CES?T)\)$/, { timeout: LONG });
      const times = v.locator("[data-booking-times] button");
      await expect(times.first()).toHaveText(clock(firstSlot, "Europe/Berlin"));
      expect(await v.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await times.first().click();
      await expect(v.locator("[data-booking-chosen]")).toHaveText(`Intro call · ${day(firstSlot, "Europe/Berlin")}, ${clock(firstSlot, "Europe/Berlin")}`);
      await expect(v.locator("[data-booking-hold]")).toBeVisible({ timeout: LONG });
      await v.getByLabel("Your name").fill("Ana Visitor");
      await v.getByLabel("Your email").fill(EMAIL);
      await v.getByText(/I agree that .* keeps my name/).click();
      await v.getByRole("button", { name: "Book this time" }).click();
      await expect(v.getByRole("heading", { name: "You are booked." })).toBeVisible({ timeout: LONG });
      await expect(v.getByText(`We sent a confirmation to ${EMAIL}`)).toBeVisible();

      // The founder's Customers › Bookings, at the business's own (Chicago) wall time of the same instant.
      await page.goto(`/b/${bid}/crm?view=bookings`);
      const table = page.getByTestId("bookings-view");
      const row = table.getByRole("row").filter({ hasText: "Ana Visitor" });
      await expect(row).toBeVisible({ timeout: LONG });
      await expect(row).toContainText(`${day(firstSlot, "America/Chicago")}, ${clock(firstSlot, "America/Chicago")}`);
      await expect(row).toContainText("Confirmed");

      // The customer's own link: pick another time and see it moved; the first time is open again.
      const list = await trpc<{ id: string; customerEmail: string; startsAt: string }[]>(await query(api, "booking.list", { businessId: bid, when: "upcoming" }));
      const booked = list.find((b) => b.customerEmail === EMAIL)!;
      expect(booked.startsAt).toBe(firstSlot);
      await v.goto(`${pagePath}/book/manage?t=${encodeURIComponent(bookingManageToken(SECRET, booked.id))}`);
      await expect(v.locator("[data-booking-facts]")).toContainText("Intro call", { timeout: LONG });
      await v.getByRole("button", { name: "Pick another time" }).click();
      const choices = v.locator("[data-booking-pick] [data-booking-times] button");
      await expect(choices.first()).toBeVisible({ timeout: LONG });
      // An hour later (slots are every 30 minutes and the service lasts 60), so the new time does not overlap the first one.
      if ((await choices.count()) > 2) await choices.nth(2).click();
      else {
        await v.locator("[data-booking-pick]").getByRole("group", { name: "Day" }).getByRole("button").nth(1).click();
        await choices.first().click();
      }
      await expect(v.locator("[data-booking-state]")).toHaveText("Your booking is moved.", { timeout: LONG });
      const moved = (await trpc<{ id: string; startsAt: string }[]>(await query(api, "booking.list", { businessId: bid, when: "upcoming" }))).find((b) => b.id === booked.id)!;
      expect(moved.startsAt).not.toBe(firstSlot);
      await expect(v.locator("[data-booking-facts]")).toContainText(clock(moved.startsAt, "Europe/Berlin"));

      await v.goto(`${pagePath}/book`);
      await expect(v.locator("[data-booking-times] button").first()).toHaveText(clock(firstSlot, "Europe/Berlin"), { timeout: LONG });
      const after = await openSlots();
      expect(after).toContain(firstSlot);
      expect(after).not.toContain(moved.startsAt);

      // A second visitor does not see the time the first one now holds.
      const w = second.page;
      await w.goto(`${pagePath}/book`);
      await expect(w.locator("[data-booking-times] button").first()).toBeVisible({ timeout: LONG });
      await w.getByRole("group", { name: "Day" }).getByRole("button", { name: day(moved.startsAt, "Europe/Berlin") }).click();
      await expect(w.locator("[data-booking-times] button").filter({ hasText: new RegExp(`^${clock(moved.startsAt, "Europe/Berlin")}$`) })).toHaveCount(0);

      // A link that is not valid is a real page, not an error.
      await w.goto(`${pagePath}/book/manage?t=not-a-real-token`);
      await expect(w.getByTestId("booking-not-found")).toContainText("This booking link is not valid.");

      // On the desktop the founder cancels it, behind a confirmation, and the row reads Canceled.
      await page.goto(`/b/${bid}/crm?view=bookings`);
      await expect(row).toBeVisible({ timeout: LONG });
      await page.getByRole("button", { name: "Actions for Intro call, Ana Visitor" }).click();
      await page.getByRole("menuitem", { name: "Cancel" }).click();
      await expect(page.getByText(/The customer is told by email\./)).toBeVisible();
      await page.getByRole("button", { name: "Cancel booking" }).click();
      await expect(row).toContainText("Canceled", { timeout: LONG });
    } finally {
      await first.close();
      await second.close();
      await api.dispose();
    }
  });
});
