/**
 * 0090 — the cofounder and collaborator roles (THESIS_REVIEW package 3.3). The migration's header states the rules:
 *
 *   - a cofounder is an owner wherever the database checks for one: `has_role(…, ['owner'])`, the membership guards
 *     (only someone with an owner's standing manages or grants it), the keep-an-owner trigger, an invitation of a
 *     cofounder (0089), the founders' names on a public page;
 *   - a collaborator writes where a member writes, never an admin-only table, never the memberships; its end date
 *     (`expires_at`) is a collaborator's only, and once it has passed the row opens nothing, in either business;
 *   - another business's people reach none of it (the generic suite, cross-tenant.test.ts, runs both roles over every
 *     business table);
 *   - 0092: a collaborator reads nothing of the admin-written and Money tables (`COLLABORATOR_CLOSED_TABLES`) nor the
 *     project's invitations, through any SELECT or ALL policy; the tables it still reads are named;
 *   - 0093: a collaborator reads and writes nothing of the Money and Legal tables members write
 *     (`COLLABORATOR_CLOSED_MONEY_LEGAL`), through any policy; the generic suite runs read, insert, update and delete
 *     per table;
 *   - 0091: the cutover for a person from before open sign-up is stored, for the service role only; a cofounder
 *     invitation names an address.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { assertOwnerRef } from "../../repos/_refs";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";
import { COLLABORATOR_CLOSED_MONEY_LEGAL, COLLABORATOR_CLOSED_TABLES, COLLABORATOR_STILL_READS_ADMIN_TABLES, TENANT_TABLES } from "./tables";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let cofounder: string;
let collaborator: string;
let ended: string;

const row = (businessId: string, userId: string) => and(eq(s.memberships.businessId, businessId), eq(s.memberships.userId, userId));
const roleOf = async (businessId: string, userId: string) => (await h.db.select({ role: s.memberships.role }).from(s.memberships).where(row(businessId, userId)))[0]?.role ?? null;
const hex = () => createHash("sha256").update(randomBytes(16)).digest("hex");
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
type PolicyRow = { tablename: string; policyname: string; cmd: string; qual: string | null; with_check: string | null };
const policiesOn = async (tables: readonly string[]): Promise<PolicyRow[]> =>
  ((await h.db.execute(sql`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = any(${sql.raw(`array[${tables.map((t) => `'${t}'`).join(",")}]`)}::text[]) order by tablename, policyname`)) as unknown as { rows: PolicyRow[] }).rows;
/**
 * Whether a policy expression could hold for a collaborator: anything over `is_member`, or a `has_role` whose roles
 * include 'member' (a collaborator holds it), unless the expression also requires `is_member_not_collaborator`. An
 * expression this does not recognize counts as admitting one, so a new kind of policy fails the test until it is read.
 */
const admitsCollaborator = (expr: string | null): boolean => {
  if (expr === null) return false;
  if (/is_member_not_collaborator\(business_id\)/.test(expr) && !/\bor\b/i.test(expr)) return false;
  if (/(^|[^_])is_member\(/.test(expr.replace(/is_member_not_collaborator\(/g, ""))) return true;
  const roleLists = [...expr.matchAll(/has_role\(business_id, (?:'\{([^}]*)\}'::text\[\]|ARRAY\[([^\]]*)\])/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/'|::text/g, "").split(",").map((r) => r.trim()));
  if (roleLists.length === 0) return true;
  return roleLists.some((roles) => roles.includes("member") || roles.includes("collaborator"));
};
const failure = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "resolved";
  } catch (err) {
    const messages: string[] = [];
    for (let e: unknown = err; e && typeof e === "object" && messages.length < 4; e = (e as { cause?: unknown }).cause) messages.push(String((e as { message?: unknown }).message ?? ""));
    return messages.join(" | ");
  }
};

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "roles-a");
  B = await createBusinessFixture(h, "roles-b");
  [cofounder, collaborator, ended] = await Promise.all([h.createUser("roles-cofounder@test.local"), h.createUser("roles-collaborator@test.local"), h.createUser("roles-ended@test.local")]);
  await h.db.insert(s.memberships).values([
    { businessId: A.businessId, userId: cofounder, role: "cofounder" },
    { businessId: A.businessId, userId: collaborator, role: "collaborator" },
    { businessId: A.businessId, userId: ended, role: "collaborator", expiresAt: new Date(Date.now() - 60_000) },
  ]);
}, 120_000);
afterAll(() => h?.close());

