/**
 * The same sender to an address (`ADDRESS_EMAIL_KINDS`, notify-address-email.ts: an invitation) and the person's own
 * kind `invitation_accepted` (notify-email.ts): the invitation itself, and the note to the inviter that someone joined.
 *   - the api only; the invitation's id and its token in: the address from the row, the token checked against the hash;
 *   - once per invitation; three a day per address, five emailed invitations a day per inviter, the address emails' own
 *     share of the ceiling, never the recipient account's own three a day; "Don't send me invitations" in the footer and
 *     the List-Unsubscribe header, and an address suppressed platform-wide is never mailed;
 *   - the note to the inviter that someone joined never uses up the inviter's own three a day;
 *   - no address in a log line, an event or the audit; nothing for a sample project; never simulated on staging.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformNotifyMock } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { APP_NAME } from "@foundmill/config";
import { DEV_PLATFORM_MAIL_SECRET, type PlatformMailConfig } from "../platform-mail";
import { ADDRESS_EMAIL_CEILING_SHARE, INVITATION_EMAILS_PER_INVITER_PER_DAY, NOTIFY_PER_PERSON_PER_DAY } from "@foundmill/shared";
import { readInvitationsOffToken, suppressionHashOfEmail } from "@foundmill/connectors";
import { NOTIFY_EMAIL_ROUTE, notifyPersonDayKey } from "../notify-email";
import { addressEmailCeiling, NOTIFY_ADDRESS_CEILING_KEY, notifyAddressDayKey, notifyInviterDayKey } from "../notify-address-email";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", notifyLocalPart: "hello", appUrl: "http://localhost:3000", ...over });
const token = () => randomBytes(32).toString("base64url");
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

describe("an invitation by email, and the inviter's note (gateway)", () => {
  let g: GatewayFixture;
  const mock = createPlatformNotifyMock();
  let n = 0;
  let inviter = "";

  beforeAll(async () => {
    g = await setupGateway({ connectors: [mock] });
    g.deps.appEnv = "test";
    inviter = await g.h.createUser("inviter@example.com");
    await repos.founders.upsert(g.db, inviter, { displayName: "Maya Lee" });
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: inviter, role: "owner", source: "invite" });
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
  });

  async function ask(body: Record<string, unknown>, svc: string | null = "api") {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
    const res = await fetch(`${g.server.url}${NOTIFY_EMAIL_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { sent?: boolean; simulated?: boolean; reason?: string; message?: string; error?: { code: string } } };
  }
  const invitation = async (role: "cofounder" | "collaborator" = "cofounder", email: string | null = `friend${++n}@example.com`) => {
    const t = token();
    const inv = await repos.invitations.create(g.db, g.businessId, { tokenHash: sha256(t), role, invitedByUserId: inviter, email, expiresAt: new Date(Date.now() + 14 * 86_400_000) });
    return { id: inv.id, token: t, email };
  };
  const sentTo = (email: string) => mock.sentFor(g.businessId).filter((m) => m.to === email);

  it("to the address the inviter typed, naming who and what, with its link; only with the token minted for it; once", async () => {
    const inv = await invitation();
    expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: token() } })).body.reason).toBe("not_pending");
    expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body).toMatchObject({ sent: true, simulated: true });
    const [mail, ...more] = sentTo(inv.email!);
    expect(more).toHaveLength(0);
    expect(mail!.from).toBe(`hello@${DOMAIN}`);
    expect(mail!.subject).toBe(`Maya Lee invited you to Gateway Test Club on ${APP_NAME}`);
    expect(mail!.text).toContain("Maya Lee invited you to join Gateway Test Club as a cofounder.");
    expect(mail!.text).toContain(`See the invitation: http://localhost:3000/i/${inv.token}`);
    expect(mail!.text).toMatch(/It works until [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    // "Don't send me invitations": the footer link and the one-click header, naming the address by its hash only.
    const off = /Don't send me invitations: (http:\/\/localhost:4005\/mail\/invitations\/off\?t=\S+)/.exec(mail!.text)?.[1];
    expect(off).toBeDefined();
    expect((mail!.body as { headers?: Record<string, string> }).headers).toEqual({ "List-Unsubscribe": `<${off}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(readInvitationsOffToken(DEV_PLATFORM_MAIL_SECRET, decodeURIComponent(new URL(off!).searchParams.get("t")!))).toEqual({ emailHash: suppressionHashOfEmail(inv.email!) });
    expect(off).not.toContain(encodeURIComponent(inv.email!));
    expect(mail!.text).toContain(`People on ${APP_NAME} can invite this address again`);
    expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body.reason).toBe("already_sent");
    const audit = (await repos.audit.list(g.db, g.businessId, { action: "gateway.notify.invitation_sent" })).items;
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toContain(inv.email!);
    // Only the api asks; an address-less or declined invitation is not mailed.
    expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } }, "orchestrator")).status).toBe(403);
    const none = await invitation("collaborator", null);
    expect((await ask({ kind: "invitation", data: { invitationId: none.id, token: none.token } })).body.reason).toBe("not_pending");
    const gone = await invitation();
    await repos.invitations.decline(g.db, gone.id);
    expect((await ask({ kind: "invitation", data: { invitationId: gone.id, token: gone.token } })).body.reason).toBe("not_pending");
  });

  it("never for a sample project, never simulated on staging", async () => {
    const inv = await invitation();
    await g.h.pg.query("update businesses set is_demo = true where id = $1", [g.businessId]);
    try {
      expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body.reason).toBe("sample");
    } finally {
      await g.h.pg.query("update businesses set is_demo = false where id = $1", [g.businessId]);
    }
    g.deps.appEnv = "staging";
    try {
      expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body.reason).toBe("unconfigured");
    } finally {
      g.deps.appEnv = "test";
    }
  });

  it("three a day per address; never the recipient account's own three a day", async () => {
    const a = await invitation();
    for (let i = 0; i < 3; i++) await g.rateLimits.hit(notifyAddressDayKey(DEV_PLATFORM_MAIL_SECRET, a.email!), 86_400_000, Date.now());
    expect((await ask({ kind: "invitation", data: { invitationId: a.id, token: a.token } })).body.reason).toBe("per_address");
    expect(sentTo(a.email!)).toHaveLength(0);
    // The address is someone's account whose own three a day are used up: the invitation still goes, and takes none of them.
    const b = await invitation();
    const account = await g.h.createUser(b.email!);
    for (let i = 0; i < NOTIFY_PER_PERSON_PER_DAY; i++) await g.rateLimits.hit(notifyPersonDayKey(account), 86_400_000, Date.now());
    const before = await g.rateLimits.count!(notifyPersonDayKey(account), 86_400_000, Date.now());
    expect((await ask({ kind: "invitation", data: { invitationId: b.id, token: b.token } })).body).toMatchObject({ sent: true });
    expect(await g.rateLimits.count!(notifyPersonDayKey(account), 86_400_000, Date.now())).toBe(before);
  });

  it("five emailed invitations a day per inviter, then the link is copied instead", async () => {
    const other = await g.h.createUser(`busy-inviter${++n}@example.com`);
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: other, role: "owner", source: "invite" });
    const make = async () => {
      const t = token();
      const inv = await repos.invitations.create(g.db, g.businessId, { tokenHash: sha256(t), role: "collaborator", invitedByUserId: other, email: `from-busy${++n}@example.com`, expiresAt: new Date(Date.now() + 86_400_000) });
      return { id: inv.id, token: t };
    };
    expect(INVITATION_EMAILS_PER_INVITER_PER_DAY).toBe(5);
    for (let i = 0; i < INVITATION_EMAILS_PER_INVITER_PER_DAY; i++) {
      const inv = await make();
      expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body).toMatchObject({ sent: true });
    }
    const sixth = await make();
    expect((await ask({ kind: "invitation", data: { invitationId: sixth.id, token: sixth.token } })).body.reason).toBe("per_inviter");
    // Another inviter is not held up by it.
    const mine = await invitation();
    expect((await ask({ kind: "invitation", data: { invitationId: mine.id, token: mine.token } })).body).toMatchObject({ sent: true });
    expect(await g.rateLimits.count!(notifyInviterDayKey(other), 86_400_000, Date.now())).toBe(INVITATION_EMAILS_PER_INVITER_PER_DAY);
  });

  it("the address emails have their own share of the day's ceiling, so people's own emails keep theirs", async () => {
    expect(ADDRESS_EMAIL_CEILING_SHARE).toBe(0.1);
    g.deps.platformMail = config({ notifyCeiling: 40 });
    expect(addressEmailCeiling(40)).toBe(4);
    const used = await g.rateLimits.count!(NOTIFY_ADDRESS_CEILING_KEY, 86_400_000, Date.now());
    for (let i = used; i < 4; i++) await g.rateLimits.hit(NOTIFY_ADDRESS_CEILING_KEY, 86_400_000, Date.now());
    const inv = await invitation();
    expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body.reason).toBe("address_ceiling");
    expect(sentTo(inv.email!)).toHaveLength(0);
  });

  it("an address that pressed \"Don't send me invitations\" (a platform-wide suppression) is never mailed", async () => {
    const inv = await invitation();
    await repos.channels.suppressEverywhere(g.db, { emailHash: suppressionHashOfEmail(inv.email!), reason: "asked for no invitations", source: "invitation_link" });
    expect((await ask({ kind: "invitation", data: { invitationId: inv.id, token: inv.token } })).body.reason).toBe("suppressed");
    expect(sentTo(inv.email!)).toHaveLength(0);
  });

  it("invitation_accepted: the inviter, about the invitation they made, by the joiner's name, with the way to turn it off", async () => {
    const owner = await g.h.createUser(`owner${++n}@example.com`);
    await repos.founders.upsert(g.db, owner, { displayName: "Sam" });
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: owner, role: "owner", source: "invite" });
    const joiner = await g.h.createUser(`joiner${n}@example.com`);
    await repos.founders.upsert(g.db, joiner, { displayName: "Ida Moss" });
    const inv = await repos.invitations.create(g.db, g.businessId, { tokenHash: sha256(token()), role: "collaborator", invitedByUserId: owner, email: null, expiresAt: new Date(Date.now() + 86_400_000) });
    const about = { userId: owner, kind: "invitation_accepted", businessId: g.businessId, data: { invitationId: inv.id } };
    expect((await ask(about)).body.reason).toBe("not_waiting");
    await repos.invitations.accept(g.db, inv.id, joiner);
    // Someone else is not told about it.
    expect((await ask({ ...about, userId: joiner })).body.reason).toBe("not_member");
    expect((await ask(about)).body).toMatchObject({ sent: true });
    const [mail] = mock.sentFor(g.businessId).filter((m) => m.to === `owner${n}@example.com`);
    expect(mail!.subject).toBe("Ida Moss joined Gateway Test Club");
    expect(mail!.text).toContain("Ida Moss accepted your invitation and joined Gateway Test Club as a collaborator.");
    expect(mail!.text).toContain("Turn these emails off: http://localhost:4005/mail/notify/off?t=");
    expect((await ask(about)).body.reason).toBe("already_sent");
  });

  it("invitation_accepted never uses up the inviter's own three a day", async () => {
    const owner = await g.h.createUser(`full-owner${++n}@example.com`);
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: owner, role: "owner", source: "invite" });
    const joiner = await g.h.createUser(`full-joiner${n}@example.com`);
    const inv = await repos.invitations.create(g.db, g.businessId, { tokenHash: sha256(token()), role: "collaborator", invitedByUserId: owner, email: null, expiresAt: new Date(Date.now() + 86_400_000) });
    await repos.invitations.accept(g.db, inv.id, joiner);
    for (let i = 0; i < NOTIFY_PER_PERSON_PER_DAY; i++) await g.rateLimits.hit(notifyPersonDayKey(owner), 86_400_000, Date.now());
    expect((await ask({ userId: owner, kind: "invitation_accepted", businessId: g.businessId, data: { invitationId: inv.id } })).body).toMatchObject({ sent: true });
    expect(await g.rateLimits.count!(notifyPersonDayKey(owner), 86_400_000, Date.now())).toBe(NOTIFY_PER_PERSON_PER_DAY);
  });
});
