/**
 * `/mail/notify/off` (packages 1.5 and 5.1): the link in the footer of Foundmill's own email to a person. Opening it asks;
 * the one-click POST (or the button) turns that kind of email off in the person's own preferences, and nobody else's;
 * a token signed with another secret, for another person, or a project's unsubscribe token changes nothing; with the
 * domain unset the route does not exist.
 */
import { notifyOffToken, platformUnsubscribeToken, suppressionHashOfEmail } from "@foundmill/connectors";
import { MOCK_SENDGRID_PUBLIC_KEY } from "@foundmill/connectors/connectors/sendgrid/fixtures/sendgrid";
import { repos } from "@foundmill/db";
import { NOTIFY_OFF_PAGE } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIngestHarness, type IngestHarness } from "./harness";

const DOMAIN = "mail.foundmill.test";
const SECRET = "ingest-test-platform-mail-signing-secret";
const platformMail = { domain: DOMAIN, signingSecret: SECRET, inboundToken: "ingest-test-platform-inbound-token", eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY };

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("notify-off", { platformMail });
}, 120_000);
afterAll(() => hz?.close());

const at = (token: string, init?: RequestInit) => fetch(`${hz.base}/mail/notify/off?t=${encodeURIComponent(token)}`, init);
const emailOn = async (userId: string) => (await repos.preferences.get(hz.db, userId)).email.decision_waiting;

describe("/mail/notify/off", () => {
  it("opening the link asks and changes nothing; the one-click POST turns the kind off for that person only", async () => {
    const token = notifyOffToken(SECRET, hz.A.ownerId, "decision_waiting");
    const page = await at(token);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(NOTIFY_OFF_PAGE.body);
    expect(html).toContain(`action="/mail/notify/off?t=`);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await emailOn(hz.A.ownerId)).toBe(true);

    const done = await at(token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain(NOTIFY_OFF_PAGE.done);
    expect(await emailOn(hz.A.ownerId)).toBe(false);
    // The push kinds are untouched, and nobody else changed.
    expect((await repos.preferences.get(hz.db, hz.A.ownerId)).notifications.decision).toBe(true);
    expect(await emailOn(hz.A.adminId)).toBe(true);
    // Again: still off, still fine.
    expect((await at(token, { method: "POST" })).status).toBe(200);
    expect(await emailOn(hz.A.ownerId)).toBe(false);
  });

  it("another secret, another person, a project's unsubscribe token or a broken one change nothing", async () => {
    const good = notifyOffToken(SECRET, hz.B.ownerId, "decision_waiting");
    const [v, , k, sig] = good.split(".");
    for (const t of [notifyOffToken("another-secret-0123456789abcdef-xyz", hz.B.ownerId, "decision_waiting"), [v, hz.B.adminId, k, sig].join("."), platformUnsubscribeToken(SECRET, hz.B.businessId, suppressionHashOfEmail("x@example.com")), "", "n1.x.y.z"]) {
      const res = await at(t, { method: "POST" });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(NOTIFY_OFF_PAGE.invalid);
    }
    expect(await emailOn(hz.B.ownerId)).toBe(true);
    expect(await emailOn(hz.B.adminId)).toBe(true);
  });

  it("an account that no longer exists is answered the same and nothing is written", async () => {
    const res = await at(notifyOffToken(SECRET, "00000000-0000-4000-8000-00000000dead", "decision_waiting"), { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("does not exist with the domain unset", async () => {
    const off = hz.build({ platformMail: { ...platformMail, domain: null } });
    const res = await off.app.fetch(new Request(`http://ingest.local/mail/notify/off?t=${encodeURIComponent(notifyOffToken(SECRET, hz.A.adminId, "decision_waiting"))}`, { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await emailOn(hz.A.adminId)).toBe(true);
  });
});
