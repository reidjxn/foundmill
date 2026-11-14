/**
 * 0103 — showcase videos: `showcase_requests` (the house's), `showcase_consents` (the project's, one row per founder),
 * `businesses.showcase_may_ask` and `inbox_items.for_user_id`. The migration's header states the rules:
 *
 *   - house members read the house's requests (tenant RLS); the project cannot read them;
 *   - a founder reads their own consent row only, while they hold an owner's standing: the house cannot read consents,
 *     a cofounder cannot read another founder's row, a collaborator or any other member sees nothing;
 *   - no client role inserts, updates or deletes either table (the api writes them on the service connection);
 *   - a note for one person is nobody else's to read, change or delete; every other note reads as before.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
/** The house (asks) and a project with two founders and a collaborator. */
let house: BusinessFixture;
let project: BusinessFixture;
let cofounder: string;
let collaborator: string;
let requestId: string;
let ownerConsentId: string;
let cofounderConsentId: string;

const HASH = "a".repeat(64);
const preview = { slug: "showcase-project", projectName: "Showcase Project", brandPrimary: "#1b4fd8", brandSecondary: "#f5c400", shots: [], postText: "Showcase Project put its page live.", link: "https://foundmill.test/p/showcase-project/story?via=p.showcase-project", networks: ["instagram"], video: null } as const;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const RLS_DENIED = /permission denied|row-level security|violates row-level/;

beforeAll(async () => {
  h = await createTestDb();
  house = await createBusinessFixture(h, "showcase-house");
  project = await createBusinessFixture(h, "showcase-project");
  [cofounder, collaborator] = await Promise.all([h.createUser("showcase-cofounder@test.local"), h.createUser("showcase-collaborator@test.local")]);
  await h.db.insert(s.memberships).values([
    { businessId: project.businessId, userId: cofounder, role: "cofounder" },
    { businessId: project.businessId, userId: collaborator, role: "collaborator" },
  ]);
  const svc = h.service();
  const request = await svc.run((tx) => repos.showcase.createRequest(tx, { businessId: house.businessId, subjectBusinessId: project.businessId, preview: preview as never, previewHash: HASH, requestedByUserId: house.ownerId }));
  requestId = request.id;
  ownerConsentId = (await svc.run((tx) => repos.showcase.createConsent(tx, { businessId: project.businessId, requestId, userId: project.ownerId, preview: preview as never, previewHash: HASH, expiresAt: inDays(14) }))).id;
  cofounderConsentId = (await svc.run((tx) => repos.showcase.createConsent(tx, { businessId: project.businessId, requestId, userId: cofounder, preview: preview as never, previewHash: HASH, expiresAt: inDays(14) }))).id;
}, 120_000);
afterAll(() => h?.close());

const requestsAs = (userId: string) => h.asUser(userId).run((tx) => tx.select({ id: s.showcaseRequests.id }).from(s.showcaseRequests));
const consentsAs = (userId: string) => h.asUser(userId).run((tx) => tx.select({ id: s.showcaseConsents.id }).from(s.showcaseConsents));

