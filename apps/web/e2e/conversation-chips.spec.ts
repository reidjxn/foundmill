import { expect, test, type Request } from "@playwright/test";
import { LONG, openBusiness } from "./helpers";

/**
 * A quick reply carries the option it names on screen (security review 2026-10-10): chip ids repeat across messages
 * ("go_with"), so the api refuses a chip whose id now names another option instead of deciding that option. The send is
 * intercepted and aborted here, so the seeded decision is never used up by this spec.
 */
test("pressing a quick reply sends its id and the option it names", async ({ page }) => {
  await openBusiness(page, "inbox?tab=respond");
  await expect(page.getByTestId("inbox-list")).toBeVisible({ timeout: LONG });
  const decision = page.getByTestId("inbox-list").getByRole("option").filter({ hasText: "Approve batch 002" }).first();
  await expect(decision, "the seed gives Northwind the batch 002 decision").toBeVisible({ timeout: LONG });
  await decision.click();
  const desk = page.getByTestId("agent-desk");
  await expect(desk).toBeVisible({ timeout: LONG });
  const replies = desk.getByTestId("quick-replies").locator("[data-quick-reply]:not([data-quick-reply=write])");
  await expect(replies.first()).toBeVisible({ timeout: LONG });

  // Prefer the "Go with: …" chip while the decision is open; any chip shows the field is sent.
  const goWith = replies.filter({ hasText: /Go with:/ });
  const chip = (await goWith.count()) > 0 ? goWith.first() : replies.first();
  const chipId = await chip.getAttribute("data-quick-reply");
  const choosesOption = /Go with:/.test(await chip.innerText());

  let sent: Request | null = null;
  await page.route(/\/trpc\/[^?]*agent\.conversation\.send/, async (route) => {
    sent = route.request();
    await route.abort();
  });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await chip.click();
  await expect.poll(() => sent !== null, { timeout: LONG }).toBe(true);

  const body = JSON.parse((sent as unknown as Request).postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
  const input = Object.values(body)[0]?.json ?? {};
  expect(input.quickReplyId).toBe(chipId);
  expect(input).toHaveProperty("optionId");
  if (choosesOption) expect(typeof input.optionId === "string" && (input.optionId as string).length > 0).toBe(true);
  else expect(input.optionId).toBeNull();

  // Nothing reached the api: the decision is still open.
  await expect(page.getByTestId("decision-bar")).toHaveAttribute("data-state", "open");
});
