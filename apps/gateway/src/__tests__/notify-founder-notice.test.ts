/**
 * The founder notices (`ACCOUNT_SAFETY_EMAIL_KINDS`, notify-founder-notice.ts; security review P2-3):
 *   - the api only, with the audit entry's id: the gateway reads which notice, who did it, when and about whom;
 *   - every founder now and the person it happened to, never the person who did it; for a deletion also a founder someone
 *     else demoted or removed in the last 7 days, who may carry the one-click cancel (the token checked against the
 *     departure's hash, for the request still waiting), with the token kept out of the stored copy;
 *   - nothing holds them back but a hard suppression: no email switch, no pause, no daily count, not the projects' room,
 *     not "Don't send me invitations"; no unsubscribe header; once per entry and person;
 *   - the reader's own account event `founder_notice.sent`, never the address in a log, an event or the audit.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformNotifyMock, suppressionHashOfEmail } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { APP_NAME } from "@foundmill/config";
import { EMAIL_NOTIFICATION_KINDS, NOTIFY_PER_PERSON_PER_DAY, NOTIFY_PER_PROJECT_PER_DAY, SUPPRESSION_REASON_BOUNCED } from "@foundmill/shared";
import type { PlatformMailConfig } from "../platform-mail";
import { PLATFORM_MAIL_CEILING_KEY } from "../platform-mail";
import { NOTIFY_EMAIL_ROUTE, notifyPersonDayKey, notifyProjectDayKey } from "../notify-email";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", notifyLocalPart: "hello", appUrl: "http://localhost:3000", ...over });
const token = () => randomBytes(32).toString("base64url");
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const DAY = 86_400_000;

describe("founder notices (gateway)", () => {
  let g: GatewayFixture;
  const mock = createPlatformNotifyMock();
  let ana = "";
  let ben = "";
  let cara = "";
  let dan = "";
  let outsider = "";
  const addr = (who: string) => `${who}@example.com`;

  beforeAll(async () => {
    g = await setupGateway({ connectors: [mock] });
    g.deps.appEnv = "test";
    [ana, ben, cara, dan, outsider] = await Promise.all(["ana", "ben", "cara", "dan", "outsider"].map((w) => g.h.createUser(addr(w))));
    await repos.founders.upsert(g.db, ana, { displayName: "Ana Ruiz" });
    await repos.founders.upsert(g.db, ben, { displayName: "Ben <b>Ode</b> https://evil.example" });
    await g.h.db.insert(s.memberships).values([
      { businessId: g.businessId, userId: ana, role: "owner", source: "invite" },
      { businessId: g.businessId, userId: ben, role: "cofounder", source: "invite" },
      { businessId: g.businessId, userId: cara, role: "cofounder", source: "invite" },
      { businessId: g.businessId, userId: dan, role: "cofounder", source: "invite" },
    ]);
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
  });

  async function ask(body: Record<string, unknown>, svc: string | null = "api") {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
    const res = await fetch(`${g.server.url}${NOTIFY_EMAIL_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { sent?: boolean; simulated?: boolean; reason?: string; eventId?: string | null } };
  }
  const notice = (userId: string, auditId: string, cancelToken?: string) => ask({ userId, kind: "founder_notice", businessId: g.businessId, data: { auditId, ...(cancelToken ? { cancelToken } : {}) } });
  const entry = (actorId: string, action: string, details: Record<string, unknown>) => repos.audit.append(g.db, g.businessId, { actorKind: "user", actorId, action, target: { kind: "business", id: g.businessId }, details });
  const sentTo = (who: string) => mock.sentFor(g.businessId).filter((m) => m.to === addr(who));
  const last = (who: string) => sentTo(who).at(-1)!;

  it("a founder's role lowered: the person it happened to and every other founder, never the one who did it", async () => {
    await g.h.asUser(ana).run((tx) => repos.memberships.setRole(tx, g.businessId, ben, "member"));
    const e = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "member", sections: [] });
    expect((await notice(ana, e.id)).body.reason).toBe("own_action");
    expect((await notice(outsider, e.id)).body.reason).toBe("not_founder");
    expect((await notice(ben, e.id)).body).toMatchObject({ sent: true, simulated: true });
    expect((await notice(cara, e.id)).body).toMatchObject({ sent: true, simulated: true });
    expect((await notice(cara, e.id)).body.reason).toBe("already_sent");
    expect(sentTo("ana")).toHaveLength(0);
    const toBen = last("ben");
    expect(toBen.subject).toBe("Your role in Gateway Test Club changed");
    expect(toBen.text).toContain("Ana Ruiz changed your role in Gateway Test Club from a cofounder to a member on ");
    expect(toBen.text).toMatch(/on [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM) UTC\./);
    const toCara = last("cara");
    // The name Ben gave himself is written by a person: no link and no markup reach the email.
    expect(toCara.subject).toMatch(/^Ana Ruiz changed Ben .*'s role in Gateway Test Club$/);
    expect(toCara.text).not.toContain("evil.example");
    expect(toCara.html).not.toContain("<b>");
    expect(toCara.text).toContain("a founder can change it back in Settings › People");
    expect(toCara.text).toContain("Open People: http://localhost:3000/b/");
    // No list to leave: no unsubscribe header, no off link, and the footer says why.
    for (const m of [toBen, toCara]) {
      expect((m.body as { headers?: unknown }).headers).toBeUndefined();
      expect((m.body as { categories: string[] }).categories).toContain("foundmill-account-safety");
      expect(m.text).not.toMatch(/Turn these emails off|Pause every email/);
      expect(m.text).toContain("always reach its founders, whatever your email settings say");
      expect(m.from).toBe(`hello@${DOMAIN}`);
    }
    // The reader's own account event; never the address anywhere.
    const events = (await g.h.pg.query<{ payload: Record<string, unknown> }>("select payload from account_events where user_id = $1 and type = 'founder_notice.sent'", [ben])).rows;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ notice: "role_changed", businessId: g.businessId, offersCancel: false, simulated: true });
    const audit = (await repos.audit.list(g.db, g.businessId, { action: "gateway.notify.founder_notice_sent" })).items;
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit) + JSON.stringify(events)).not.toContain(addr("ben"));
  });

  it("nothing but a hard suppression holds it: not the switches, the pause, the day's counts, the projects' room or no invitations", async () => {
    await repos.preferences.update(g.db, cara, { email: Object.fromEntries(EMAIL_NOTIFICATION_KINDS.map((k) => [k, false])) });
    await repos.emailPrefs.pauseEmails(g.db, cara);
    for (let i = 0; i < NOTIFY_PER_PERSON_PER_DAY; i++) await g.rateLimits.hit(notifyPersonDayKey(cara), DAY, Date.now());
    for (let i = 0; i < NOTIFY_PER_PROJECT_PER_DAY; i++) await g.rateLimits.hit(notifyProjectDayKey(cara, g.businessId), DAY, Date.now());
    for (let i = 0; i < 2_000; i++) await g.rateLimits.hit(PLATFORM_MAIL_CEILING_KEY, DAY, Date.now());
    await repos.channels.suppressEverywhere(g.db, { emailHash: suppressionHashOfEmail(addr("cara")), reason: "asked for no invitations", source: "invitation_link" });
    const e = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "viewer", sections: [] });
    expect((await notice(cara, e.id)).body).toMatchObject({ sent: true });
    // A bounce stops it.
    await repos.channels.addSuppression(g.db, g.businessId, { emailHash: suppressionHashOfEmail(addr("cara")), reason: SUPPRESSION_REASON_BOUNCED, scope: "business" });
    const again = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "viewer", sections: [] });
    expect((await notice(cara, again.id)).body.reason).toBe("hard_suppressed");
  });

  it("a removal, then a deletion: the removed founder gets the one-click cancel, kept out of the stored copy", async () => {
    // As the api does it: a founder is stepped down first, then removed; the entry names the founder's role they had.
    await g.h.asUser(ana).run((tx) => repos.memberships.setRole(tx, g.businessId, dan, "member"));
    await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, dan));
    const removed = await entry(ana, "team.humans.remove", { userId: dan, role: "member", formerRole: "cofounder" });
    expect((await notice(dan, removed.id)).body).toMatchObject({ sent: true });
    const out = last("dan");
    expect(out.subject).toBe("You were removed from Gateway Test Club");
    expect(out.text).toContain("Ana Ruiz removed you from Gateway Test Club on ");
    expect(out.text).toContain("You were a cofounder.");
    expect(out.text).toContain("To come back, one of the founders can send you a new invitation.");
    expect(out.text).not.toContain("/a/");

    const scheduledFor = new Date(Date.now() + 7 * DAY).toISOString();
    const request = await entry(ana, "business.request_deletion", { scheduledFor, requestedAt: new Date().toISOString() });
    const departure = (await repos.founderDepartures.formerFounder(g.db, g.businessId, dan))!;
    const t = token();
    await repos.founderDepartures.setCancelToken(g.db, departure.id, { tokenHash: sha256(t), requestId: request.id, expiresAt: new Date(scheduledFor) });
    // A token that is not Dan's own is not used.
    expect((await notice(dan, request.id, token())).body).toMatchObject({ sent: true });
    const without = last("dan");
    expect(without.text).toContain("ask one of the founders to cancel it");
    expect(without.text).not.toContain("/a/");
    await g.h.pg.query("delete from founder_notifications where user_id = $1 and dedupe_key = $2", [dan, `founder_notice:${request.id}`]);
    expect((await notice(dan, request.id, t)).body).toMatchObject({ sent: true });
    const withLink = last("dan");
    expect(withLink.subject).toBe("Ana Ruiz asked to delete Gateway Test Club");
    expect(withLink.text).toContain(`Cancel the deletion: http://localhost:3000/a/${t}`);
    expect(withLink.text).toContain("It does not give you your place back");
    const stored = (await g.h.pg.query<{ body_text: string; body_html: string; kind: string }>("select body_text, body_html, kind from founder_notifications where user_id = $1 and dedupe_key = $2", [dan, `founder_notice:${request.id}`])).rows;
    expect(stored[0]!.body_text).not.toContain(t);
    expect(stored[0]!.body_html).not.toContain(t);
    expect(stored[0]!.kind).toBe("founder_notice");
    // The founders still in it hear it too, with the way to the Danger zone; the one who asked does not.
    expect((await notice(cara, request.id)).body.reason).toBe("hard_suppressed");
    // Ben was demoted by a founder this week: he hears it as a former founder (no token was minted for him here).
    expect((await notice(ben, request.id)).body).toMatchObject({ sent: true });
    expect(last("ben").text).toContain("If you want it kept, ask one of the founders to cancel it.");
    expect((await notice(outsider, request.id)).body.reason).toBe("not_founder");
    expect((await notice(ana, request.id)).body.reason).toBe("own_action");
  });

  it("a former founder past the 7 days, or one who left on their own, is not told; an old entry is not sent", async () => {
    const eve = await g.h.createUser(addr("eve"));
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: eve, role: "cofounder", source: "invite" });
    await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, eve));
    await g.h.pg.query("update founder_departures set departed_at = now() - interval '8 days' where user_id = $1", [eve]);
    const request = await entry(cara, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await notice(eve, request.id)).body.reason).toBe("not_founder");
    const old = await entry(ana, "business.cancel_deletion", {});
    g.deps.now = () => new Date(Date.now() + 2 * DAY);
    try {
      expect((await notice(dan, old.id)).body.reason).toBe("too_old");
    } finally {
      g.deps.now = undefined;
    }
  });

  it("the cancel by a former founder: every founder hears who canceled and that it gave them nothing else", async () => {
    const canceled = await entry(dan, "business.cancel_deletion", { hadBeenScheduledFor: new Date(Date.now() + 7 * DAY).toISOString(), formerFounder: true });
    expect((await notice(ana, canceled.id)).body).toMatchObject({ sent: true });
    const toAna = last("ana");
    expect(toAna.subject).toMatch(/canceled the deletion of Gateway Test Club$/);
    expect(toAna.text).toMatch(/a founder of Gateway Test Club until [A-Z][a-z]{2} \d{1,2}, \d{4}, canceled the permanent deletion/);
    expect(toAna.text).toContain("Canceling gave them nothing else: they are still out of the project.");
    expect(toAna.text).toContain(`${APP_NAME}`);
    expect((await notice(dan, canceled.id)).body.reason).toBe("own_action");
  });

  it("the api only, ids only; a sample project is never emailed; never simulated on staging", async () => {
    const e = await entry(ana, "team.humans.remove", { userId: ben, role: "cofounder" });
    expect((await ask({ userId: cara, kind: "founder_notice", businessId: g.businessId, data: { auditId: e.id } }, "orchestrator")).status).toBe(403);
    expect((await ask({ userId: cara, kind: "founder_notice", businessId: g.businessId, data: { auditId: e.id, email: addr("x") } })).status).toBe(400);
    // An entry that is not a notice (a member's role change) sends nothing.
    const member = await entry(ana, "team.humans.role", { userId: ben, fromRole: "member", role: "viewer" });
    expect((await notice(dan, member.id)).body.reason).toBe("not_pending");
    await g.h.pg.query("update businesses set is_demo = true where id = $1", [g.businessId]);
    try {
      expect((await notice(ben, e.id)).body.reason).toBe("sample");
    } finally {
      await g.h.pg.query("update businesses set is_demo = false where id = $1", [g.businessId]);
    }
    g.deps.appEnv = "staging";
    try {
      expect((await notice(ben, e.id)).body.reason).toBe("unconfigured");
    } finally {
      g.deps.appEnv = "test";
    }
  });
});
