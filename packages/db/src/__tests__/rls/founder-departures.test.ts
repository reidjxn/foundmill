/**
 * 0094 — founder departures (security review P2-3). The migration's header states the rules:
 *
 *   - the trigger on `memberships` writes one row each time a membership loses a founder's standing: `demoted` (someone
 *     else lowered the role), `removed` (someone else deleted the row), `left` (the person's own change); never for a
 *     role that was not a founder's, never between owner and cofounder, never for an example membership, never while
 *     `fm_purge_business` removes the project or when the account goes;
 *   - the person reads their own rows, a founder of the project the project's, nobody else (another business's founders
 *     included), and no client role writes the table;
 *   - a former founder for a deletion request: someone else's change within 30 days before it or after it, not back as a
 *     founder; never a founder's own leaving;
 *   - `founder_cancel_links`: service role only (no client role reads or writes it, in any business); a link works once,
 *     before its end;
 *   - a member cannot write, change or delete a suppression entry with a hard reason;
 *   - `fm_account_event_types()` lists `founder_notice.sent`, and `founder_notifications` takes `founder_notice`;
 *   - a founder notice stops only for a bounce or a spam report (`isHardSuppressed`).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORMER_FOUNDER_LOOKBACK_MS, HARD_SUPPRESSION_REASONS } from "@foundmill/shared";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let cofounder: string;
let second: string;

const hex = () => createHash("sha256").update(randomBytes(16)).digest("hex");
const departuresOf = (businessId: string, userId: string) => h.service().run((tx) => tx.select().from(s.founderDepartures).where(and(eq(s.founderDepartures.businessId, businessId), eq(s.founderDepartures.userId, userId))));
const visible = { id: s.founderDepartures.id, userId: s.founderDepartures.userId, businessId: s.founderDepartures.businessId, how: s.founderDepartures.how };

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "depart-a");
  B = await createBusinessFixture(h, "depart-b");
  [cofounder, second] = await Promise.all([h.createUser("depart-cofounder@test.local"), h.createUser("depart-second@test.local")]);
  await h.db.insert(s.memberships).values([
    { businessId: A.businessId, userId: cofounder, role: "cofounder" },
    { businessId: A.businessId, userId: second, role: "cofounder" },
  ]);
}, 120_000);
afterAll(() => h?.close());

describe("the trigger on memberships", () => {
  it("a founder lowered by another founder is `demoted`, with the new role and who did it", async () => {
    await h.asUser(A.ownerId).run((tx) => repos.memberships.setRole(tx, A.businessId, cofounder, "member"));
    const [row] = await departuresOf(A.businessId, cofounder);
    expect(row).toMatchObject({ how: "demoted", priorRole: "cofounder", newRole: "member", byUserId: A.ownerId });
  });

  it("then removed: a second row, `removed`, with no role", async () => {
    await h.asUser(A.ownerId).run((tx) => repos.memberships.remove(tx, A.businessId, cofounder));
    const rows = await departuresOf(A.businessId, cofounder);
    expect(rows.map((r) => r.how).sort()).toEqual(["demoted"]);
    // A member's removal is not a founder's: the row above stays the only one.
    await h.asUser(A.ownerId).run((tx) => repos.memberships.add(tx, A.businessId, { userId: cofounder, role: "cofounder" }));
    await h.asUser(A.ownerId).run((tx) => repos.memberships.remove(tx, A.businessId, cofounder));
    const after = await departuresOf(A.businessId, cofounder);
    expect(after.map((r) => r.how).sort()).toEqual(["demoted", "removed"]);
    expect(after.find((r) => r.how === "removed")).toMatchObject({ priorRole: "cofounder", newRole: null, byUserId: A.ownerId });
  });

  it("nothing for a role that was not a founder's, nor between owner and cofounder", async () => {
    await h.asUser(A.ownerId).run((tx) => repos.memberships.setRole(tx, A.businessId, A.memberId, "viewer"));
    await h.asUser(A.ownerId).run((tx) => repos.memberships.setRole(tx, A.businessId, second, "owner"));
    await h.asUser(A.ownerId).run((tx) => repos.memberships.setRole(tx, A.businessId, second, "cofounder"));
    expect(await departuresOf(A.businessId, A.memberId)).toHaveLength(0);
    expect(await departuresOf(A.businessId, second)).toHaveLength(0);
    await h.asUser(A.ownerId).run((tx) => repos.memberships.setRole(tx, A.businessId, A.memberId, "member"));
  });

  it("a change made by the service counts as someone else's; a founder's own change is `left`", async () => {
    const solo = await h.createUser("depart-self@test.local");
    const other = await h.createUser("depart-service@test.local");
    await h.db.insert(s.memberships).values([
      { businessId: B.businessId, userId: solo, role: "cofounder" },
      { businessId: B.businessId, userId: other, role: "cofounder" },
    ]);
    await h.asUser(solo).run((tx) => tx.delete(s.memberships).where(and(eq(s.memberships.businessId, B.businessId), eq(s.memberships.userId, solo))));
    expect(await departuresOf(B.businessId, solo)).toMatchObject([{ how: "left", byUserId: solo }]);
    await h.service().run((tx) => tx.delete(s.memberships).where(and(eq(s.memberships.businessId, B.businessId), eq(s.memberships.userId, other))));
    expect(await departuresOf(B.businessId, other)).toMatchObject([{ how: "removed", byUserId: null }]);
    // A founder's own leaving never carries the right to cancel a deletion.
    expect((await repos.founderDepartures.formerFoundersFor(h.db, B.businessId, new Date())).map((r) => r.userId)).toEqual([other]);
  });

  it("nothing while the project is purged, nor when the account goes", async () => {
    const C = await createBusinessFixture(h, "depart-c");
    const leaving = await h.createUser("depart-account@test.local");
    await h.db.insert(s.memberships).values({ businessId: C.businessId, userId: leaving, role: "cofounder" });
    await h.db.execute(sql`delete from auth.users where id = ${leaving}::uuid`);
    expect(await departuresOf(C.businessId, leaving)).toHaveLength(0);
    expect(await repos.businesses.purge(h.db, C.businessId)).toBe(true);
    expect(await h.service().run((tx) => tx.select().from(s.founderDepartures).where(eq(s.founderDepartures.businessId, C.businessId)))).toHaveLength(0);
  });
});

describe("RLS: who reads a departure", () => {
  it("the person reads their own, a founder of the project the project's; a member, another business's founder and anon nothing", async () => {
    expect((await h.asUser(cofounder).run((tx) => tx.select(visible).from(s.founderDepartures))).every((r) => r.userId === cofounder)).toBe(true);
    expect(await h.asUser(cofounder).run((tx) => tx.select(visible).from(s.founderDepartures))).toHaveLength(2);
    expect((await h.asUser(second).run((tx) => tx.select(visible).from(s.founderDepartures).where(eq(s.founderDepartures.businessId, A.businessId)))).length).toBeGreaterThanOrEqual(2);
    expect(await h.asUser(A.memberId).run((tx) => tx.select(visible).from(s.founderDepartures))).toHaveLength(0);
    expect(await h.asUser(A.adminId).run((tx) => tx.select(visible).from(s.founderDepartures))).toHaveLength(0);
    // Cross-tenant: B's owner reads nothing of A's.
    expect(await h.asUser(B.ownerId).run((tx) => tx.select(visible).from(s.founderDepartures).where(eq(s.founderDepartures.businessId, A.businessId)))).toHaveLength(0);
    await expect(h.anon().run((tx) => tx.select(visible).from(s.founderDepartures))).rejects.toThrow(/permission denied/);
  });

  it("no client role writes", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.founderDepartures).values({ businessId: A.businessId, userId: A.memberId, priorRole: "owner", how: "removed" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.founderDepartures).set({ how: "left" }).where(eq(s.founderDepartures.userId, cofounder)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(cofounder).run((tx) => tx.delete(s.founderDepartures).where(eq(s.founderDepartures.userId, cofounder)))).rejects.toThrow(RLS_DENIED);
    // Nor can a founder plant a departure through the trigger's function.
    await expect(h.asUser(A.ownerId).run((tx) => tx.execute(sql`select fm_memberships_record_founder_departure()`))).rejects.toThrow();
  });
});

describe("the repo: former founders, counted from the request", () => {
  it("someone else's change within 30 days before a request or after it, not back as a founder", async () => {
    const now = new Date();
    const former = await repos.founderDepartures.formerFoundersFor(h.db, A.businessId, now);
    expect(former.map((r) => r.userId)).toEqual([cofounder]);
    expect(former[0]!.how).toBe("removed");
    // A request made more than 30 days after the departure: no longer one of its former founders.
    expect(await repos.founderDepartures.formerFoundersFor(h.db, A.businessId, new Date(now.getTime() + FORMER_FOUNDER_LOOKBACK_MS + 60_000))).toHaveLength(0);
    // A request made before the departure still counts it (the departure came after the request).
    expect((await repos.founderDepartures.formerFoundersFor(h.db, A.businessId, new Date(now.getTime() - 90 * 86_400_000))).map((r) => r.userId)).toEqual([cofounder]);
    // Back as a founder: no longer a former one.
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: cofounder, role: "cofounder" });
    expect(await repos.founderDepartures.formerFounderFor(h.db, A.businessId, cofounder, now)).toBeNull();
    await h.db.delete(s.memberships).where(and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, cofounder)));
    // That service delete is a new `removed` row; the person is a former founder again.
    expect((await repos.founderDepartures.formerFounderFor(h.db, A.businessId, cofounder, now))?.how).toBe("removed");
    // Their home reads it, with the project's name (on the service connection: they can no longer read the business row).
    const mine = await repos.founderDepartures.forUser(h.db, cofounder, new Date(now.getTime() - FORMER_FOUNDER_LOOKBACK_MS));
    expect(mine.map((r) => [r.businessId, r.businessName])).toEqual([[A.businessId, (await repos.businesses.get(h.db, A.businessId)).name]]);
  });
});

describe("founder_cancel_links", () => {
  it("one email's link: found by its hash, works once and before its end; a second link never replaces the first", async () => {
    const request = await repos.audit.append(h.db, A.businessId, { actorKind: "user", actorId: A.ownerId, action: "business.request_deletion", details: {} });
    const [first, second] = [hex(), hex()];
    const a = await repos.founderCancelLinks.create(h.db, { businessId: A.businessId, userId: cofounder, requestId: request.id, tokenHash: first, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    const b = await repos.founderCancelLinks.create(h.db, { businessId: A.businessId, userId: cofounder, requestId: request.id, tokenHash: second, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    expect((await repos.founderCancelLinks.byTokenHash(h.db, first))!.id).toBe(a.id);
    expect((await repos.founderCancelLinks.byTokenHash(h.db, second))!.id).toBe(b.id);
    expect(await repos.founderCancelLinks.byTokenHash(h.db, "not-a-hash")).toBeNull();
    expect(await repos.founderCancelLinks.use(h.db, a.id)).toBe(true);
    expect(await repos.founderCancelLinks.use(h.db, a.id)).toBe(false);
    expect(await repos.founderCancelLinks.use(h.db, b.id, new Date(Date.now() + 8 * 86_400_000))).toBe(false);
    await repos.founderCancelLinks.remove(h.db, b.id);
    expect(await repos.founderCancelLinks.byTokenHash(h.db, second)).toBeNull();
    // An end before the row's own start is refused by the database.
    await expect(repos.founderCancelLinks.create(h.db, { businessId: A.businessId, userId: cofounder, requestId: request.id, tokenHash: hex(), expiresAt: new Date(Date.now() - 60_000) })).rejects.toThrow();
  });

  it("no client role reads or writes a link, in its own business or another's (cross-tenant)", async () => {
    for (const who of [A.ownerId, cofounder, A.memberId, B.ownerId]) {
      await expect(h.asUser(who).run((tx) => tx.select({ id: s.founderCancelLinks.id }).from(s.founderCancelLinks)), who).rejects.toThrow(/permission denied/);
      await expect(h.asUser(who).run((tx) => tx.insert(s.founderCancelLinks).values({ businessId: A.businessId, userId: who, requestId: A.inboxItemId, tokenHash: hex(), expiresAt: new Date(Date.now() + 86_400_000) })), who).rejects.toThrow(/permission denied/);
    }
    await expect(h.anon().run((tx) => tx.select({ id: s.founderCancelLinks.id }).from(s.founderCancelLinks))).rejects.toThrow(/permission denied/);
  });
});

describe("the vocabulary and the suppression rule", () => {
  it("founder_notice.sent is an account event type, and founder_notifications takes founder_notice", async () => {
    const types = ((await h.db.execute(sql`select fm_account_event_types() as t`)) as unknown as { rows: { t: string[] }[] }).rows[0]!.t;
    expect(types).toContain("founder_notice.sent");
    await h.service().run((tx) => tx.insert(s.founderNotifications).values({ userId: A.ownerId, businessId: A.businessId, kind: "founder_notice", dedupeKey: `founder_notice:${crypto.randomUUID()}`, subject: "A notice" }));
  });

  it("only a bounce or a spam report is a hard suppression; an unsubscribe or no invitations is not", async () => {
    const [bounced, spam, unsubscribed, noInvites] = [hex(), hex(), hex(), hex()];
    await repos.channels.addSuppression(h.db, A.businessId, { emailHash: bounced, reason: HARD_SUPPRESSION_REASONS[0]!, scope: "business" });
    await repos.channels.suppressEverywhere(h.db, { emailHash: spam, reason: HARD_SUPPRESSION_REASONS[1]!, source: "test" });
    await repos.channels.addSuppression(h.db, A.businessId, { emailHash: unsubscribed, reason: "unsubscribed", scope: "business" });
    await repos.channels.suppressEverywhere(h.db, { emailHash: noInvites, reason: "asked for no invitations", source: "invitation_link" });
    expect(await repos.channels.isHardSuppressed(h.db, A.businessId, bounced)).toBe(true);
    expect(await repos.channels.isHardSuppressed(h.db, B.businessId, bounced)).toBe(false);
    expect(await repos.channels.isHardSuppressed(h.db, B.businessId, spam)).toBe(true);
    expect(await repos.channels.isHardSuppressed(h.db, A.businessId, unsubscribed)).toBe(false);
    expect(await repos.channels.isHardSuppressed(h.db, A.businessId, noInvites)).toBe(false);
  });

  it("a member cannot plant, change or remove a hard suppression; the policy names the same reasons as the code", async () => {
    for (const reason of HARD_SUPPRESSION_REASONS) {
      await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.suppressionList).values({ businessId: A.businessId, emailHash: hex(), reason, scope: "business" }))).rejects.toThrow(RLS_DENIED);
    }
    // An ordinary entry still works for a member, and cannot be turned into a hard one.
    const [row] = await h.asUser(A.memberId).run((tx) => tx.insert(s.suppressionList).values({ businessId: A.businessId, emailHash: hex(), reason: "unsubscribed", scope: "business" }).returning({ id: s.suppressionList.id }));
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.suppressionList).set({ reason: HARD_SUPPRESSION_REASONS[0]! }).where(eq(s.suppressionList.id, row!.id)))).rejects.toThrow(RLS_DENIED);
    // A bounce the mail service reported (the service role) stays, whatever a member tries.
    const bounced = hex();
    await repos.channels.addSuppression(h.db, A.businessId, { emailHash: bounced, reason: HARD_SUPPRESSION_REASONS[0]!, scope: "business" });
    const gone = await h.asUser(A.ownerId).run((tx) => tx.delete(s.suppressionList).where(eq(s.suppressionList.emailHash, bounced)).returning({ id: s.suppressionList.id }));
    expect(gone).toHaveLength(0);
    expect(await repos.channels.isHardSuppressed(h.db, A.businessId, bounced)).toBe(true);
    const [policy] = ((await h.db.execute(sql`select qual, with_check from pg_policies where tablename = 'suppression_list' and policyname = 'suppression_list_write'`)) as unknown as { rows: { qual: string; with_check: string }[] }).rows;
    for (const reason of HARD_SUPPRESSION_REASONS) {
      expect(policy!.qual).toContain(reason);
      expect(policy!.with_check).toContain(reason);
    }
  });
});