describe("memberships 0090: the roles and the end date", () => {
  it("takes the two new roles, and an end date on a collaborator's row only", async () => {
    expect(await failure(h.db.execute(sql`insert into memberships (business_id, user_id, role) values (${B.businessId}, ${cofounder}, 'founder')`))).toMatch(/role_check/);
    expect(await failure(h.db.update(s.memberships).set({ expiresAt: inDays(3) }).where(row(A.businessId, cofounder)))).toMatch(/expires_only_collaborator/);
    expect(await failure(h.db.update(s.memberships).set({ expiresAt: inDays(3) }).where(row(A.businessId, A.memberId)))).toMatch(/expires_only_collaborator/);
    expect(await repos.memberships.setExpiry(h.db, A.businessId, collaborator, inDays(14))).toMatchObject({ role: "collaborator", expiresAt: expect.any(Date) });
    await expect(repos.memberships.setExpiry(h.db, A.businessId, A.memberId, inDays(14))).rejects.toThrow(/Only a collaborator/);
    // Another role clears the date (the repo), so a member never carries one.
    const someone = await h.createUser("roles-trial@test.local");
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: someone, role: "collaborator", expiresAt: inDays(14) });
    expect(await repos.memberships.setRole(h.db, A.businessId, someone, "member")).toMatchObject({ role: "member", expiresAt: null });
  });

  it("a cofounder holds an owner's rights: grants and manages owner-standing rows, admin-only tables, and a cofounder invitation", async () => {
    const newcomer = await h.createUser("roles-newcomer@test.local");
    // Adds a cofounder, as an owner can (an admin cannot).
    await expect(h.asUser(A.adminId).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: newcomer, role: "cofounder" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(cofounder).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: newcomer, role: "cofounder" }).returning())).toHaveLength(1);
    // An admin cannot touch a cofounder's row or make anyone a cofounder.
    expect(await h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ role: "viewer" }).where(row(A.businessId, newcomer)).returning())).toHaveLength(0);
    expect(await h.asUser(A.adminId).run((tx) => tx.delete(s.memberships).where(row(A.businessId, newcomer)).returning())).toHaveLength(0);
    await expect(h.asUser(A.adminId).run((tx) => tx.update(s.memberships).set({ role: "cofounder" }).where(row(A.businessId, A.viewerId)))).rejects.toThrow(RLS_DENIED);
    // A cofounder changes another cofounder's row and an owner's, never their own.
    expect(await h.asUser(cofounder).run((tx) => tx.update(s.memberships).set({ sectionPermissions: {} }).where(row(A.businessId, A.ownerId)).returning())).toHaveLength(1);
    expect(await h.asUser(cofounder).run((tx) => tx.update(s.memberships).set({ role: "owner" }).where(row(A.businessId, cofounder)).returning())).toHaveLength(0);
    expect(await h.asUser(cofounder).run((tx) => tx.delete(s.memberships).where(row(A.businessId, newcomer)).returning())).toHaveLength(1);
    // An admin-only table (0009's `accounts`).
    expect(await h.asUser(cofounder).run((tx) => tx.insert(s.accounts).values({ businessId: A.businessId, provider: "mock_bank", externalId: `cofounder-${Date.now()}`, name: "Cofounder's account" }).returning())).toHaveLength(1);
    // 0089: a cofounder invitation is an owner's to make, so a cofounder's too.
    expect(await h.asUser(cofounder).run((tx) => repos.invitations.create(tx, A.businessId, { tokenHash: hex(), role: "cofounder", invitedByUserId: cofounder, email: "partner@example.com", expiresAt: inDays(14) }))).toMatchObject({ role: "cofounder" });
    // Nothing of B.
    expect(await h.asUser(cofounder).run((tx) => tx.select({ id: s.memberships.id }).from(s.memberships).where(eq(s.memberships.businessId, B.businessId)))).toHaveLength(0);
    await expect(h.asUser(cofounder).run((tx) => tx.insert(s.memberships).values({ businessId: B.businessId, userId: newcomer, role: "member" }))).rejects.toThrow(RLS_DENIED);
  });

  it("a business keeps at least one owner or cofounder", async () => {
    const C = await createBusinessFixture(h, "roles-c");
    const partner = await h.createUser("roles-c-cofounder@test.local");
    await h.db.insert(s.memberships).values({ businessId: C.businessId, userId: partner, role: "cofounder" });
    // The founder who started it leaves; the cofounder keeps the business.
    expect(await h.asUser(C.ownerId).run((tx) => tx.delete(s.memberships).where(row(C.businessId, C.ownerId)).returning())).toHaveLength(1);
    expect(await failure(h.service().run((tx) => tx.update(s.memberships).set({ role: "member" }).where(row(C.businessId, partner))))).toMatch(/at least one owner/);
    expect(await failure(h.service().run((tx) => tx.delete(s.memberships).where(row(C.businessId, partner))))).toMatch(/at least one owner/);
    await expect(repos.memberships.remove(h.db, C.businessId, partner)).rejects.toThrow(/at least one owner/);
    expect(await roleOf(C.businessId, partner)).toBe("cofounder");
    expect((await repos.memberships.owner(h.db, C.businessId))?.userId).toBe(partner);
  });

  it("a collaborator writes where a member writes, never an admin-only table and never the memberships", async () => {
    expect(await h.asUser(collaborator).run((tx) => tx.insert(s.tasks).values({ businessId: A.businessId, title: "A collaborator's task", kind: "research" }).returning({ id: s.tasks.id }))).toHaveLength(1);
    await expect(h.asUser(collaborator).run((tx) => tx.insert(s.accounts).values({ businessId: A.businessId, provider: "mock_bank", externalId: "collab-1", name: "Not theirs" }))).rejects.toThrow(RLS_DENIED);
    const someone = await h.createUser("roles-someone@test.local");
    await expect(h.asUser(collaborator).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: someone, role: "collaborator" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(collaborator).run((tx) => tx.update(s.memberships).set({ role: "viewer" }).where(row(A.businessId, A.memberId)).returning())).toHaveLength(0);
    await expect(h.asUser(collaborator).run((tx) => repos.invitations.create(tx, A.businessId, { tokenHash: hex(), role: "collaborator", invitedByUserId: collaborator, email: null, expiresAt: inDays(14) }))).rejects.toThrow(RLS_DENIED);
    // A collaborator may leave.
    const leaver = await h.createUser("roles-leaver@test.local");
    await h.db.insert(s.memberships).values({ businessId: A.businessId, userId: leaver, role: "collaborator" });
    expect(await h.asUser(leaver).run((tx) => tx.delete(s.memberships).where(row(A.businessId, leaver)).returning())).toHaveLength(1);
  });

  it("an ended collaborator's row opens nothing, here and in the api's reads", async () => {
    const as = h.asUser(ended);
    expect(await as.run((tx) => tx.select({ id: s.businesses.id }).from(s.businesses))).toHaveLength(0);
    expect(await as.run((tx) => tx.select({ id: s.memberships.id }).from(s.memberships))).toHaveLength(0);
    await expect(as.run((tx) => tx.insert(s.tasks).values({ businessId: A.businessId, title: "Too late", kind: "research" }))).rejects.toThrow(RLS_DENIED);
    const access = await repos.memberships.access(h.db, A.businessId, ended);
    expect(access.membership).toBeNull();
    expect(await repos.memberships.hasRole(h.db, A.businessId, ended, ["collaborator"])).toBe(false);
    expect((await repos.memberships.listForUser(h.db, ended)).map((m) => m.businessId)).not.toContain(A.businessId);
    // Still listed to the founders, with its date, so they see it and can remove it.
    expect((await repos.memberships.list(h.db, A.businessId)).find((m) => m.userId === ended)?.expiresAt).toBeInstanceOf(Date);
    // A date still ahead opens the business.
    expect((await repos.memberships.access(h.db, A.businessId, collaborator)).membership?.role).toBe("collaborator");
  });

  it("an ended collaborator gets no project card and cannot be made a record's owner; a running one can", async () => {
    // The card of a business the viewer belongs to (A is not listed, so only a membership shows it).
    const cards = async (viewer: string) => (await repos.social.lookupPeople(h.db, viewer, { businessIds: [A.businessId] })).businesses.map((b) => b.businessId);
    expect(await cards(collaborator)).toEqual([A.businessId]);
    expect(await cards(ended)).toEqual([]);
    await expect(assertOwnerRef(h.db, A.businessId, { kind: "user", id: collaborator })).resolves.toBeUndefined();
    await expect(assertOwnerRef(h.db, A.businessId, { kind: "user", id: ended })).rejects.toThrow(/ownerRef/);
    await expect(assertOwnerRef(h.db, A.businessId, { kind: "user", id: B.ownerId })).rejects.toThrow(/ownerRef/);
  });

  it("the founders' names on a public page are the owners' and the cofounders'", async () => {
    await h.db.insert(s.founderProfiles).values([
      { userId: A.ownerId, displayName: "Maya Owner" },
      { userId: cofounder, displayName: "Ida Cofounder" },
      { userId: collaborator, displayName: "Sam Collaborator" },
    ]);
    expect(await repos.pages.ownerNames(h.db, A.businessId)).toEqual(["Maya Owner", "Ida Cofounder"]);
    const view = (await h.db.execute(sql`select pg_get_viewdef('public_project_pages'::regclass) as d`)) as unknown as { rows: { d: string }[] };
    expect(view.rows[0]!.d).toMatch(/'owner'::text, 'cofounder'::text/);
  });

  it("0092: a collaborator reads none of the admin-written and Money tables, nor the invitations; everyone else as before", async () => {
    // A row in each closed table and an invitation, written by the service.
    await h.service().run(async (tx) => {
      await tx.insert(s.accounts).values({ businessId: A.businessId, provider: "mock_bank", externalId: `closed-${Date.now()}`, name: "Ops" });
      await tx.insert(s.integrations).values({ businessId: A.businessId, connectorKey: `closed-${Date.now()}` });
    });
    await repos.invitations.create(h.db, A.businessId, { tokenHash: hex(), role: "collaborator", invitedByUserId: A.ownerId, email: null, expiresAt: inDays(14) });
    for (const [name, table] of [["accounts", s.accounts], ["integrations", s.integrations], ["invitations", s.invitations]] as const) {
      expect(await h.asUser(collaborator).run((tx) => tx.select({ id: table.id }).from(table).where(eq(table.businessId, A.businessId))), name).toHaveLength(0);
      for (const id of [A.ownerId, cofounder, A.adminId, A.memberId, A.viewerId]) expect((await h.asUser(id).run((tx) => tx.select({ id: table.id }).from(table).where(eq(table.businessId, A.businessId)))).length, `${name} ${id}`).toBeGreaterThan(0);
    }
    // Every closed table's select policy is the one 0092 wrote.
    const res = (await h.db.execute(sql`select tablename, qual from pg_policies where schemaname = 'public' and policyname = tablename || '_select'`)) as unknown as { rows: { tablename: string; qual: string }[] };
    const qual = new Map(res.rows.map((r) => [r.tablename, r.qual]));
    for (const t of [...COLLABORATOR_CLOSED_TABLES, "invitations"]) expect(qual.get(t), t).toMatch(/is_member_not_collaborator\(business_id\)/);
    for (const t of COLLABORATOR_STILL_READS_ADMIN_TABLES) expect(qual.get(t), t).toMatch(/^is_member\(business_id\)$/);
    // No other SELECT or ALL policy on these tables lets a collaborator read (a FOR ALL policy answers SELECT too).
    const closed = [...COLLABORATOR_CLOSED_TABLES, "invitations"];
    const policies = await policiesOn(closed);
    expect(new Set(policies.map((p) => p.tablename))).toEqual(new Set(closed));
    for (const p of policies.filter((x) => x.cmd === "SELECT" || x.cmd === "ALL")) expect(admitsCollaborator(p.qual), `${p.tablename}.${p.policyname}: ${p.qual}`).toBe(false);
    // The check itself tells the two apart.
    expect(admitsCollaborator("is_member(business_id)")).toBe(true);
    expect(admitsCollaborator("has_role(business_id, '{owner,admin,member}'::text[])")).toBe(true);
    expect(admitsCollaborator("has_role(business_id, ARRAY['owner'::text, 'admin'::text])")).toBe(false);
    expect(admitsCollaborator("(has_role(business_id, '{owner,admin,member}'::text[]) AND is_member_not_collaborator(business_id))")).toBe(false);
    expect(admitsCollaborator("(is_member_not_collaborator(business_id) OR is_member(business_id))")).toBe(true);
    // The lists are tenant tables and do not overlap.
    const names = new Set(TENANT_TABLES.map((t) => t.name));
    for (const t of [...COLLABORATOR_CLOSED_TABLES, ...COLLABORATOR_STILL_READS_ADMIN_TABLES, ...COLLABORATOR_CLOSED_MONEY_LEGAL]) expect(names.has(t), t).toBe(true);
    expect(COLLABORATOR_CLOSED_TABLES.filter((t) => COLLABORATOR_STILL_READS_ADMIN_TABLES.includes(t) || COLLABORATOR_CLOSED_MONEY_LEGAL.includes(t))).toEqual([]);
    expect(COLLABORATOR_STILL_READS_ADMIN_TABLES.filter((t) => COLLABORATOR_CLOSED_MONEY_LEGAL.includes(t))).toEqual([]);
  });

  it("0093: a collaborator reads and writes nothing of the Money and Legal tables members write; the founders, admins and members as before", async () => {
    const period = () => `0093-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshot = (id: string) => h.asUser(id).run((tx) => tx.insert(s.ledgerSnapshots).values({ businessId: A.businessId, period: period(), basis: "cash" }).returning({ id: s.ledgerSnapshots.id }));
    const [kept] = await h.service().run((tx) => tx.insert(s.ledgerSnapshots).values({ businessId: A.businessId, period: period(), basis: "cash" }).returning({ id: s.ledgerSnapshots.id }));
    for (const id of [collaborator, ended]) {
      await expect(snapshot(id)).rejects.toThrow(RLS_DENIED);
      expect(await h.asUser(id).run((tx) => tx.select({ id: s.ledgerSnapshots.id }).from(s.ledgerSnapshots).where(eq(s.ledgerSnapshots.businessId, A.businessId)))).toHaveLength(0);
      expect(await h.asUser(id).run((tx) => tx.update(s.ledgerSnapshots).set({ updatedAt: new Date() }).where(eq(s.ledgerSnapshots.id, kept!.id)).returning({ id: s.ledgerSnapshots.id }))).toHaveLength(0);
      expect(await h.asUser(id).run((tx) => tx.delete(s.ledgerSnapshots).where(eq(s.ledgerSnapshots.id, kept!.id)).returning({ id: s.ledgerSnapshots.id }))).toHaveLength(0);
    }
    for (const id of [A.ownerId, cofounder, A.adminId, A.memberId]) expect(await snapshot(id), id).toHaveLength(1);
    await expect(snapshot(A.viewerId)).rejects.toThrow(RLS_DENIED);
    expect((await h.asUser(A.viewerId).run((tx) => tx.select({ id: s.ledgerSnapshots.id }).from(s.ledgerSnapshots).where(eq(s.ledgerSnapshots.businessId, A.businessId)))).length).toBeGreaterThan(0);
    // Every policy on the seven tables is one of the two 0093 wrote, and none admits a collaborator, for reads or writes.
    const policies = await policiesOn(COLLABORATOR_CLOSED_MONEY_LEGAL);
    expect(policies.map((p) => `${p.tablename}.${p.policyname}:${p.cmd}`).sort()).toEqual(COLLABORATOR_CLOSED_MONEY_LEGAL.flatMap((t) => [`${t}.${t}_select:SELECT`, `${t}.${t}_write:ALL`]).sort());
    for (const p of policies) {
      expect(admitsCollaborator(p.qual), `${p.tablename}.${p.policyname} using: ${p.qual}`).toBe(false);
      expect(admitsCollaborator(p.with_check), `${p.tablename}.${p.policyname} with check: ${p.with_check}`).toBe(false);
      // The writers are the same as before: an owner (and so a cofounder), an admin, a member.
      if (p.cmd === "ALL") expect(p.qual, p.tablename).toBe("(has_role(business_id, ARRAY['owner'::text, 'admin'::text, 'member'::text]) AND is_member_not_collaborator(business_id))");
    }
  });

  it("0091: the cutover is stored for the service role only; a cofounder invitation names an address", async () => {
    const at = (await h.service().run((tx) => tx.execute(sql`select admission_existing_before() as at`))) as unknown as { rows: { at: Date | string }[] };
    expect(new Date(at.rows[0]!.at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await repos.admissions.existingBefore(h.db)).toBeInstanceOf(Date);
    expect(await failure(h.asUser(A.ownerId).run((tx) => tx.execute(sql`select admission_existing_before()`)))).toMatch(/permission denied/);
    expect(await failure(h.anon().run((tx) => tx.execute(sql`select admission_existing_before()`)))).toMatch(/permission denied/);
    expect(await failure(repos.invitations.create(h.db, A.businessId, { tokenHash: hex(), role: "cofounder", invitedByUserId: A.ownerId, email: null, expiresAt: inDays(14) }))).toMatch(/invitations_cofounder_email/);
    expect(await repos.invitations.create(h.db, A.businessId, { tokenHash: hex(), role: "collaborator", invitedByUserId: A.ownerId, email: null, expiresAt: inDays(14) })).toMatchObject({ role: "collaborator" });
  });
});
