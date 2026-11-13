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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatformNotifyMock, suppressionHashOfEmail } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { APP_NAME } from "@foundmill/config";
import { EMAIL_NOTIFICATION_KINDS, FOUNDER_NOTICE_LIMITS, loadEnv, NOTIFY_PER_PERSON_PER_DAY, NOTIFY_PER_PROJECT_PER_DAY, SUPPRESSION_REASON_BOUNCED } from "@foundmill/shared";
import type { PlatformMailConfig } from "../platform-mail";
import { PLATFORM_MAIL_CEILING_KEY, platformMailConfig } from "../platform-mail";
import { founderNoticeDayKey, founderNoticeEssentialKey, founderNoticeEssentialMoreKey, founderNoticeHourKey, founderNoticeProjectKey, PLATFORM_SAFETY_CEILING_KEY, PLATFORM_SAFETY_RESERVED_KEY } from "../notify-founder-notice";
import { NOTIFY_EMAIL_ROUTE, notifyPersonDayKey, notifyProjectDayKey, PLATFORM_NOTIFY_CEILING_KEY } from "../notify-email";
import { signServiceToken } from "../tokens";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { setupGateway, silentLog, TEST_SECRET, type GatewayFixture } from "./harness";

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
    const ids = await Promise.all(["ana", "ben", "cara", "dan", "outsider"].map((w) => g.h.createUser(addr(w))));
    [ana, ben, cara, dan, outsider] = [ids[0]!, ids[1]!, ids[2]!, ids[3]!, ids[4]!];
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
    const shared = await g.rateLimits.count!(PLATFORM_NOTIFY_CEILING_KEY, DAY, Date.now());
    expect((await notice(cara, e.id)).body).toMatchObject({ sent: true });
    // Counted on its own ceiling, never on the one every other email to people shares.
    expect(await g.rateLimits.count!(PLATFORM_NOTIFY_CEILING_KEY, DAY, Date.now())).toBe(shared);
    expect(await g.rateLimits.count!(PLATFORM_SAFETY_CEILING_KEY, DAY, Date.now())).toBeGreaterThanOrEqual(1);
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
    expect(await repos.founderDepartures.formerFounderFor(g.db, g.businessId, dan, request.createdAt)).not.toBeNull();
    const t = token();
    await repos.founderCancelLinks.create(g.db, { businessId: g.businessId, userId: dan, requestId: request.id, tokenHash: sha256(t), expiresAt: new Date(scheduledFor) });
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
    // The one who asked gets the receipt: what and when, and what to do if it was not them; nobody else is named.
    expect((await notice(ana, request.id)).body).toMatchObject({ sent: true });
    const receipt = last("ana");
    expect(receipt.subject).toBe("You asked to delete Gateway Test Club");
    expect(receipt.text).toMatch(/You asked to delete Gateway Test Club on [A-Z][a-z]{2} \d{1,2}, \d{4} at .+\. It will be deleted on [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    expect(receipt.text).toContain("If this wasn't you, cancel in Settings › Danger zone and secure your account.");
    expect(receipt.text).not.toMatch(/\b(?:Ben|Cara|Dan)\b|founders? (?:were|was) told|\balone\b|on your own/);
  });

  it("anyone ever taken out hears about the deletion: 20 days before it with nothing lost, 31 days before too; an old entry is not sent", async () => {
    const [eve, fay] = [await g.h.createUser(addr("eve")), await g.h.createUser(addr("fay"))];
    await g.h.db.insert(s.memberships).values([
      { businessId: g.businessId, userId: eve, role: "cofounder", source: "invite" },
      { businessId: g.businessId, userId: fay, role: "cofounder", source: "invite" },
    ]);
    await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, eve));
    await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, fay));
    await g.h.pg.query("update founder_departures set departed_at = now() - interval '31 days' where user_id = $1", [eve]);
    await g.h.pg.query("update founder_departures set departed_at = now() - interval '20 days' where user_id = $1", [fay]);
    const request = await entry(cara, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    // Taken out 31 days before the request: still told (third review), without the cancel (that stays at 30 days).
    expect((await notice(eve, request.id)).body).toMatchObject({ sent: true });
    expect(last("eve").text).toContain("If you want it kept, ask one of the founders to cancel it.");
    expect((await notice(fay, request.id)).body).toMatchObject({ sent: true });
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

  it("one person hears about one project at most so often: past it, one email says more changed, the rest are folded", async () => {
    const gus = await g.h.createUser(addr("gus"));
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: gus, role: "cofounder", source: "invite" });
    const before = sentTo("gus").length;
    for (let i = 0; i < FOUNDER_NOTICE_LIMITS.perRecipientHour; i++) {
      const e = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "member", sections: [] });
      expect((await notice(gus, e.id)).body, `notice ${i + 1}`).toMatchObject({ sent: true });
    }
    const over = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "member", sections: [] });
    expect((await notice(gus, over.id)).body).toMatchObject({ sent: true });
    const more = last("gus");
    expect(more.subject).toBe("More changes in Gateway Test Club");
    expect(more.text).toContain("than we email about one by one");
    const folded = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "member", sections: [] });
    expect((await notice(gus, folded.id)).body.reason).toBe("folded");
    expect(sentTo("gus").length - before).toBe(FOUNDER_NOTICE_LIMITS.perRecipientHour + 1);
    // Recorded, never silently dropped.
    const skipped = (await g.h.pg.query<{ status: string; skip_reason: string }>("select status, skip_reason from founder_notifications where user_id = $1 and dedupe_key = $2", [gus, `founder_notice:${folded.id}`])).rows;
    expect(skipped).toEqual([{ status: "skipped", skip_reason: "folded" }]);
    // The day's share holds the same way, for each project on its own.
    expect(await g.rateLimits.count!(founderNoticeHourKey(gus, g.businessId), 3_600_000, Date.now())).toBe(FOUNDER_NOTICE_LIMITS.perRecipientHour + 1);
    expect(await g.rateLimits.count!(founderNoticeDayKey(gus, g.businessId), DAY, Date.now())).toBe(FOUNDER_NOTICE_LIMITS.perRecipientHour + 1);
  });

  it("their own daily ceiling is enforced", async () => {
    const e = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "member", sections: [] });
    g.deps.platformMail = config({ safetyCeiling: 1 });
    await g.rateLimits.hit(PLATFORM_SAFETY_CEILING_KEY, DAY, Date.now());
    expect((await notice(ben, e.id)).body.reason).toBe("safety_ceiling");
  });

  it("a cap per project under the platform's ceiling; an essential notice is never refused at either and never folded", async () => {
    // Gus is past the hour's share and has had the More changes email (above). Fill the project's cap.
    for (let i = 0; i < FOUNDER_NOTICE_LIMITS.perProjectDay; i++) await g.rateLimits.hit(founderNoticeProjectKey(g.businessId), DAY, Date.now());
    const harmless = await entry(ana, "team.humans.role", { userId: ben, fromRole: "cofounder", role: "member", sections: [] });
    const gus = (await g.h.pg.query<{ id: string }>("select id from auth.users where email = $1", [addr("gus")])).rows[0]!.id;
    expect((await notice(gus, harmless.id)).body.reason).toBe("project_ceiling");
    // And the platform's ceiling full as well.
    g.deps.platformMail = config({ safetyCeiling: 1 });
    expect((await notice(gus, harmless.id)).body.reason).toBe("safety_ceiling");
    // Gus is lowered, then removed: his removal's email goes, in full, past every ceiling and the hour's share.
    await g.h.asUser(ana).run((tx) => repos.memberships.setRole(tx, g.businessId, gus, "member"));
    await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, gus));
    const removed = await entry(ana, "team.humans.remove", { userId: gus, role: "member", formerRole: "cofounder" });
    const reserved = await g.rateLimits.count!(PLATFORM_SAFETY_RESERVED_KEY, DAY, Date.now());
    expect((await notice(gus, removed.id)).body).toMatchObject({ sent: true });
    expect(last("gus").subject).toBe("You were removed from Gateway Test Club");
    // Then the deletion request, with the cancel: in full as well.
    const request = await entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    const t = token();
    await repos.founderCancelLinks.create(g.db, { businessId: g.businessId, userId: gus, requestId: request.id, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 7 * DAY) });
    expect((await notice(gus, request.id, t)).body).toMatchObject({ sent: true });
    expect(last("gus").subject).toBe("Ana Ruiz asked to delete Gateway Test Club");
    expect(last("gus").text).toContain(`/a/${t}`);
    // Counted on their reserved path, not on the ceilings.
    expect(await g.rateLimits.count!(PLATFORM_SAFETY_RESERVED_KEY, DAY, Date.now())).toBe(reserved + 2);
    await entry(ana, "business.cancel_deletion", {});
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

  it("a deletion request is essential for the founders and the one who asked: a full ordinary ceiling holds back only the ordinary emails", async () => {
    const kai = await g.h.createUser(addr("kai"));
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: kai, role: "cofounder", source: "invite" });
    await g.rateLimits.hit(PLATFORM_SAFETY_CEILING_KEY, DAY, Date.now());
    g.deps.platformMail = config({ safetyCeiling: 1 });
    const request = await entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await notice(kai, request.id)).body).toMatchObject({ sent: true });
    expect(last("kai").subject).toBe("Ana Ruiz asked to delete Gateway Test Club");
    expect((await notice(ana, request.id)).body).toMatchObject({ sent: true });
    expect(last("ana").subject).toBe("You asked to delete Gateway Test Club");
    // Eve was taken out 31 days before any of these requests: told on the ordinary path, so the full ceiling holds it.
    const eve = (await g.h.pg.query<{ id: string }>("select id from auth.users where email = $1", [addr("eve")])).rows[0]!.id;
    expect((await notice(eve, request.id)).body.reason).toBe("safety_ceiling");
    // And the cancel, to anyone, is ordinary too.
    const canceled = await entry(ana, "business.cancel_deletion", {});
    expect((await notice(kai, canceled.id)).body.reason).toBe("safety_ceiling");
  });

  it("past the essential share, a deletion request still goes in full, to a founder and to someone taken out; an earlier fold never uses it up", async () => {
    const vee = await g.h.createUser(addr("vee"));
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: vee, role: "cofounder", source: "invite" });
    const request = () => entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    const before = sentTo("vee").length;
    // A cofounder asks and cancels over and over: Vee, a founder, hears each request in full up to the share.
    for (let i = 0; i < FOUNDER_NOTICE_LIMITS.essentialPerRecipientDay; i++) {
      expect((await notice(vee, (await request()).id)).body, `request ${i + 1}`).toMatchObject({ sent: true });
      await entry(ana, "business.cancel_deletion", {});
    }
    // Past the share, an 11th request that waits: still in full, as a founder (verification of the final review, P2).
    const eleventh = await request();
    expect((await notice(vee, eleventh.id)).body).toMatchObject({ sent: true, offersCancel: false });
    expect(last("vee").subject).toBe("Ana Ruiz asked to delete Gateway Test Club");
    await entry(ana, "business.cancel_deletion", {});
    // Something else essential with no deletion Vee may cancel (her own removal): one fold for none, then recorded.
    await g.h.asUser(ana).run((tx) => repos.memberships.setRole(tx, g.businessId, vee, "member"));
    await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, vee));
    expect((await notice(vee, (await entry(ana, "team.humans.remove", { userId: vee, role: "member", formerRole: "cofounder" })).id)).body).toMatchObject({ sent: true, offersCancel: false });
    expect(last("vee").subject).toBe("More changes to who runs your projects");
    expect(last("vee").text).not.toContain("/a/");
    const folded = await entry(ana, "team.humans.remove", { userId: vee, role: "member", formerRole: "cofounder" });
    expect((await notice(vee, folded.id)).body.reason).toBe("folded");
    expect((await g.h.pg.query<{ skip_reason: string }>("select skip_reason from founder_notifications where user_id = $1 and dedupe_key = $2", [vee, `founder_notice:${folded.id}`])).rows).toEqual([{ skip_reason: "folded" }]);
    // Then the real request comes: its email, with its cancel, still goes, in full.
    const real = await request();
    const t = token();
    await repos.founderCancelLinks.create(g.db, { businessId: g.businessId, userId: vee, requestId: real.id, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 7 * DAY) });
    expect((await notice(vee, real.id, t)).body).toMatchObject({ sent: true, offersCancel: true });
    expect(last("vee").subject).toBe("Ana Ruiz asked to delete Gateway Test Club");
    expect(last("vee").text).toContain(`Cancel the deletion: http://localhost:3000/a/${t}`);
    expect(sentTo("vee").length - before).toBe(FOUNDER_NOTICE_LIMITS.essentialPerRecipientDay + 3);
    // The marker lasts until the end of the UTC day, and is keyed on the request.
    const day = Math.floor(Date.now() / DAY) * DAY;
    const marked = (key: string, at: number) => (g.rateLimits as unknown as { marked(key: string, now: number): boolean }).marked(key, at);
    expect(marked(founderNoticeEssentialMoreKey(vee, real.id, Date.now()), day + DAY - 1)).toBe(true);
    expect(marked(founderNoticeEssentialMoreKey(vee, real.id, Date.now()), day + DAY)).toBe(false);
    await entry(ana, "business.cancel_deletion", {});
  });

  it("past the share, a fold carries a link minted for the latest deletion they may cancel; when the link cannot be made, that deletion's own email still goes", async () => {
    const X = await createBusinessFixture(g.h, "gw-fold-x");
    const [wes, xia] = [await g.h.createUser(addr("wes")), await g.h.createUser(addr("xia"))];
    await g.h.db.insert(s.memberships).values([wes, xia].flatMap((userId) => [
      { businessId: g.businessId, userId, role: "cofounder" as const, source: "invite" as const },
      { businessId: X.businessId, userId, role: "cofounder" as const, source: "invite" as const },
    ]));
    for (const who of [wes, xia]) {
      for (let i = 0; i < FOUNDER_NOTICE_LIMITS.essentialPerRecipientDay; i++) await g.rateLimits.hit(founderNoticeEssentialKey(who), DAY, Date.now());
      await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, who));
    }
    const waiting = await entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    const removedFromX = (who: string) => repos.audit.append(g.db, X.businessId, { actorKind: "user", actorId: X.ownerId, action: "team.humans.remove", target: { kind: "business", id: X.businessId }, details: { userId: who, role: "member", formerRole: "cofounder" } });
    const askX = async (who: string) => (await ask({ userId: who, kind: "founder_notice", businessId: X.businessId, data: { auditId: (await removedFromX(who)).id } })).body;
    // Wes: the removal from X becomes the fold, with a link minted for the deletion that waits in the other project.
    expect(await askX(wes)).toMatchObject({ sent: true, offersCancel: true });
    const fold = mock.sentFor(X.businessId).filter((m) => m.to === addr("wes")).at(-1)!;
    expect(fold.subject).toBe("More changes to who runs your projects");
    const minted = /\/a\/([A-Za-z0-9_-]{43})/.exec(fold.text)?.[1];
    expect(await repos.founderCancelLinks.byTokenHash(g.db, sha256(minted!))).toMatchObject({ userId: wes, requestId: waiting.id, businessId: g.businessId });
    // Xia: the link cannot be made, so the fold stands for none, and the deletion's own email, with its link, goes.
    const create = vi.spyOn(repos.founderCancelLinks, "create").mockRejectedValueOnce(new Error("down"));
    try {
      expect(await askX(xia)).toMatchObject({ sent: true, offersCancel: false });
    } finally {
      create.mockRestore();
    }
    const t = token();
    await repos.founderCancelLinks.create(g.db, { businessId: g.businessId, userId: xia, requestId: waiting.id, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 7 * DAY) });
    expect((await notice(xia, waiting.id, t)).body).toMatchObject({ sent: true, offersCancel: true });
    expect(last("xia").text).toContain(`/a/${t}`);
    await entry(ana, "business.cancel_deletion", {});
  });

  it("the reserved circuit breaker: a warning at half, an error at the ceiling; past it 3 of a person's own a day, one fold, the rest recorded; a hard stop at twice it", async () => {
    const logged: { level: string; msg: string }[] = [];
    g.deps.log = { ...silentLog, warn: (_o: unknown, msg?: string) => void logged.push({ level: "warn", msg: msg ?? "" }), error: (_o: unknown, msg?: string) => void logged.push({ level: "error", msg: msg ?? "" }) } as typeof silentLog;
    try {
      const jun = await g.h.createUser(addr("jun"));
      await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: jun, role: "cofounder", source: "invite" });
      const request = async () => entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
      const used = await g.rateLimits.count!(PLATFORM_SAFETY_RESERVED_KEY, DAY, Date.now());
      g.deps.platformMail = config({ safetyReservedCeiling: 2 * (used + 1) });
      expect((await notice(jun, (await request()).id)).body).toMatchObject({ sent: true });
      expect(logged).toEqual([{ level: "warn", msg: "essential founder notices: half of the reserved daily ceiling is used" }]);
      // A ceiling set so the next one reaches it, and the hard stop (twice it) far enough away.
      const ceiling = used + 2;
      g.deps.platformMail = config({ safetyReservedCeiling: ceiling });
      expect((await notice(jun, (await request()).id)).body).toMatchObject({ sent: true });
      expect(logged.at(-1)).toEqual({ level: "error", msg: "essential founder notices: the reserved daily ceiling is reached; past it each person gets one folded email for the day" });
      // Past it: 3 requests of Jun's own, in full; then one fold for the day; then recorded.
      for (let i = 0; i < FOUNDER_NOTICE_LIMITS.perRequestPastBreakerDay; i++) {
        expect((await notice(jun, (await request()).id)).body, `own ${i + 1}`).toMatchObject({ sent: true });
        expect(last("jun").subject).toBe("Ana Ruiz asked to delete Gateway Test Club");
      }
      expect((await notice(jun, (await request()).id)).body).toMatchObject({ sent: true });
      expect(last("jun").subject).toBe("More changes to who runs your projects");
      expect(last("jun").text).toContain("Open your projects: http://localhost:3000/");
      const past = await request();
      expect((await notice(jun, past.id)).body.reason).toBe("folded");
      expect((await g.h.pg.query<{ skip_reason: string }>("select skip_reason from founder_notifications where user_id = $1 and dedupe_key = $2", [jun, `founder_notice:${past.id}`])).rows).toEqual([{ skip_reason: "folded_reserved_ceiling" }]);
      expect(logged.at(-1)).toEqual({ level: "warn", msg: "essential founder notice folded: past the reserved daily ceiling" });
      // The hard stop: past twice the ceiling nothing more goes, whoever it is for; recorded and logged.
      const now = await g.rateLimits.count!(PLATFORM_SAFETY_RESERVED_KEY, DAY, Date.now());
      g.deps.platformMail = config({ safetyReservedCeiling: Math.floor(now / FOUNDER_NOTICE_LIMITS.reservedHardFactor) });
      const stopped = await request();
      expect((await notice(ana, stopped.id)).body.reason).toBe("reserved_hard_ceiling");
      expect((await g.h.pg.query<{ skip_reason: string }>("select skip_reason from founder_notifications where user_id = $1 and dedupe_key = $2", [ana, `founder_notice:${stopped.id}`])).rows).toEqual([{ skip_reason: "reserved_hard_ceiling" }]);
      expect(logged.at(-1)).toEqual({ level: "error", msg: "essential founder notice not sent: past the hard daily ceiling" });
      await entry(ana, "business.cancel_deletion", {});
    } finally {
      g.deps.log = silentLog;
    }
  });

  it("the ceilings: set means set, 0 included, in the gateway's config; the environment refuses 0 or an empty value in plain words", () => {
    const env = { APP_ENV: "test" as const, PLATFORM_MAIL_DOMAIN: DOMAIN, PLATFORM_MAIL_DAILY_CAP: 50, PLATFORM_MAIL_DAILY_CEILING: 2_000, INGEST_URL: "http://localhost:4005" };
    expect(platformMailConfig({ ...env, PLATFORM_SAFETY_DAILY_CEILING: 0, PLATFORM_SAFETY_RESERVED_DAILY_CEILING: 0 })).toMatchObject({ safetyCeiling: 0, safetyReservedCeiling: 0 });
    expect(platformMailConfig(env).safetyCeiling).toBeUndefined();
    expect(loadEnv({}).PLATFORM_SAFETY_RESERVED_DAILY_CEILING).toBe(FOUNDER_NOTICE_LIMITS.reservedCeilingDefault);
    expect(() => loadEnv({ PLATFORM_SAFETY_DAILY_CEILING: "0" })).toThrow(/PLATFORM_SAFETY_DAILY_CEILING must be 1 or more/);
    expect(() => loadEnv({ PLATFORM_SAFETY_RESERVED_DAILY_CEILING: "" })).toThrow(/PLATFORM_SAFETY_RESERVED_DAILY_CEILING must be 1 or more/);
  });

  it("a deletion reaches every former founder for it, however many were taken out after them; beyond the window, the 50 most recent", async () => {
    const victim = await g.h.createUser(addr("victim"));
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: victim, role: "cofounder", source: "invite" });
    await g.h.asUser(ana).run((tx) => repos.memberships.setRole(tx, g.businessId, victim, "member"));
    // After the victim, 51 more are taken out (sock puppets, say).
    const later: string[] = [];
    for (let i = 0; i <= FOUNDER_NOTICE_LIMITS.formerPerRequest; i++) later.push(await g.h.createUser(`many-${i}@example.com`));
    await g.h.db.insert(s.memberships).values(later.map((userId) => ({ businessId: g.businessId, userId, role: "cofounder" as const, source: "invite" as const })));
    for (const userId of later) await g.h.asUser(ana).run((tx) => repos.memberships.remove(tx, g.businessId, userId));
    const request = await entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    const t = token();
    await repos.founderCancelLinks.create(g.db, { businessId: g.businessId, userId: victim, requestId: request.id, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 7 * DAY) });
    expect((await notice(victim, request.id, t)).body).toMatchObject({ sent: true, offersCancel: true });
    expect(last("victim").text).toContain(`/a/${t}`);
    await entry(ana, "business.cancel_deletion", {});
    // Taken out long before a request, the cap holds: of the 52 taken out more than 30 days before, the oldest is not one
    // of the 50 most recent, and is not emailed.
    await g.h.pg.query("update founder_departures set departed_at = now() - interval '100 days' where user_id = any($1::uuid[])", [later]);
    await g.h.pg.query("update founder_departures set departed_at = now() - interval '400 days' where user_id = $1", [later[0]]);
    // The newest of them stands clear of the ties at 100 days, so it is surely one of the 50.
    await g.h.pg.query("update founder_departures set departed_at = now() - interval '50 days' where user_id = $1", [later.at(-1)]);
    const again = await entry(ana, "business.request_deletion", { scheduledFor: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await notice(later[0]!, again.id)).body.reason).toBe("not_founder");
    // One of the 50 is emailed, on the ordinary path (the project's cap, filled above, is emptied for it first).
    await g.rateLimits.release!(founderNoticeProjectKey(g.businessId), DAY, Date.now(), FOUNDER_NOTICE_LIMITS.perProjectDay + 10);
    expect((await notice(later.at(-1)!, again.id)).body).toMatchObject({ sent: true });
    expect((await notice(victim, again.id)).body).toMatchObject({ sent: true });
    await entry(ana, "business.cancel_deletion", {});
  }, 120_000);
});
