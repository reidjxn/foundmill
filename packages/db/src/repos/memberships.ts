/**
 * memberships — the people of a business (BUILD §7.1; routers team.humans.*).
 *
 * Ownership is guarded here, in apps/api and in the database (0026_membership_guards, 0092): `add` never overwrites an
 * existing member, and neither `setRole` nor `remove` may leave a business without someone with an owner's standing
 * (an owner or a cofounder, `OWNER_ROLES`). Both run under the business's owner lock (`lockOwners`, the same lock 0035's
 * trigger takes), so concurrent changes cannot each count the other as the remaining owner.
 *
 * A collaborator's membership may end (`expires_at`, 0092). An ended membership opens nothing: `access` (what every
 * procedure checks), `hasRole` and `listForUser` leave it out, as the database's `is_member` and `has_role` do. The
 * lists of a business's people (`list`, `listNamed`) still show it, with its date, so the founders see it and can remove it.
 */
import { boundedRecord, ConflictError, DEFAULT_AGENT_STYLE, MEMBERSHIP_ROLES, OWNER_ROLES, SECTIONS, ValidationError, isAgentStyle, isOwnerRole, type AgentStyle, type MembershipRole } from "@foundmill/shared";
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { accountPreferences, businesses, entities, memberships, MEMBERSHIP_SOURCES, type Business, type Membership } from "../schema";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";

/**
 * A membership's own levels, by section: only the sections the walls know (`SECTIONS`), each "read", "write" or "none";
 * a section left out takes the role's default. An unknown key is refused: stored, it would open that section the day a
 * section of that name is added, without anyone having given it. 0096's CHECK says the same in the database. At most one
 * key per section, counted before zod reads a key (`boundedRecord`, GHSA-mrhx-c7xc-m3w5).
 */
export const SectionPermissions = boundedRecord(
  SECTIONS.length,
  z.partialRecord(z.enum(SECTIONS), z.enum(["read", "write", "none"]), {
    // zod reports the unknown keys as `unrecognized_keys`, an issue its types for this option leave out.
    error: (issue) => {
      const keys = (issue as { code: string; keys?: unknown }).code === "unrecognized_keys" ? (issue as { keys?: unknown }).keys : undefined;
      return Array.isArray(keys) ? `No such section: ${keys.join(", ")}` : undefined;
    },
  }),
  "At most one level per section",
);
export type SectionPermissions = z.infer<typeof SectionPermissions>;

export const AddMembershipInput = z.object({
  userId: Id,
  role: z.enum(MEMBERSHIP_ROLES),
  sectionPermissions: SectionPermissions.default({}),
  /** How the row came to be (0065): an invitation unless the caller says otherwise. `example` rows go through `openExample`. */
  source: z.enum(MEMBERSHIP_SOURCES).exclude(["example"]).default("invite"),
});
export type AddMembershipInput = z.input<typeof AddMembershipInput>;

/** What `business.example.open` says to someone who already belongs to the example business for real. */
export const ALREADY_A_MEMBER_OF_EXAMPLE = "You are already a member of this business. Open it from Switch business.";

/** An example membership (0065): a read-only walk around a seeded demo business, never staff and never a seat. */
const notExample = ne(memberships.source, "example");
/**
 * A membership that has not ended (0092: a collaborator's `expires_at`, if any, is still ahead). Every read that hands
 * a person something of a business (its email, its push, the switcher, an approval to decide) uses it, as `is_member` does.
 */
export const membershipNotEnded = or(isNull(memberships.expiresAt), gt(memberships.expiresAt, sql`now()`));
const notEnded = membershipNotEnded;

/** Whether a membership row has ended (a collaborator's `expires_at` has passed). */
export const membershipEnded = (m: Pick<Membership, "expiresAt">, now = new Date()): boolean => m.expiresAt !== null && m.expiresAt !== undefined && m.expiresAt.getTime() <= now.getTime();

