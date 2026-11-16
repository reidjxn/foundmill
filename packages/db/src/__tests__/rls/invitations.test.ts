/**
 * 0091 — the way in: `account_admissions` (account-scoped) and `invitations` (business-scoped). docs/NETWORK.md F5,
 * §11; the migration's header states the rules.
 *
 *   - the admissions are the service role's only: no client role reads or writes a row, not another account, not the
 *     person's own, not anon (a client that could insert one would admit itself);
 *   - invitations: a member of the business reads its rows but never `token_hash` or `email`; an owner or an admin
 *     creates one (an owner alone for a cofounder), as the inviter, pending, on a real business; an owner or an admin
 *     revokes a pending one and changes nothing else; nobody deletes; another business's people reach nothing;
 *   - the database's own checks hold whoever writes: the shapes of hashes and addresses, one admission per account, an
 *     invitation's dates and states; `founder_notifications` takes the new kind `invitation_accepted`.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsider: string;
let newcomer: string;

const hex = () => createHash("sha256").update(randomBytes(16)).digest("hex");
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
/** A client's insert of an invitation, the columns the api writes. */
const clientInsert = (runner: ReturnType<TestHarness["asUser"]>, f: BusinessFixture, by: string, role: "cofounder" | "collaborator", over: Record<string, unknown> = {}) =>
  // A cofounder invitation always names an address (0093).
  runner.run((tx) => repos.invitations.create(tx, f.businessId, { tokenHash: hex(), role, invitedByUserId: by, email: role === "cofounder" ? "partner@example.com" : null, expiresAt: inDays(14), ...over }));

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "people-a");
  B = await createBusinessFixture(h, "people-b");
  outsider = await h.createUser("people-outsider@test.local");
  newcomer = await h.createUser("people-newcomer@test.local");
}, 120_000);
afterAll(() => h?.close());

describe("account_admissions 0091: the service role's only", () => {
  it("one admission per account, the first stays; the open count reads today's", async () => {
    const svc = h.service();
    const who = await h.createUser("people-admitted@test.local");
    expect(await svc.run((tx) => repos.admissions.has(tx, who))).toBe(false);
    expect(await svc.run((tx) => repos.admissions.record(tx, { userId: who, how: "open" }))).toMatchObject({ userId: who, how: "open" });
    expect(await svc.run((tx) => repos.admissions.record(tx, { userId: who, how: "existing" }))).toBeNull();
    expect(await svc.run((tx) => repos.admissions.has(tx, who))).toBe(true);
    const start = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    expect(await svc.run((tx) => repos.admissions.openSince(tx, start))).toBeGreaterThanOrEqual(1);
    // 0111 adds `waitlist` to the kinds; anything else is still refused.
    await expect(svc.execute(sql`insert into account_admissions (user_id, how) values (${outsider}, 'list')`)).rejects.toThrow(/how_value/);
    // The person's own email kinds gain `invitation_accepted` on their record (0083's check, widened here).
    await svc.execute(sql`insert into founder_notifications (user_id, business_id, kind, dedupe_key) values (${A.ownerId}, ${A.businessId}, 'invitation_accepted', 'invitation_accepted:x')`);
    await expect(svc.execute(sql`insert into founder_notifications (user_id, business_id, kind, dedupe_key) values (${A.ownerId}, ${A.businessId}, 'waitlist_joined', 'y')`)).rejects.toThrow(/kind_check/);
  });

  it("no client role reads or writes a row, the account's own included", async () => {
    for (const [runner, who] of [[h.anon(), outsider], [h.asUser(outsider), outsider], [h.asUser(A.ownerId), outsider]] as const) {
      await expect(runner.execute(sql`select id from account_admissions`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`insert into account_admissions (user_id, how) values (${who}, 'open')`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`update account_admissions set how = 'existing'`)).rejects.toThrow(/permission denied/);
      await expect(runner.execute(sql`delete from account_admissions`)).rejects.toThrow(/permission denied/);
      await expect(runner.run((tx) => repos.admissions.has(tx, who))).rejects.toThrow(/permission denied/);
    }
    expect(await rows<{ n: number }>(sql`select count(*)::int as n from account_admissions where user_id = ${outsider}`)).toEqual([{ n: 0 }]);
  });
});

