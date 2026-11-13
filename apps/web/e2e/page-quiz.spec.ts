import { expect, test, type Browser, type Page } from "@playwright/test";
import { LONG, commitThrowaway, devApi, dismissCoachmarks, expectTapTarget, settled } from "./helpers";

/**
 * The optional "Which one is for you?" quiz on a project's public page (migration 0101), on the mock model. A throwaway
 * project publishes its page; with only three customers on record, Product › Public page says plainly that the team
 * waits for six and offers nothing to press. With seven real customers (added through the CRM as the founder would),
 * the team drafts the quiz; the panel says what it rested on, each type's real count, and that nothing is public. The
 * owner approves it and turns it on. Signed out at 390 px, the page shows the quiz before the Follow form: every offer
 * in view before any answer, 44 px answers, no horizontal scroll; answering shows "This one is probably for you" with
 * the matching offer and its Follow button, every offer still listed. Back in the console the result is counted
 * without a name. Turned off, the quiz leaves the page. Stack and commands: e2e/README.md.
 */
const PITCH = "Bike repairs at your door";
const ABOUT = "We come to you with a van full of parts and fix the bike where it stands.";

async function visitor(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  return { page: await context.newPage(), close: () => context.close() };
}

async function publishAndOpen(page: Page, bid: string): Promise<string> {
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

test.describe("page quiz", () => {
  test("drafted from real customers, approved and turned on by the founder, answered signed out at 390 px, counted without a name", async ({ page, browser, playwright }) => {
    test.setTimeout(300_000);
    const bid = await commitThrowaway(page, `Quiz Bikes ${Date.now().toString(36)}`);
    const pagePath = await publishAndOpen(page, bid);
    const api = await devApi(playwright);
    const addCustomer = async (kind: "person" | "organisation", name: string) => {
      const res = await api.post("/trpc/crm.entity.create", { data: { json: { businessId: bid, kind, displayName: name, allowDuplicate: true } } });
      expect(res.ok(), await res.text()).toBe(true);
      const id = (await res.json()).result.data.json.id as string;
      const role = await api.post("/trpc/crm.roles.add", { data: { json: { businessId: bid, entityId: id, role: { role: "customer" } } } });
      expect(role.ok(), await role.text()).toBe(true);
    };

    try {
      // Too few: the team waits, and says why with the real count.
      for (const n of ["Ana", "Ben", "Cleo"]) await addCustomer("person", n);
      await page.reload();
      const panel = page.getByTestId("page-quiz");
      await expect(panel).toBeVisible({ timeout: LONG });
      await expect(panel.getByTestId("quiz-state")).toHaveText(/No quiz yet/);
      await expect(panel.getByTestId("quiz-not-ready")).toHaveText("You have 3 customers on record. The team drafts a quiz from at least 6 real customers, so every type in it rests on real people.");
      await expect(panel.getByRole("button", { name: "Draft from your customers" })).toBeDisabled();

      // Enough: one more person and three organizations.
      for (const n of ["Dev"]) await addCustomer("person", n);
      for (const n of ["Office Fleet", "Courier Co", "Campus Bikes"]) await addCustomer("organisation", n);
      await page.reload();
      await expect(panel.getByRole("button", { name: "Draft from your customers" })).toBeEnabled({ timeout: LONG });
      await panel.getByRole("button", { name: "Draft from your customers" }).click();
      await expect(panel.getByTestId("quiz-editor")).toBeVisible({ timeout: LONG });
      await expect(panel.getByTestId("quiz-state")).toHaveText("Draft, not public");
      await expect(panel.getByTestId("quiz-evidence")).toHaveText("Drafted from 7 customers, 0 replies and 0 purchases on record.");
      await expect(panel.getByText("Rests on 4 of your customers")).toBeVisible();
      await expect(panel.getByText("Rests on 3 of your customers")).toBeVisible();
      await expect(panel.getByTestId("quiz-preview").getByRole("heading", { name: "Which one is for you?" })).toBeVisible();

      // Not public until approved and turned on.
      const before = await visitor(browser, 390, 844);
      try {
        await before.page.goto(pagePath);
        await expect(before.page.locator("[data-project-page]")).toBeVisible({ timeout: LONG });
        await expect(before.page.locator("[data-project-quiz]")).toHaveCount(0);
      } finally {
        await before.close();
      }

      await panel.getByLabel("Opening line").fill("Two quick questions about your bike.");
      await panel.getByRole("button", { name: "Approve" }).click();
      await expect(panel.getByTestId("quiz-state")).toHaveText("Approved, turned off", { timeout: LONG });
      await panel.getByRole("button", { name: "Turn on" }).click();
      await expect(panel.getByTestId("quiz-state")).toHaveText("On your page", { timeout: LONG });

      // Signed out on a phone.
      const phone = await visitor(browser, 390, 844);
      try {
        await phone.page.goto(pagePath);
        const quiz = phone.page.locator("[data-project-quiz]");
        await expect(quiz).toBeVisible({ timeout: LONG });
        await expect(phone.page.getByTestId("needs-larger-window")).toHaveCount(0);
        await expect(quiz.getByRole("heading", { level: 2, name: "Which one is for you?" })).toBeVisible();
        await expect(quiz).toContainText("Two quick questions about your bike.");
        // Before the Follow form, and every offer in view before any answer.
        const order = await phone.page.evaluate(() => {
          const q = document.querySelector("[data-project-quiz]")!;
          const f = document.getElementById("follow")!;
          return Boolean(q.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(order).toBe(true);
        await expect(quiz.locator("[data-quiz-offers] [data-quiz-offer]")).not.toHaveCount(0);
        for (const label of await quiz.locator("[data-quiz-question] label").all()) await expectTapTarget(label, "quiz answer");
        await expectTapTarget(quiz.getByRole("button", { name: "See which one fits" }), "quiz submit");
        await expect(quiz).toContainText("Only the result is counted, never who you are or what else you chose.");
        // Leaving a question out is said plainly.
        await quiz.locator("[data-quiz-question='q1'] input[type=radio]").first().check();
        await quiz.getByRole("button", { name: "See which one fits" }).click();
        // The browser's own required check stops the form; nothing is sent until each question has an answer.
        await expect(quiz.locator("[data-quiz-result]")).toHaveCount(0);
        await quiz.locator("[data-quiz-question='q2'] input[type=radio]").first().check();
        await quiz.getByRole("button", { name: "See which one fits" }).click();
        const result = quiz.locator("[data-quiz-result]");
        await expect(result).toBeVisible({ timeout: LONG });
        await expect(result).toContainText("This one is probably for you");
        await expect(result.getByRole("link", { name: "Follow" })).toHaveAttribute("href", "#follow");
        await expect(quiz.locator("[data-quiz-offers] [data-quiz-offer]")).not.toHaveCount(0);
        // No count of anyone, no pressure, no horizontal scroll.
        await expect(quiz).not.toContainText(/\d+ (people|visitors|customers)/);
        const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "horizontal overflow at 390 px").toBeLessThanOrEqual(0);

        // The network session's asks (Nov 13, 2026). The foot's mark still goes exactly where it did, quiz or not.
        const slug = pagePath.replace("/p/", "");
        await expect(phone.page.getByRole("link", { name: "Built on Foundmill" })).toHaveAttribute("href", `/?via=p.${slug}`);
        // A result that offers Follow scrolls to the form on the same page and sends nothing.
        const posts: string[] = [];
        phone.page.on("request", (r) => {
          if (r.method() !== "GET") posts.push(r.url());
        });
        await result.getByRole("link", { name: "Follow" }).click();
        await expect(phone.page).toHaveURL(new RegExp(`${pagePath}#follow$`));
        await expect(phone.page.locator("#follow form[data-project-follow]")).toBeInViewport({ timeout: LONG });
        await expect(phone.page.locator("[data-project-follow='done']")).toHaveCount(0);
        await phone.page.waitForTimeout(500);
        expect(posts, "nothing is submitted by following the quiz's Follow link").toEqual([]);
        // The story page has no quiz (it answers not found here: no milestone is shown yet).
        await phone.page.goto(`${pagePath}/story`);
        await expect(phone.page.locator("[data-project-quiz]")).toHaveCount(0);
      } finally {
        await phone.close();
      }

      // Counted for the founder, without a name.
      await page.reload();
      await expect(panel.getByTestId("quiz-results")).toContainText("1 visitor got this result", { timeout: LONG });
      await expect(panel.getByTestId("quiz-results")).toContainText("counted without names");

      // Turned off: gone from the page.
      await panel.getByRole("button", { name: "Turn off" }).click();
      await expect(panel.getByTestId("quiz-state")).toHaveText("Approved, turned off", { timeout: LONG });
      const after = await visitor(browser, 390, 844);
      try {
        await after.page.goto(pagePath);
        await expect(after.page.locator("[data-project-page]")).toBeVisible({ timeout: LONG });
        await expect(after.page.locator("[data-project-quiz]")).toHaveCount(0);
      } finally {
        await after.close();
      }
    } finally {
      await api.dispose();
    }
  });
});
