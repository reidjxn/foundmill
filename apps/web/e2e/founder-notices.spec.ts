import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, commitThrowaway, LONG, NORTHWIND_BUSINESS_ID, signIn } from "./helpers";
import { DEMO_OWNER_USER_ID } from "../../../packages/db/src/seed/constants";

/**
 * Founder notices and the former founder's cancel (security review P2-3; docs/DESIGN.md §9g). Stack and commands:
 * e2e/README.md.
 *
 *   - the dev founder starts a project and invites a second account as a cofounder, who accepts; the cofounder lowers
 *     the dev founder's role, removes them and asks for the project's deletion;
 *   - the deletion's founder notice to the dev founder carries a one-click cancel: `/a/<token>`, signed out, at 390 px,
 *     says which project and when, changes nothing until its button is pressed (a POST), then says it is canceled;
 *   - asked again, the dev founder's home (`/b/<their other business>/home`) shows the card for that project; Cancel asks
 *     once more, then the deletion is canceled and the card says so; the project's deletion status agrees each time.
 *
 * The emails go through the api's gateway client (`POST /v1/notify/email`), and the link's token only exists in the
 * request the api sends there. So this spec stands in for the gateway with a small recorder on
 * `E2E_GATEWAY_RECORDER_PORT`, and the api must be started with `GATEWAY_URL=http://127.0.0.1:<that port>` and a
 * `SESSION_TOKEN_SECRET` (16 characters or more). Without the port the `/a/<token>` test is skipped and the card is
 * still tested (the founders' emails are not sent then, which changes nothing of the steps themselves).
 */
const PHONE = { width: 390, height: 844 };
const RECORDER_PORT = process.env.E2E_GATEWAY_RECORDER_PORT ? Number(process.env.E2E_GATEWAY_RECORDER_PORT) : null;
type Asked = { userId?: string; kind?: string; businessId?: string; data?: { auditId?: string; cancelToken?: string } };

/** The stub address the api's dev bootstrap gives a `dev:<id>` account (apps/api services/dev-users.ts `devUserEmail`). */
const devAddress = (id: string) => `dev-${id.toLowerCase()}@foundmill.local`;

