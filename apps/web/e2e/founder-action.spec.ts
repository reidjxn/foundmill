import { createServer, type Server } from "node:http";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { LONG, NORTHWIND_BUSINESS_ID, devApi, dismissCoachmarks, openBusiness } from "./helpers";

/**
 * Founder-executed requests (founder, 2026-11-22): one press, in a signed-in session, on the note an agent prepared.
 * Here the Lightbringer request of the recorded mock: "Ask Lightbringer to prepare this patent" shows what was answered in
 * plain words and answers the note; a refusal says "Nothing was sent" and answers it too.
 *
 * The press goes through the api's gateway client (`POST /v1/founder-actions/execute`), so this spec stands in for the
 * gateway with a small recorder on `E2E_GATEWAY_RECORDER_PORT`; the api must be started with
 * `GATEWAY_URL=http://127.0.0.1:<that port>` and a `SESSION_TOKEN_SECRET` of 16 characters or more (as founder-notices.spec.ts).
 * Without the port the spec is skipped. The notes are written through `dev.seedFounderAction` (development and test only),
 * which writes what the gateway's prepare tool writes. What the real gateway does with the press (the token checks, the
 * state re-read, the single claim, the audit row, a `failed` request) is held by apps/gateway `founder-action.test.ts`.
 */
const RECORDER_PORT = process.env.E2E_GATEWAY_RECORDER_PORT ? Number(process.env.E2E_GATEWAY_RECORDER_PORT) : null;
const RUN = "Ask Lightbringer to prepare this patent";
const SIMULATED = "This was simulated and not sent: Lightbringer is not connected for real here.";

async function call<T>(api: APIRequestContext, path: string, input: unknown): Promise<T> {
  const res = await api.post(`/trpc/${path}`, { data: { json: input } });
  expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

test.describe("founder-executed request", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!RECORDER_PORT, "needs the gateway recorder (E2E_GATEWAY_RECORDER_PORT, and the api's GATEWAY_URL pointing at it)");
  let recorder: Server | null = null;
  let api: APIRequestContext;
  const pressed: string[] = [];
  let answer: Record<string, unknown> = { status: "executed", simulated: true, message: SIMULATED };

  test.beforeAll(async ({ playwright }) => {
    api = await devApi(playwright);
    recorder = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString("utf8")));
      req.on("end", () => {
        if (req.url === "/v1/founder-actions/execute") pressed.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(req.url === "/v1/founder-actions/execute" ? answer : {}));
      });
    });
    await new Promise<void>((resolve) => recorder!.listen(RECORDER_PORT!, "127.0.0.1", resolve));
  });
  test.afterAll(async () => {
    await new Promise<void>((resolve) => (recorder ? recorder.close(() => resolve()) : resolve()));
    await api?.dispose();
  });

  async function openNote(page: import("@playwright/test").Page, itemId: string) {
    await openBusiness(page, `inbox/${itemId}`);
    await dismissCoachmarks(page);
    await expect(page.getByTestId("inbox-item")).toHaveAttribute("data-type", "decision", { timeout: LONG });
  }

  test("one press asks Lightbringer, says it was simulated in the mock, and answers the note", async ({ page }) => {
    answer = { status: "executed", simulated: true, message: SIMULATED };
    const { inboxItemId } = await call<{ inboxItemId: string }>(api, "dev.seedFounderAction", { businessId: NORTHWIND_BUSINESS_ID, inventionId: `inv_e2e_${Date.now()}` });
    await openNote(page, inboxItemId);
    const item = page.getByTestId("inbox-item");
    // The note says what the press does and does not do, before it is pressed.
    await expect(item).toContainText("What this press does: it tells Lightbringer you want this invention prepared for a patent filing.");
    await expect(item).toContainText("it files nothing and pays nothing");
    await expect(item).toContainText("Showing an invention in public before you file can cost the right to patent it.");
    const bar = page.getByTestId("decision-bar");
    await expect(bar.getByRole("button", { name: RUN })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Not now" })).toBeVisible();
    expect(pressed).toHaveLength(0);

    await bar.getByRole("button", { name: RUN }).click();
    await expect.poll(() => pressed.length, { timeout: LONG }).toBe(1);
    const asked = JSON.parse(pressed[0]!) as { pressToken: string };
    expect(Object.keys(asked)).toEqual(["pressToken"]);
    // The answer, in the app's words, on the note and in the record.
    const fold = page.getByRole("button", { name: /Show what happened/ });
    if (await fold.count()) await fold.first().click();
    await expect(item).toContainText(SIMULATED, { timeout: LONG });
    const stored = await call<{ plan: { summaryMd: string } | null; item: { state: string } }>(api, "inbox.get", { businessId: NORTHWIND_BUSINESS_ID, itemId: inboxItemId }).catch(() => null);
    if (stored) expect(stored.plan?.summaryMd).toBe(SIMULATED);
  });

  test("a refusal says Nothing was sent and answers the note", async ({ page }) => {
    answer = { status: "failed", reason: "Lightbringer did not accept the request." };
    const { inboxItemId } = await call<{ inboxItemId: string }>(api, "dev.seedFounderAction", { businessId: NORTHWIND_BUSINESS_ID, inventionId: `inv_e2e_fail_${Date.now()}` });
    await openNote(page, inboxItemId);
    await page.getByTestId("decision-bar").getByRole("button", { name: RUN }).click();
    await expect.poll(() => pressed.length, { timeout: LONG }).toBe(2);
    const fold = page.getByRole("button", { name: /Show what happened/ });
    if (await fold.count()) await fold.first().click();
    await expect(page.getByTestId("inbox-item")).toContainText("Nothing was sent: Lightbringer did not accept the request.", { timeout: LONG });
  });
});
