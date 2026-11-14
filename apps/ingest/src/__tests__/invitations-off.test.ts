/**
 * `/mail/invitations/off` ("Don't send me invitations", the link in every invitation email): opening it asks; the
 * one-click POST (or the button) suppresses the address platform-wide, once, so every project's list sees it; a token
 * signed with another secret, a person's notify-off token or a project's unsubscribe token changes nothing; with the
 * domain unset the route does not exist.
 */
import { invitationsOffToken, notifyOffToken, platformUnsubscribeToken, suppressionHashOfEmail } from "@foundmill/connectors";
import { MOCK_SENDGRID_PUBLIC_KEY } from "@foundmill/connectors/connectors/sendgrid/fixtures/sendgrid";
import { repos } from "@foundmill/db";
import { INVITATIONS_OFF_PAGE } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIngestHarness, type IngestHarness } from "./harness";

const DOMAIN = "mail.foundmill.test";
const SECRET = "ingest-test-platform-mail-signing-secret";
const platformMail = { domain: DOMAIN, signingSecret: SECRET, inboundToken: "ingest-test-platform-inbound-token", eventPublicKey: MOCK_SENDGRID_PUBLIC_KEY };

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("invitations-off", { platformMail });
}, 120_000);
afterAll(() => hz?.close());

const at = (token: string, init?: RequestInit) => fetch(`${hz.base}/mail/invitations/off?t=${encodeURIComponent(token)}`, init);
const platformRows = async (emailHash: string) => (await repos.channels.listSuppression(hz.db, hz.A.businessId, { includePlatform: true })).filter((r) => r.scope === "platform" && r.emailHash === emailHash);

describe("/mail/invitations/off", () => {
  it("opening the link asks and changes nothing; the POST suppresses the address for every project, once", async () => {
    const hash = suppressionHashOfEmail("Invited@Example.com");
    const token = invitationsOffToken(SECRET, hash);
    const page = await at(token);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(INVITATIONS_OFF_PAGE.body);
    expect(html).toContain(`action="/mail/invitations/off?t=`);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await platformRows(hash)).toHaveLength(0);

    const done = await at(token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain(INVITATIONS_OFF_PAGE.done);
    const rows = await platformRows(hash);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: null, scope: "platform", source: "invitation_link" });
    // Every project's list sees it (the gateway's check before an invitation email, and a project's own mail).
    expect(await repos.channels.isSuppressed(hz.db, hz.A.businessId, { emailHash: hash })).toBe(true);
    expect(await repos.channels.isSuppressed(hz.db, hz.B.businessId, { emailHash: hash })).toBe(true);
    // Again: one row, still fine.
    expect((await at(token, { method: "POST" })).status).toBe(200);
    expect(await platformRows(hash)).toHaveLength(1);
  });

  it("another secret, another kind of token or a broken one change nothing", async () => {
    const hash = suppressionHashOfEmail("someone-else@example.com");
    for (const t of [invitationsOffToken("another-secret-0123456789abcdef-xyz", hash), notifyOffToken(SECRET, hz.B.ownerId, "decision_waiting"), platformUnsubscribeToken(SECRET, hz.B.businessId, hash), "", "i1.x.y", `i1.${"0".repeat(64)}.abc`]) {
      const res = await at(t, { method: "POST" });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(INVITATIONS_OFF_PAGE.invalid);
    }
    expect(await platformRows(hash)).toHaveLength(0);
  });

  it("does not exist with the domain unset", async () => {
    const hash = suppressionHashOfEmail("unset@example.com");
    const off = hz.build({ platformMail: { ...platformMail, domain: null } });
    const res = await off.app.fetch(new Request(`http://ingest.local/mail/invitations/off?t=${encodeURIComponent(invitationsOffToken(SECRET, hash))}`, { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await platformRows(hash)).toHaveLength(0);
  });
});