describe("invitations 0091: business-scoped, the token and the address never readable by a client", () => {
  it("an owner creates either role; an admin a collaborator only; a member, a viewer, another business and anon none", async () => {
    expect(await clientInsert(h.asUser(A.ownerId), A, A.ownerId, "cofounder")).toMatchObject({ businessId: A.businessId, role: "cofounder", state: "pending", invitedByUserId: A.ownerId });
    expect(await clientInsert(h.asUser(A.adminId), A, A.adminId, "collaborator")).toMatchObject({ role: "collaborator" });
    await expect(clientInsert(h.asUser(A.adminId), A, A.adminId, "cofounder")).rejects.toThrow(/row-level security|permission denied/);
    await expect(clientInsert(h.asUser(A.memberId), A, A.memberId, "collaborator")).rejects.toThrow(/row-level security|permission denied/);
    await expect(clientInsert(h.asUser(A.viewerId), A, A.viewerId, "collaborator")).rejects.toThrow(/row-level security|permission denied/);
    // Cross-tenant: B's owner cannot invite into A, even naming themselves as the inviter.
    await expect(clientInsert(h.asUser(B.ownerId), A, B.ownerId, "collaborator")).rejects.toThrow(/row-level security|permission denied/);
    await expect(clientInsert(h.anon(), A, A.ownerId, "collaborator")).rejects.toThrow(/permission denied/);
    // The inviter is the person writing, never someone else.
    await expect(clientInsert(h.asUser(A.adminId), A, A.ownerId, "collaborator")).rejects.toThrow(/row-level security/);
  });

  it("a client's new invitation is pending, made now and works at most 30 days", async () => {
    const owner = h.asUser(A.ownerId);
    await expect(clientInsert(owner, A, A.ownerId, "collaborator", { expiresAt: inDays(45) })).rejects.toThrow(/at most 30 days/);
    await expect(clientInsert(owner, A, A.ownerId, "collaborator", { expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow(/at most 30 days/);
    await expect(owner.execute(sql`insert into invitations (business_id, token_hash, role, invited_by_user_id, expires_at, state, accepted_at) values (${A.businessId}, ${hex()}, 'collaborator', ${A.ownerId}, now() + interval '1 day', 'accepted', now())`)).rejects.toThrow(/permission denied/);
    // created_at is the database's clock, whatever the client sends.
    await owner.execute(sql`insert into invitations (business_id, token_hash, role, invited_by_user_id, expires_at, created_at) values (${A.businessId}, ${hex()}, 'collaborator', ${A.ownerId}, now() + interval '20 days', now() + interval '300 days')`);
    const [latest] = await rows<{ created_at: string }>(sql`select created_at from invitations where business_id = ${A.businessId} order by expires_at desc limit 1`);
    expect(new Date(latest!.created_at).getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it("on a sample business nobody invites anyone", async () => {
    await h.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, B.businessId));
    try {
      await expect(clientInsert(h.asUser(B.ownerId), B, B.ownerId, "collaborator")).rejects.toThrow(/row-level security/);
    } finally {
      await h.db.update(s.businesses).set({ isDemo: false }).where(eq(s.businesses.id, B.businessId));
    }
  });

  it("members read the rows of their own business only, and never the token's hash or the address", async () => {
    await h.service().run((tx) => repos.invitations.create(tx, A.businessId, { tokenHash: hex(), role: "collaborator", invitedByUserId: A.ownerId, email: "invitee@example.com", expiresAt: inDays(14) }));
    for (const id of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      const listed = await h.asUser(id).run((tx) => repos.invitations.list(tx, A.businessId));
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.every((r) => r.businessId === A.businessId)).toBe(true);
      await expect(h.asUser(id).execute(sql`select token_hash from invitations`)).rejects.toThrow(/permission denied/);
      await expect(h.asUser(id).execute(sql`select email from invitations`)).rejects.toThrow(/permission denied/);
      await expect(h.asUser(id).execute(sql`select * from invitations`)).rejects.toThrow(/permission denied/);
    }
    expect(await h.asUser(B.ownerId).run((tx) => repos.invitations.list(tx, A.businessId))).toEqual([]);
    expect(await h.asUser(outsider).run((tx) => repos.invitations.list(tx, A.businessId))).toEqual([]);
    await expect(h.anon().run((tx) => repos.invitations.list(tx, A.businessId))).rejects.toThrow(/permission denied/);
    // A guess at a token is not even a question a client can ask.
    await expect(h.asUser(A.ownerId).execute(sql`select id from invitations where token_hash = ${hex()}`)).rejects.toThrow(/permission denied/);
  });

  it("an owner or an admin revokes a pending invitation, and nothing else changes; a member, another business and anon cannot", async () => {
    const make = () => clientInsert(h.asUser(A.ownerId), A, A.ownerId, "collaborator");
    const one = await make();
    for (const id of [A.memberId, A.viewerId, B.ownerId, outsider]) {
      expect(await h.asUser(id).run((tx) => repos.invitations.revoke(tx, A.businessId, one.id, id))).toBeNull();
    }
    await expect(h.anon().run((tx) => repos.invitations.revoke(tx, A.businessId, one.id, A.ownerId))).rejects.toThrow(/permission denied/);
    expect(await h.asUser(A.adminId).run((tx) => repos.invitations.revoke(tx, A.businessId, one.id, A.adminId))).toMatchObject({ state: "revoked", revokedByUserId: A.adminId });
    // Revoked stays revoked: it cannot be turned back on, or into anything else.
    await expect(h.asUser(A.ownerId).execute(sql`update invitations set state = 'pending', revoked_at = null, revoked_by_user_id = null where id = ${one.id}`)).rejects.toThrow(/can only be revoked/);
    const two = await make();
    // The role, the expiry and the acceptance are never a client's to change, revoking or not.
    await expect(h.asUser(A.ownerId).execute(sql`update invitations set role = 'cofounder' where id = ${two.id}`)).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).execute(sql`update invitations set expires_at = now() + interval '29 days' where id = ${two.id}`)).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).execute(sql`update invitations set state = 'accepted' where id = ${two.id}`)).rejects.toThrow(/can only be revoked|accepted_when/);
    await expect(h.asUser(A.ownerId).execute(sql`update invitations set state = 'revoked', revoked_at = now(), revoked_by_user_id = ${A.adminId} where id = ${two.id}`)).rejects.toThrow(/can only be revoked/);
    await expect(h.asUser(A.ownerId).execute(sql`delete from invitations where id = ${two.id}`)).rejects.toThrow(/permission denied/);
    expect((await h.service().run((tx) => repos.invitations.get(tx, A.businessId, two.id)))?.state).toBe("pending");
  });

  it("the service reads an invitation by its token, accepts it once while in date, and declines one", async () => {
    const svc = h.service();
    const tokenHash = hex();
    const inv = await svc.run((tx) => repos.invitations.create(tx, A.businessId, { tokenHash, role: "cofounder", invitedByUserId: A.ownerId, email: "partner@example.com", expiresAt: inDays(14) }));
    expect(await svc.run((tx) => repos.invitations.byTokenHash(tx, tokenHash))).toMatchObject({ id: inv.id, role: "cofounder", businessName: expect.any(String), businessArchived: false, businessIsDemo: false });
    expect(await svc.run((tx) => repos.invitations.byTokenHash(tx, hex()))).toBeNull();
    expect(await svc.run((tx) => repos.invitations.accept(tx, inv.id, newcomer))).toMatchObject({ state: "accepted", acceptedByUserId: newcomer });
    expect(await svc.run((tx) => repos.invitations.accept(tx, inv.id, outsider))).toBeNull();
    expect(await svc.run((tx) => repos.invitations.decline(tx, inv.id))).toBeNull();
    expect((await svc.run((tx) => repos.invitations.firstAcceptedBy(tx, newcomer)))?.id).toBe(inv.id);
    const other = await svc.run((tx) => repos.invitations.create(tx, A.businessId, { tokenHash: hex(), role: "collaborator", invitedByUserId: A.ownerId, email: null, expiresAt: inDays(1) }));
    expect(await svc.run((tx) => repos.invitations.decline(tx, other.id))).toMatchObject({ state: "declined" });
    // Past its date, nothing uses it.
    const late = await svc.run((tx) => repos.invitations.create(tx, A.businessId, { tokenHash: hex(), role: "collaborator", invitedByUserId: A.ownerId, email: null, expiresAt: inDays(1) }));
    await svc.execute(sql`update invitations set created_at = now() - interval '3 days', expires_at = now() - interval '1 hour' where id = ${late.id}`);
    expect(await svc.run((tx) => repos.invitations.accept(tx, late.id, outsider))).toBeNull();
    // A client cannot accept or decline for anyone: the columns are not theirs to write.
    const pending = await clientInsert(h.asUser(A.ownerId), A, A.ownerId, "collaborator");
    await expect(h.asUser(outsider).execute(sql`update invitations set state = 'accepted', accepted_at = now(), accepted_by_user_id = ${outsider} where id = ${pending.id}`)).rejects.toThrow(/permission denied/);
  });
});
