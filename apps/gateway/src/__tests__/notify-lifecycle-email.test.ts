/**
 * The lifecycle emails, the gateway's part (WP-04 T11, T12): `POST /v1/notify/email` with `getting_started`,
 * `checkin` and, with no business, a kept card.
 *   - the gateway asks `dueLifecycle` itself from its own reads, so a stage that is not due (the page published, the
 *     person here) is refused, whatever the caller says;
 *   - the letters (the day-3 note, the check-ins) are signed by the team and carry Reply-To hey@foundmill.com (D6); the
 *     page check does not;
 *   - a lifecycle email is only one of a person's first two of the day;
 *   - an address suppressed platform-wide gets none;
 *   - the card email is the orchestrator's only, recorded with no business, once per stage.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformNotifyMock, suppressionHashOfEmail } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { LETTER_REPLY_TO, LETTER_SIGNATURE } from "@foundmill/shared";
import { NOTIFY_EMAIL_ROUTE, notifyPersonDayKey } from "../notify-email";
import type { PlatformMailConfig } from "../platform-mail";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const MIN = 60_000;
const DAY = 86_400_000;
const NOW = new Date("2026-11-25T15:00:00Z");
const NIL = "00000000-0000-0000-0000-000000000000";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", notifyLocalPart: "hello", appUrl: "http://localhost:3000", ...over });

describe("the lifecycle emails (gateway)", () => {
  let g: GatewayFixture;
  const mock = createPlatformNotifyMock();
  let n = 0;
  let clock = NOW;

  beforeAll(async () => {
    g = await setupGateway({ connectors: [mock], now: () => clock });
    g.deps.appEnv = "test";
    await g.h.pg.query("update businesses set committed_at = $1, time_zone = 'UTC' where id = $2", [new Date(NOW.getTime() - 120 * MIN).toISOString(), g.businessId]);
    await g.h.pg.query(`insert into project_pages (business_id, slug, draft) values ($1, 'gateway-test', '{"pitch":"Tutors by the hour","about":"x","forWhom":"","stage":"idea","showFounders":false}'::jsonb)`, [g.businessId]);
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
    clock = NOW;
  });

  /** An owner who left `leftMin` minutes ago. */
  async function founder(leftMin = 40) {
    n += 1;
    const userId = await g.h.createUser(`Life${n}@Example.com`);
    await repos.founders.upsert(g.db, userId, { displayName: `Ada ${n}` });
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId, role: "owner", source: "invite", sectionPermissions: {} });
    await repos.presence.ping(g.db, g.businessId, userId, { now: new Date(NOW.getTime() - leftMin * MIN) });
    return { userId, email: `life${n}@example.com` };
  }

  async function ask(body: Record<string, unknown>, svc = "orchestrator") {
    const res = await fetch(`${g.server.url}${NOTIFY_EMAIL_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { sent?: boolean; reason?: string } };
  }
  const sentTo = (email: string, businessId = g.businessId) => mock.sentFor(businessId).filter((m) => m.to === email);

  it("sends the page check once, from the usual address with no Reply-To, and records it under its key", async () => {
    const p = await founder();
    const body = { userId: p.userId, kind: "getting_started", businessId: g.businessId, data: { stage: "page_ready" } };
    expect((await ask(body)).body).toMatchObject({ sent: true, simulated: true });
    const [mail] = sentTo(p.email);
    expect(mail!.subject).toBe("Your page for Gateway Test Club is ready to check");
    expect(mail!.text).toContain(`Hi Ada, your page for Gateway Test Club is drafted from your own words.`);
    expect(mail!.body).not.toHaveProperty("replyTo");
    const rows = await repos.notifications.lifecycleHistory(g.db, g.businessId, [p.userId]);
    expect(rows.get(p.userId)!.map((r) => [r.dedupeKey, r.status])).toEqual([[`getting_started:page_ready:${g.businessId}`, "sent"]]);
    expect((await ask(body)).body).toMatchObject({ sent: false });
    expect(sentTo(p.email)).toHaveLength(1);
  });

  it("refuses a stage that is not due by its own read: the person is here, or asked too soon", async () => {
    const here = await founder(2);
    expect((await ask({ userId: here.userId, kind: "getting_started", businessId: g.businessId, data: { stage: "page_ready" } })).body).toMatchObject({ sent: false, reason: "not_waiting" });
    const soon = await founder(40);
    expect((await ask({ userId: soon.userId, kind: "getting_started", businessId: g.businessId, data: { stage: "ask_five" } })).body).toMatchObject({ sent: false, reason: "not_waiting" });
    // A stage of the other kind is refused before anything is read.
    expect((await ask({ userId: soon.userId, kind: "checkin", businessId: g.businessId, data: { stage: "page_ready" } })).status).toBe(400);
  });

  it("goes only to the people who run the project, never a collaborator", async () => {
    n += 1;
    const userId = await g.h.createUser(`Collab${n}@Example.com`);
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId, role: "collaborator", source: "invite", sectionPermissions: {} });
    expect((await ask({ userId, kind: "getting_started", businessId: g.businessId, data: { stage: "page_ready" } })).body).toMatchObject({ sent: false, reason: "not_member" });
  });

  it("is only one of a person's first two emails of the day", async () => {
    const p = await founder();
    await g.rateLimits.hit(notifyPersonDayKey(p.userId), DAY, NOW.getTime());
    await g.rateLimits.hit(notifyPersonDayKey(p.userId), DAY, NOW.getTime());
    expect((await ask({ userId: p.userId, kind: "getting_started", businessId: g.businessId, data: { stage: "page_ready" } })).body).toMatchObject({ sent: false, reason: "per_person" });
  });

  it("never goes to an address suppressed platform-wide", async () => {
    const p = await founder();
    await repos.channels.suppressEverywhere(g.db, { emailHash: suppressionHashOfEmail(p.email), reason: "bounce", source: "test" });
    expect((await ask({ userId: p.userId, kind: "getting_started", businessId: g.businessId, data: { stage: "page_ready" } })).body).toMatchObject({ sent: false, reason: "hard_suppressed" });
  });

  describe("a check-in letter", () => {
    it("goes signed by the team with Reply-To hey@foundmill.com, two weeks after the project's last visit", async () => {
      const b = await repos.businesses.create(g.db, { name: "Doorstep Bikes", businessMode: "assisted" });
      await g.h.pg.query("update businesses set committed_at = '2026-11-18T12:00:00Z', time_zone = 'UTC' where id = $1", [b.id]);
      n += 1;
      const userId = await g.h.createUser(`Quiet${n}@Example.com`);
      await repos.founders.upsert(g.db, userId, { displayName: `Sam ${n}` });
      await g.h.db.insert(s.memberships).values({ businessId: b.id, userId, role: "owner", source: "invite", sectionPermissions: {} });
      await repos.presence.ping(g.db, b.id, userId, { now: new Date("2026-11-18T13:00:00Z") });
      clock = new Date("2026-12-03T15:00:00Z");
      expect((await ask({ userId, kind: "checkin", businessId: b.id, data: { stage: "day_14" } })).body).toMatchObject({ sent: true });
      const [mail] = sentTo(`quiet${n}@example.com`, b.id);
      expect(mail!.subject).toBe("Doorstep Bikes is still here");
      expect((mail!.body as { from: { name: string } }).from.name).toBe(LETTER_SIGNATURE);
      expect((mail!.body as { replyTo: { email: string } }).replyTo).toEqual({ email: LETTER_REPLY_TO });
      expect(LETTER_REPLY_TO).toBe("hey@foundmill.com");
      expect(mail!.text).toContain(LETTER_SIGNATURE);
      expect(mail!.text).not.toContain("don't reach the team");
      // The next stage waits for its day.
      expect((await ask({ userId, kind: "checkin", businessId: b.id, data: { stage: "day_30" } })).body).toMatchObject({ sent: false, reason: "not_waiting" });
    });
  });

  describe("the card email (T12)", () => {
    async function cardHolder(keptMinAgo = 61) {
      n += 1;
      const userId = await g.h.createUser(`Card${n}@Example.com`);
      await repos.founders.upsert(g.db, userId, { displayName: `Lee ${n}` });
      await g.h.pg.query("insert into account_admissions (user_id, how) values ($1, 'open')", [userId]);
      const { rows } = await g.h.pg.query<{ id: string }>("insert into ideas (owner_user_id, title, created_at) values ($1, 'Tutorlane', $2) returning id", [userId, new Date(NOW.getTime() - keptMinAgo * MIN).toISOString()]);
      return { userId, email: `card${n}@example.com`, ideaId: rows[0]!.id };
    }

    it("is the orchestrator's only, recorded with no business, once per stage", async () => {
      const p = await cardHolder();
      const body = { userId: p.userId, kind: "getting_started", businessId: null, data: { ideaId: p.ideaId, stage: "card_saved" } };
      expect((await ask(body, "api")).status).toBe(403);
      expect((await ask(body)).body).toMatchObject({ sent: true, simulated: true });
      const [mail] = sentTo(p.email, NIL);
      expect(mail!.subject).toBe("Your card for Tutorlane is saved");
      expect(mail!.text).toMatch(new RegExp(`Start Tutorlane: http://localhost:3000/new/commit/${p.ideaId}\\?via=email\\n`));
      const rows = await g.h.pg.query<{ business_id: string | null; dedupe_key: string; status: string }>("select business_id, dedupe_key, status from founder_notifications where user_id = $1", [p.userId]);
      expect(rows.rows).toEqual([{ business_id: null, dedupe_key: `getting_started:card_saved:${p.ideaId}`, status: "sent" }]);
      expect((await ask(body)).body).toMatchObject({ sent: false });
      // The second one waits for its week.
      expect((await ask({ ...body, data: { ...body.data, stage: "card_week" } })).body).toMatchObject({ sent: false, reason: "not_waiting" });
    });

    it("is refused for a card that is not this person's, or a person who has a project", async () => {
      const p = await cardHolder();
      const other = await cardHolder();
      expect((await ask({ userId: p.userId, kind: "getting_started", businessId: null, data: { ideaId: other.ideaId, stage: "card_saved" } })).body).toMatchObject({ sent: false, reason: "not_pending" });
      await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId: other.userId, role: "owner", source: "invite", sectionPermissions: {} });
      expect((await ask({ userId: other.userId, kind: "getting_started", businessId: null, data: { ideaId: other.ideaId, stage: "card_saved" } })).body).toMatchObject({ sent: false, reason: "not_pending" });
    });

    it("honors the person's switch", async () => {
      const p = await cardHolder();
      await repos.preferences.update(g.db, p.userId, { email: { getting_started: false } });
      expect((await ask({ userId: p.userId, kind: "getting_started", businessId: null, data: { ideaId: p.ideaId, stage: "card_saved" } })).body).toMatchObject({ sent: false, reason: "turned_off" });
    });
  });
});