describe("showcase_requests 0103: the house's, read by its members, written by the service only", () => {
  it("a house member reads the house's requests; the project's people read none", async () => {
    expect((await requestsAs(house.ownerId)).map((r) => r.id)).toEqual([requestId]);
    expect((await requestsAs(house.memberId)).map((r) => r.id)).toEqual([requestId]);
    for (const who of [project.ownerId, cofounder, collaborator, project.memberId]) expect(await requestsAs(who)).toEqual([]);
  });

  it("anon reads nothing", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.showcaseRequests))).rejects.toThrow(RLS_DENIED);
  });

  it("no client inserts, updates or deletes a request, the house's owner included", async () => {
    await expect(h.asUser(house.ownerId).run((tx) => tx.insert(s.showcaseRequests).values({ businessId: house.businessId, subjectBusinessId: project.businessId, preview: preview as never, previewHash: HASH }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(house.ownerId).run((tx) => tx.update(s.showcaseRequests).set({ state: "approved", approvedUntil: inDays(30) }).where(eq(s.showcaseRequests.id, requestId)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(house.ownerId).run((tx) => tx.delete(s.showcaseRequests).where(eq(s.showcaseRequests.id, requestId)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(project.ownerId).run((tx) => tx.update(s.showcaseRequests).set({ state: "declined", withdrawReason: "declined" }).where(eq(s.showcaseRequests.id, requestId)))).rejects.toThrow(RLS_DENIED);
    const [row] = await h.service().run((tx) => tx.select().from(s.showcaseRequests).where(eq(s.showcaseRequests.id, requestId)));
    expect(row).toMatchObject({ state: "asking", approvedUntil: null });
  });

  it("the database keeps one open request per project and a final state with its reason", async () => {
    const svc = h.service();
    await expect(svc.run((tx) => repos.showcase.createRequest(tx, { businessId: house.businessId, subjectBusinessId: project.businessId, preview: preview as never, previewHash: HASH }))).rejects.toThrow(/one_open/);
    await expect(svc.execute(sql`update showcase_requests set state = 'declined' where id = ${requestId}`)).rejects.toThrow(/final_reason/);
    await expect(svc.execute(sql`insert into showcase_requests (business_id, subject_business_id, preview, preview_hash) values (${house.businessId}, ${house.businessId}, '{}'::jsonb, ${HASH})`)).rejects.toThrow(/not_self/);
  });
});

describe("showcase_consents 0103: each founder reads their own row only", () => {
  it("the owner reads their own row and not the cofounder's; the cofounder reads theirs and not the owner's", async () => {
    expect((await consentsAs(project.ownerId)).map((r) => r.id)).toEqual([ownerConsentId]);
    expect((await consentsAs(cofounder)).map((r) => r.id)).toEqual([cofounderConsentId]);
  });

  it("the house reads no consent; a collaborator, a member, a viewer and another business read nothing", async () => {
    for (const who of [house.ownerId, house.memberId, collaborator, project.memberId, project.viewerId, project.adminId]) expect(await consentsAs(who)).toEqual([]);
    await expect(h.anon().run((tx) => tx.select().from(s.showcaseConsents))).rejects.toThrow(RLS_DENIED);
  });

  it("a founder who lost an owner's standing reads their old row no more", async () => {
    const former = await h.createUser("showcase-former@test.local");
    await h.db.insert(s.memberships).values({ businessId: project.businessId, userId: former, role: "cofounder" });
    const id = (await h.service().run((tx) => repos.showcase.createConsent(tx, { businessId: project.businessId, requestId, userId: former, preview: preview as never, previewHash: HASH, expiresAt: inDays(14) }))).id;
    expect((await consentsAs(former)).map((r) => r.id)).toEqual([id]);
    await h.db.update(s.memberships).set({ role: "member" }).where(sql`business_id = ${project.businessId} and user_id = ${former}`);
    expect(await consentsAs(former)).toEqual([]);
    await h.db.delete(s.showcaseConsents).where(eq(s.showcaseConsents.id, id));
  });

  it("no client inserts, answers, withdraws or deletes a consent, their own included", async () => {
    await expect(h.asUser(project.ownerId).run((tx) => tx.update(s.showcaseConsents).set({ answer: "yes", answeredAt: new Date() }).where(eq(s.showcaseConsents.id, ownerConsentId)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(project.ownerId).run((tx) => tx.update(s.showcaseConsents).set({ answer: "yes", answeredAt: new Date() }).where(eq(s.showcaseConsents.id, cofounderConsentId)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(project.ownerId).run((tx) => tx.insert(s.showcaseConsents).values({ businessId: project.businessId, requestId, userId: project.ownerId, preview: preview as never, previewHash: HASH, expiresAt: inDays(14) }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(project.ownerId).run((tx) => tx.delete(s.showcaseConsents).where(eq(s.showcaseConsents.id, ownerConsentId)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(house.ownerId).run((tx) => tx.update(s.showcaseConsents).set({ answer: "yes", answeredAt: new Date() }))).rejects.toThrow(RLS_DENIED);
    const rows = await h.service().run((tx) => tx.select({ answer: s.showcaseConsents.answer }).from(s.showcaseConsents).where(eq(s.showcaseConsents.requestId, requestId)));
    expect(rows.every((r) => r.answer === null)).toBe(true);
  });

  it("the service answers once and withdraws only a yes; the database keeps the answer with its time", async () => {
    const svc = h.service();
    await expect(svc.execute(sql`update showcase_consents set answer = 'yes' where id = ${ownerConsentId}`)).rejects.toThrow(/answered_when/);
    await expect(svc.execute(sql`update showcase_consents set withdrawn_at = now() where id = ${ownerConsentId}`)).rejects.toThrow(/withdrawn_yes/);
    expect(await svc.run((tx) => repos.showcase.withdraw(tx, ownerConsentId, new Date()))).toBe(false);
    expect(await svc.run((tx) => repos.showcase.answer(tx, ownerConsentId, "yes", new Date()))).toBe(true);
    expect(await svc.run((tx) => repos.showcase.answer(tx, ownerConsentId, "no", new Date()))).toBe(false);
    expect(await svc.run((tx) => repos.showcase.withdraw(tx, ownerConsentId, new Date()))).toBe(true);
  });
});

describe("businesses.showcase_may_ask and inbox_items.for_user_id 0103", () => {
  it("the setting starts unset (the config's default decides)", async () => {
    const [row] = await h.service().run((tx) => tx.select({ v: s.businesses.showcaseMayAsk }).from(s.businesses).where(eq(s.businesses.id, project.businessId)));
    expect(row!.v).toBeNull();
  });

  it("a note for one founder is theirs alone: the cofounder, a collaborator and the house read nothing of it, and nobody else changes it", async () => {
    const [note] = await h.db.insert(s.inboxItems).values({ businessId: project.businessId, type: "decision", subject: "For the owner only", forUserId: project.ownerId }).returning({ id: s.inboxItems.id });
    const read = (who: string) => h.asUser(who).run((tx) => tx.select({ id: s.inboxItems.id }).from(s.inboxItems).where(eq(s.inboxItems.id, note!.id)));
    expect(await read(project.ownerId)).toHaveLength(1);
    for (const who of [cofounder, collaborator, project.memberId, house.ownerId]) expect(await read(who)).toEqual([]);
    const changed = await h.asUser(cofounder).run((tx) => tx.update(s.inboxItems).set({ subject: "taken" }).where(eq(s.inboxItems.id, note!.id)).returning({ id: s.inboxItems.id }));
    expect(changed).toEqual([]);
    const gone = await h.asUser(project.memberId).run((tx) => tx.delete(s.inboxItems).where(eq(s.inboxItems.id, note!.id)).returning({ id: s.inboxItems.id }));
    expect(gone).toEqual([]);
    // Nobody writes a note addressed to someone else.
    await expect(h.asUser(project.memberId).run((tx) => tx.insert(s.inboxItems).values({ businessId: project.businessId, type: "decision", subject: "Spoofed", forUserId: project.ownerId }))).rejects.toThrow(RLS_DENIED);
    // A note for everyone reads as before.
    expect(await h.asUser(cofounder).run((tx) => tx.select({ id: s.inboxItems.id }).from(s.inboxItems).where(eq(s.inboxItems.id, project.inboxItemId)))).toHaveLength(1);
  });

  it("review finding 7: the privileged connection's Inbox reads leave out a note for one person unless that person is the viewer", async () => {
    const [note] = await h.db.insert(s.inboxItems).values({ businessId: project.businessId, type: "decision", subject: "Privileged read", forUserId: project.ownerId, blocksContinue: true }).returning({ id: s.inboxItems.id });
    const svc = h.service();
    // The orchestrator, the composer and the push notifier read with no viewer: nobody's own note.
    const noViewer = await svc.run((tx) => repos.inbox.list(tx, project.businessId, { tab: "respond", limit: 100 }));
    expect(noViewer.items.map((i) => i.id)).not.toContain(note!.id);
    // A viewer sees their own note and nobody else's.
    expect((await svc.run((tx) => repos.inbox.list(tx, project.businessId, { tab: "respond", limit: 100 }, project.ownerId))).items.map((i) => i.id)).toContain(note!.id);
    expect((await svc.run((tx) => repos.inbox.list(tx, project.businessId, { tab: "respond", limit: 100 }, cofounder))).items.map((i) => i.id)).not.toContain(note!.id);
    const before = await svc.run((tx) => repos.inbox.countByTab(tx, project.businessId));
    const mine = await svc.run((tx) => repos.inbox.countByTab(tx, project.businessId, project.ownerId));
    expect(mine.respond).toBeGreaterThan(before.respond);
    const blocking = await svc.run((tx) => repos.inbox.countBlocking(tx, project.businessId));
    await h.db.update(s.inboxItems).set({ forUserId: null }).where(eq(s.inboxItems.id, note!.id));
    expect(await svc.run((tx) => repos.inbox.countBlocking(tx, project.businessId))).toBe(blocking + 1);
    await h.db.delete(s.inboxItems).where(eq(s.inboxItems.id, note!.id));
  });

  it("the waiting-note email reads a note for one person only for that person", async () => {
    const [note] = await h.db.insert(s.inboxItems).values({ businessId: project.businessId, type: "decision", subject: "Only yours", forUserId: cofounder, decision: { kind: "showcase_consent", options: [] }, createdAt: new Date(Date.now() - 2 * 86_400_000) }).returning({ id: s.inboxItems.id });
    const svc = h.service();
    expect(await svc.run((tx) => repos.notifyEmail.stillWaiting(tx, project.businessId, note!.id, project.ownerId))).toBeNull();
    expect(await svc.run((tx) => repos.notifyEmail.stillWaiting(tx, project.businessId, note!.id, cofounder))).not.toBeNull();
    const waiting = await svc.run((tx) => repos.notifyEmail.waitingAnswers(tx, { olderThan: new Date(), since: new Date(Date.now() - 7 * 86_400_000) }));
    expect(waiting.filter((w) => w.inboxItemId === note!.id).map((w) => w.userId)).toEqual([cofounder]);
  });
});