export const membershipsRepo = {
  /**
   * The business's staff: every membership but the example viewers (0065), who are not staff, hold no seat and are
   * never listed to the owner. `includeExample` lists them too (counts, the cross-tenant suite).
   */
  async list(db: Executor, businessId: string, filter: { role?: MembershipRole; roles?: readonly MembershipRole[]; includeExample?: boolean; activeOnly?: boolean } = {}): Promise<Membership[]> {
    return db
      .select()
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), filter.role ? eq(memberships.role, filter.role) : undefined, filter.roles ? inArray(memberships.role, [...filter.roles]) : undefined, filter.includeExample ? undefined : notExample, filter.activeOnly ? notEnded : undefined))
      .orderBy(asc(memberships.createdAt));
  },

  /**
   * The business's founder as the screens show it: the owner who created the business while they still own it, else
   * the longest-standing person with an owner's standing (an owner or a cofounder). The org chart is rooted at this
   * person and agents with no line manager report to them.
   */
  async owner(db: Executor, businessId: string): Promise<Membership | null> {
    return maybeOne(
      await db
        .select({ m: memberships })
        .from(memberships)
        .innerJoin(businesses, eq(businesses.id, memberships.businessId))
        .where(and(eq(memberships.businessId, businessId), inArray(memberships.role, [...OWNER_ROLES])))
        .orderBy(sql`(${memberships.userId} = ${businesses.createdBy} and ${memberships.role} = 'owner') desc`, asc(memberships.createdAt), asc(memberships.id))
        .limit(1)
        .then((rows) => rows.map((r) => r.m)),
    );
  },

  /**
   * Members with the person the business knows them as: the CRM `team_member` record whose `identifiers.user_id` is the
   * member's account (its id is what an entity link points at, its name what screens show), else none. A member is
   * never named or linked by their auth account id, which is not a CRM record.
   */
  async listNamed(db: Executor, businessId: string): Promise<(Membership & { displayName: string | null; entityId: string | null })[]> {
    const rows = await db
      .select({ membership: memberships, entityId: entities.id, displayName: entities.displayName })
      .from(memberships)
      .leftJoin(
        entities,
        and(eq(entities.businessId, memberships.businessId), eq(entities.kind, "team_member"), isNull(entities.archivedAt), isNull(entities.mergedIntoId), sql`${entities.identifiers}->>'user_id' = ${memberships.userId}::text`),
      )
      // Example viewers (0065) are not staff: the Team's staff list never shows them.
      .where(and(eq(memberships.businessId, businessId), notExample))
      .orderBy(asc(memberships.createdAt), asc(entities.createdAt));
    const out = new Map<string, Membership & { displayName: string | null; entityId: string | null }>();
    for (const r of rows) if (!out.has(r.membership.id)) out.set(r.membership.id, { ...r.membership, displayName: r.displayName ?? null, entityId: r.entityId ?? null });
    return [...out.values()];
  },

  async get(db: Executor, businessId: string, userId: string): Promise<Membership | null> {
    return maybeOne(await db.select().from(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).limit(1));
  },

  /**
   * The user's membership of the business while it has not ended (an ended collaborator's row reads as none). With
   * `lock: "share"` (inside a transaction) the row is held `for share` until the transaction ends, so a role change or a
   * removal waits for it: an invitation's accept re-checks its inviter this way.
   */
  async getActive(db: Executor, businessId: string, userId: string, options: { lock?: "share" } = {}): Promise<Membership | null> {
    const q = db.select().from(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId), notEnded)).limit(1);
    return maybeOne(options.lock === "share" ? await q.for("share") : await q);
  },

  /**
   * The signed-in user's own membership of the business, held `for share` until the transaction ends and read after the
   * lock, so it is the latest committed row and stays so: a role change or a removal waits. For the RLS connection
   * (`userId` is `auth.uid()`), where `getActive(…, { lock: "share" })` finds nothing: a locking read must also pass the
   * update policy, which excludes one's own row (0026, 0092), so the lock is 0096's `lock_my_membership`. Null when the
   * membership is gone or has ended. On the service connection use `getActive` with `lock: "share"`.
   */
  async getMineForShare(db: Executor, businessId: string, userId: string): Promise<Membership | null> {
    const bid = parseInput(Id, businessId, "business id");
    await db.execute(sql`select lock_my_membership(${bid}::uuid)`);
    return membershipsRepo.getActive(db, bid, parseInput(Id, userId, "user id"));
  },

  /**
   * Another person's membership row, held `for update` until the transaction ends (a change of it is judged on the row
   * as it is, and nobody else changes it meanwhile). Under RLS only a row the caller may update comes back: null for
   * their own row and for one the policy keeps from them (an admin and an owner's or a cofounder's row).
   */
  async getForUpdate(db: Executor, businessId: string, userId: string): Promise<Membership | null> {
    return maybeOne(await db.select().from(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).limit(1).for("update"));
  },

  /**
   * What apps/api's `businessProcedure` checks before every procedure: the user's membership and the business, in one
   * statement (one round trip pair instead of two lookups on two connections). No membership: both null, whether or
   * not the business exists, so a non-member learns nothing about it. A membership of an archived business comes back
   * with a null business, as `businesses.get` would not find it, unless `includeArchived` (the few things an archived
   * business still allows: restore, export, deletion requests).
   */
  async access(db: Executor, businessId: string, userId: string, options: { includeArchived?: boolean } = {}): Promise<{ membership: Membership | null; business: Business | null; anthropomorphicAgents: boolean; agentStyle: AgentStyle }> {
    // The member's own display preferences ride along (anthropomorphic agents and their style), so nothing downstream reads them again.
    const rows = await db
      .select({ membership: memberships, business: businesses, anthropomorphicAgents: accountPreferences.anthropomorphicAgents, agentStyle: accountPreferences.agentStyle })
      .from(memberships)
      .leftJoin(businesses, options.includeArchived ? eq(businesses.id, memberships.businessId) : and(eq(businesses.id, memberships.businessId), isNull(businesses.archivedAt)))
      .leftJoin(accountPreferences, eq(accountPreferences.userId, memberships.userId))
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId), notEnded))
      .limit(1);
    const row = rows[0];
    return row
      ? { membership: row.membership, business: row.business, anthropomorphicAgents: row.anthropomorphicAgents === true, agentStyle: isAgentStyle(row.agentStyle) ? row.agentStyle : DEFAULT_AGENT_STYLE }
      : { membership: null, business: null, anthropomorphicAgents: false, agentStyle: DEFAULT_AGENT_STYLE };
  },

  /** True when the user holds one of the roles in this business, on a membership that has not ended. */
  async hasRole(db: Executor, businessId: string, userId: string, roles: readonly MembershipRole[]): Promise<boolean> {
    if (roles.length === 0) return false;
    const rows = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId), inArray(memberships.role, [...roles]), notEnded))
      .limit(1);
    return rows.length > 0;
  },

  /** Account-scoped: every membership of a user that has not ended. */
  async listForUser(db: Executor, userId: string): Promise<Membership[]> {
    return db.select().from(memberships).where(and(eq(memberships.userId, userId), notEnded)).orderBy(asc(memberships.createdAt));
  },

  /**
   * Adds a new member. Never touches an existing membership (an invitation that upserted could demote the owner or
   * rewrite anyone's permissions): a user who already belongs to the business is a ConflictError; change their role
   * with `setRole` instead.
   */
  async add(db: Executor, businessId: string, input: AddMembershipInput): Promise<Membership> {
    const v = parseInput(AddMembershipInput, input, "membership");
    const rows = await db
      .insert(memberships)
      .values({ businessId, userId: v.userId, role: v.role, sectionPermissions: v.sectionPermissions, source: v.source })
      .onConflictDoNothing({ target: [memberships.businessId, memberships.userId] })
      .returning();
    if (rows.length === 0) throw new ConflictError("That person is already a member of this business; change their role instead", { userId: v.userId });
    return one(rows, "membership");
  },

  /**
   * Gives an ended membership (a collaborator whose access date passed) a new start: the role and section rules of the
   * invitation the person accepted, no end date, `source: "invite"`. Only a row that has ended changes: the row, or null
   * when there was none to renew (the person still belongs, or never did). Service connection (an invitation's accept).
   */
  async renewEnded(db: Executor, businessId: string, userId: string, input: { role: MembershipRole; sectionPermissions: SectionPermissions }): Promise<Membership | null> {
    const role = parseInput(z.enum(MEMBERSHIP_ROLES), input.role, "role");
    const sectionPermissions = parseInput(SectionPermissions, input.sectionPermissions, "section permissions");
    const rows = await db
      .update(memberships)
      .set({ role, sectionPermissions, expiresAt: null, source: "invite" })
      .where(and(eq(memberships.businessId, parseInput(Id, businessId, "business id")), eq(memberships.userId, parseInput(Id, userId, "user id")), sql`${memberships.expiresAt} is not null and ${memberships.expiresAt} <= now()`))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * "Explore an example" (0065; docs/UX_AUDIT_AND_PLAN.md §12 item 5): gives the user a viewer membership of the example
   * business with `source: "example"`. Idempotent: an example membership that already exists comes back as it is
   * (`created: false`). Someone who belongs to the business for real (any other source) is refused with a ConflictError:
   * their real seat is never rewritten into an example one, and they open the business from Switch business instead.
   * Service connection only: the memberships insert policy lets nobody give themselves a membership.
   */
  async openExample(db: Executor, businessId: string, userId: string): Promise<{ membership: Membership; created: boolean }> {
    const bid = parseInput(Id, businessId, "business id");
    const uid = parseInput(Id, userId, "user id");
    const rows = await db
      .insert(memberships)
      .values({ businessId: bid, userId: uid, role: "viewer", sectionPermissions: {}, source: "example" })
      .onConflictDoNothing({ target: [memberships.businessId, memberships.userId] })
      .returning();
    if (rows[0]) return { membership: rows[0], created: true };
    const existing = await membershipsRepo.get(db, bid, uid);
    if (!existing) throw new ConflictError("The example business could not be opened; try again");
    if (existing.source !== "example") throw new ConflictError(ALREADY_A_MEMBER_OF_EXAMPLE, { businessId: bid, role: existing.role });
    return { membership: existing, created: false };
  },

  /**
   * Leaves the example (0065): deletes the user's own membership of the business only when it is an example one, so a
   * real seat (an invitation, the founder's own) is never removed by this path. Returns the row that was removed, or
   * null when there was no example membership to leave (already left, or never opened).
   */
  async leaveExample(db: Executor, businessId: string, userId: string): Promise<Membership | null> {
    const bid = parseInput(Id, businessId, "business id");
    const uid = parseInput(Id, userId, "user id");
    const rows = await db
      .delete(memberships)
      .where(and(eq(memberships.businessId, bid), eq(memberships.userId, uid), eq(memberships.source, "example")))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Holds the business's owner lock until the transaction ends: the lock 0035's keep-owner trigger takes before it counts
   * owners (re-entrant within one transaction). Two owners demoting or removing each other at the same moment are
   * judged one after the other, so the second sees the first one's change and the business keeps an owner. The key is
   * the id as Postgres writes it (`::uuid::text`, lowercase), the trigger's `business_id::text`, however it was typed.
   */
  async lockOwners(db: Executor, businessId: string): Promise<void> {
    const id = parseInput(Id, businessId, "business id");
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('memberships_owner'), hashtext(${id}::uuid::text))`);
  },

  /**
   * Changes a member's role. The last person with an owner's standing cannot lose it: a business always keeps at least
   * one owner or cofounder. An end date stays only on a collaborator (0092): another role clears it.
   */
  async setRole(db: Executor, businessId: string, userId: string, role: MembershipRole): Promise<Membership> {
    const r = parseInput(z.enum(MEMBERSHIP_ROLES), role, "role");
    return db.transaction(async (tx) => {
      // Lock before reading, so the owner count below is not a stale one (security review S9).
      await membershipsRepo.lockOwners(tx, businessId);
      const target = await membershipsRepo.get(tx, businessId, userId);
      if (target && isOwnerRole(target.role) && !isOwnerRole(r)) {
        const owners = await membershipsRepo.list(tx, businessId, { roles: OWNER_ROLES });
        if (owners.length <= 1) throw new ValidationError("A business must keep at least one owner");
      }
      return one(await tx.update(memberships).set(r === "collaborator" ? { role: r } : { role: r, expiresAt: null }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(), "membership", userId);
    });
  },

  /** When a collaborator's access ends (null: no end). Only a collaborator's row takes a date (0092's check says the same). */
  async setExpiry(db: Executor, businessId: string, userId: string, expiresAt: Date | null): Promise<Membership> {
    const at = parseInput(z.date().nullable(), expiresAt, "end date");
    const target = await membershipsRepo.get(db, businessId, userId);
    if (!target) return one([], "membership", userId);
    if (at && target.role !== "collaborator") throw new ValidationError("Only a collaborator's access has an end date");
    return one(await db.update(memberships).set({ expiresAt: at }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(), "membership", userId);
  },

  async setSectionPermissions(db: Executor, businessId: string, userId: string, sectionPermissions: SectionPermissions): Promise<Membership> {
    const p = parseInput(SectionPermissions, sectionPermissions, "section permissions");
    return one(
      await db.update(memberships).set({ sectionPermissions: p }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(),
      "membership",
      userId,
    );
  },

  /** Removes the user from the business. The last owner (or cofounder) cannot be removed. */
  async remove(db: Executor, businessId: string, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await membershipsRepo.lockOwners(tx, businessId);
      const target = await membershipsRepo.get(tx, businessId, userId);
      if (!target) return;
      if (isOwnerRole(target.role)) {
        const owners = await membershipsRepo.list(tx, businessId, { roles: OWNER_ROLES });
        if (owners.length <= 1) throw new ValidationError("A business must keep at least one owner");
      }
      await tx.delete(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)));
    });
  },
};
