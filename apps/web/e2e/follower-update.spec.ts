import { expect, test, type Route } from "@playwright/test";
import { LONG, departmentBase, openBusiness } from "./helpers";

/**
 * Write to your followers (WP-08 T3) on Product › Public page. The e2e stack has no mail and runs no gateway, and the
 * seeded Northwind is a sample business (no real followers, so the panel is hidden there): the spec replays the api's
 * answers as a person's project with three confirmed followers would get them, and checks what the screen asks and says.
 * The send itself is covered by apps/gateway `follower-update.test.ts`. Stack and commands: e2e/README.md.
 */
const DRAFT = { id: "11111111-1111-4111-8111-111111111111", subject: "Our first batch", body: "It shipped today.", status: "draft", draftedByAgentId: "22222222-2222-4222-8222-222222222222", sentCount: 0, skippedCount: 0, remainingCount: 0, updatedAt: "2026-11-16T12:00:00.000Z" };
const PREVIEW = { subject: DRAFT.subject, text: "It shipped today.\n\nWritten with help from AI and checked by Maya.", footer: "--\nSent by Northwind Skincare with Foundmill. PO Box 1234, Springfield, IL 62701, USA", followers: 3, perDay: 50, postalAddressMissing: false };

/** The api's answers as a person's project with three followers gets them, by procedure (a GET may batch several). */
const ANSWERS: Record<string, (data: Record<string, unknown>) => unknown> = {
  "page.get": (d) => ({ ...d, isSample: false, saved: true, followers: 3 }),
  "updates.list": () => ({ followers: 3, canSend: true, updates: [DRAFT] }),
  "updates.preview": () => PREVIEW,
};

async function replay(route: Route) {
  const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
  if (route.request().method() !== "GET" || !procedures.some((p) => p in ANSWERS)) return route.fallback();
  try {
    const response = await route.fetch();
    const body = (await response.json()) as { result?: { data?: { json?: unknown } } }[];
    procedures.forEach((p, i) => {
      if (p in ANSWERS) body[i] = { result: { data: { json: ANSWERS[p]!((body[i]?.result?.data?.json ?? {}) as Record<string, unknown>) } } };
    });
    await route.fulfill({ response, json: body });
  } catch {
    // The page moved on while this answer was in flight (a navigation disposes it): nothing to replay.
  }
}

test("a founder checks the update exactly as it goes out, confirms, and is told what happened", async ({ page }) => {
  await page.route(/\/trpc\//, replay);
  let sent: Record<string, unknown> | null = null;
  await page.route(/\/trpc\/[^?]*updates\.send/, async (route) => {
    const posted = JSON.parse(route.request().postData() ?? "{}") as Record<string, { json?: Record<string, unknown> }>;
    sent = Object.values(posted)[0]?.json ?? null;
    await route.fulfill({ json: [{ result: { data: { json: { sent: 3, skipped: 0, remaining: 0, simulated: true, refusal: null, message: "Simulated: email is not switched on here, so nothing was sent." } } } }] });
  });

  const bid = await openBusiness(page, "today");
  await page.goto(`${departmentBase("product", bid)}/public-page`);
  const panel = page.getByTestId("follower-update");
  await expect(panel).toBeVisible({ timeout: LONG });
  const preview = panel.getByTestId("follower-update-preview");
  await expect(preview).toContainText("Written with help from AI and checked by Maya.");
  await expect(preview).toContainText("PO Box 1234, Springfield, IL 62701, USA");

  await panel.getByTestId("follower-update-send").click();
  await expect(page.getByText("This goes to 3 people who asked to hear from")).toBeVisible({ timeout: LONG });
  expect(sent).toBeNull();
  await page.getByTestId("follower-update-confirm").click();
  await expect(panel.getByTestId("follower-update-notice")).toHaveText("Simulated: email is not switched on here, so nothing was sent.", { timeout: LONG });
  expect(sent).toEqual({ businessId: bid, id: DRAFT.id, seenUpdatedAt: DRAFT.updatedAt });
});