async function call<T>(api: APIRequestContext, path: string, input: unknown, method: "post" | "get" = "post"): Promise<T> {
  const res = method === "post" ? await api.post(`/trpc/${path}`, { data: { json: input } }) : await api.get(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  expect(res.ok(), `${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe("founder notices and the former founder's cancel", () => {
  test.describe.configure({ mode: "serial" });
  const cofounder = randomUUID();
  const asked: Asked[] = [];
  let recorder: Server | null = null;
  let owner: APIRequestContext;
  let other: APIRequestContext;
  let bid = "";
  const name = `Notice Bakery ${cofounder.slice(0, 4)}`;

  test.beforeAll(async ({ playwright }) => {
    if (RECORDER_PORT) {
      recorder = createServer((req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString("utf8")));
        req.on("end", () => {
          if (req.url === "/v1/notify/email") asked.push(JSON.parse(body) as Asked);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sent: true, simulated: true, eventId: null }));
        });
      });
      await new Promise<void>((resolve) => recorder!.listen(RECORDER_PORT, "127.0.0.1", resolve));
    }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: "Bearer dev" } });
    other = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer dev:${cofounder}` } });
  });
  test.afterAll(async () => {
    await owner?.dispose();
    await other?.dispose();
    await new Promise<void>((resolve) => (recorder ? recorder.close(() => resolve()) : resolve()));
  });

  test("a cofounder lowers the dev founder's role, removes them and asks for the project's deletion", async ({ page }) => {
    bid = await commitThrowaway(page, name);
    const made = await call<{ link: string }>(owner, "invitation.create", { businessId: bid, role: "cofounder", email: devAddress(cofounder) });
    await call(other, "invitation.accept", { token: new URL(made.link).pathname.split("/").pop() });
    await call(other, "team.humans.role", { businessId: bid, userId: DEMO_OWNER_USER_ID, role: "member" });
    await call(other, "team.humans.remove", { businessId: bid, userId: DEMO_OWNER_USER_ID });
    await call(other, "business.requestDeletion", { businessId: bid });
    expect((await call<{ status: string }>(other, "business.deletionStatus", { businessId: bid }, "get")).status).toBe("scheduled");
  });

  test("/a/<token> from the deletion's email, signed out at 390 px: it says which project, changes nothing, then cancels once", async ({ browser }) => {
    test.skip(!RECORDER_PORT, "needs the gateway recorder (E2E_GATEWAY_RECORDER_PORT, and the api's GATEWAY_URL pointing at it)");
    const toOwner = asked.filter((a) => a.kind === "founder_notice" && a.businessId === bid && a.userId === DEMO_OWNER_USER_ID);
    // The role change, the removal and the deletion: three notices to the dev founder, the last with the cancel link.
    expect(toOwner).toHaveLength(3);
    const token = toOwner.at(-1)!.data!.cancelToken!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The cofounder who did it is never emailed about it.
    expect(asked.filter((a) => a.kind === "founder_notice" && a.userId === cofounder)).toHaveLength(0);

    const context = await browser.newContext({ viewport: PHONE });
    const phone = await context.newPage();
    await phone.goto(`/a/${token}`);
    const card = phone.getByTestId("email-answer");
    await expect(card).toHaveAttribute("data-kind", "cancel_deletion", { timeout: LONG });
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(phone.getByText(name).first()).toBeVisible();
    await expect(phone.getByText(/It does not give you your place back/)).toBeVisible();
    expect(await phone.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
    await expect(phone.getByTestId("needs-larger-window")).toHaveCount(0);
    await noHorizontalScroll(phone);
    // Opening it changed nothing.
    expect((await call<{ status: string }>(other, "business.deletionStatus", { businessId: bid }, "get")).status).toBe("scheduled");
    const button = phone.getByRole("button", { name: "Cancel the deletion" });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    await button.click();
    await expect(card).toHaveAttribute("data-state", "canceled", { timeout: LONG });
    await expect(phone.getByText("Deletion canceled")).toBeVisible();
    expect((await call<{ status: string }>(other, "business.deletionStatus", { businessId: bid }, "get")).status).toBe("cancelled");
    // Once: the link is spent.
    await phone.reload();
    await expect(card).toHaveAttribute("data-state", "used", { timeout: LONG });
    await context.close();
    // The founders hear who canceled.
    expect(asked.filter((a) => a.kind === "founder_notice" && a.businessId === bid && a.userId === cofounder)).toHaveLength(1);
  });

  test("the card on the dev founder's home: listed while the deletion waits, asks once more, cancels and says so", async ({ page }) => {
    test.skip(!bid, "needs the project made above");
    await call(other, "business.requestDeletion", { businessId: bid });
    await signIn(page);
    await page.goto(`/b/${NORTHWIND_BUSINESS_ID}/home`);
    const card = page.getByTestId("former-project-card");
    await expect(card).toBeVisible({ timeout: LONG });
    await expect(card.getByRole("heading")).toHaveText(`${name} is set to be deleted`);
    await expect(card).toContainText("you can still cancel the deletion until");
    await card.getByTestId("former-project-cancel").click();
    await expect(card).toHaveAttribute("data-state", "confirming");
    expect((await call<{ status: string }>(other, "business.deletionStatus", { businessId: bid }, "get")).status).toBe("scheduled");
    await card.getByTestId("former-project-confirm").click();
    await expect(card).toHaveAttribute("data-state", "done", { timeout: LONG });
    await expect(card.getByRole("heading")).toHaveText(`The deletion of ${name} is canceled, and every founder was told.`);
    expect((await call<{ status: string }>(other, "business.deletionStatus", { businessId: bid }, "get")).status).toBe("cancelled");
    // Nothing else came back: the dev founder is still out of the project.
    const mine = await call<{ businesses: { id: string }[] }>(owner, "founder.businesses.list", undefined, "get");
    expect(mine.businesses.map((b) => b.id)).not.toContain(bid);
    // And with nothing left to keep, the card is gone after a reload.
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: LONG });
    await expect(page.getByTestId("former-project-card")).toHaveCount(0);
  });
});
