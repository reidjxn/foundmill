/**
 * memberships — staff of a business (BUILD §7.1; routers team.humans.*).
 *
 * Ownership is guarded here, in apps/api and in the database (0026_membership_guards): `add` never overwrites an
 * existing member, and neither `setRole` nor `remove` may leave a business without an owner. Both run under the
 * business's owner lock (`lockOwners`, the same lock 0035's trigger takes), so concurrent changes cannot each count the
 * other as the remaining owner.
 */
import { ConflictError, MEMBERSHIP_ROLES, ValidationError, type MembershipRole } from "@foundmill/shared";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { businesses, entities, memberships, MEMBERSHIP_SOURCES, type Business, type Membership } from "../schema";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";

export const SectionPermissions = z.record(z.string(), z.enum(["read", "write", "none"]));
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

export const membershipsRepo = {
  /**
   * The business's staff: every membership but the example viewers (0065), who are not staff, hold no seat and are
   * never listed to the owner. `includeExample` lists them too (counts, the cross-tenant suite).
   */
  async list(db: Executor, businessId: string, filter: { role?: MembershipRole; includeExample?: boolean } = {}): Promise<Membership[]> {
    return db
      .select()
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), filter.role ? eq(memberships.role, filter.role) : undefined, filter.includeExample ? undefined : notExample))
      .orderBy(asc(memberships.createdAt));
  },

  /**
   * The business's founder as the screens show it: the owner who created the business while they still own it, else
   * the longest-standing owner. The org chart is rooted at this person and agents with no line manager report to them.
   */
  async owner(db: Executor, businessId: string): Promise<Membership | null> {
    return maybeOne(
      await db
        .select({ m: memberships })
        .from(memberships)
        .innerJoin(businesses, eq(businesses.id, memberships.businessId))
        .where(and(eq(memberships.businessId, businessId), eq(memberships.role, "owner")))
        .orderBy(sql`(${memberships.userId} = ${businesses.createdBy}) desc`, asc(memberships.createdAt), asc(memberships.id))
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
   * What apps/api's `businessProcedure` checks before every procedure: the user's membership and the business, in one
   * statement (one round trip pair instead of two lookups on two connections). No membership: both null, whether or
   * not the business exists, so a non-member learns nothing about it. A membership of an archived business comes back
   * with a null business, as `businesses.get` would not find it, unless `includeArchived` (the few things an archived
   * business still allows: restore, export, deletion requests).
   */
  async access(db: Executor, businessId: string, userId: string, options: { includeArchived?: boolean } = {}): Promise<{ membership: Membership | null; business: Business | null }> {
    const rows = await db
      .select({ membership: memberships, business: businesses })
      .from(memberships)
      .leftJoin(businesses, options.includeArchived ? eq(businesses.id, memberships.businessId) : and(eq(businesses.id, memberships.businessId), isNull(businesses.archivedAt)))
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row ? { membership: row.membership, business: row.business } : { membership: null, business: null };
  },

  /** True when the user holds one of the roles in this business. */
  async hasRole(db: Executor, businessId: string, userId: string, roles: readonly MembershipRole[]): Promise<boolean> {
    if (roles.length === 0) return false;
    const rows = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId), inArray(memberships.role, [...roles])))
      .limit(1);
    return rows.length > 0;
  },

  /** Account-scoped: every membership of a user. */
  async listForUser(db: Executor, userId: string): Promise<Membership[]> {
    return db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt));
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

  /** Changes a member's role. The last owner cannot be demoted: a business always keeps at least one owner. */
  async setRole(db: Executor, businessId: string, userId: string, role: MembershipRole): Promise<Membership> {
    const r = parseInput(z.enum(MEMBERSHIP_ROLES), role, "role");
    return db.transaction(async (tx) => {
      // Lock before reading, so the owner count below is not a stale one (security review S9).
      await membershipsRepo.lockOwners(tx, businessId);
      const target = await membershipsRepo.get(tx, businessId, userId);
      if (target?.role === "owner" && r !== "owner") {
        const owners = await membershipsRepo.list(tx, businessId, { role: "owner" });
        if (owners.length <= 1) throw new ValidationError("A business must keep at least one owner");
      }
      return one(await tx.update(memberships).set({ role: r }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(), "membership", userId);
    });
  },

  async setSectionPermissions(db: Executor, businessId: string, userId: string, sectionPermissions: SectionPermissions): Promise<Membership> {
    const p = parseInput(SectionPermissions, sectionPermissions, "section permissions");
    return one(
      await db.update(memberships).set({ sectionPermissions: p }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(),
      "membership",
      userId,
    );
  },

  /** Removes the user from the business. The last owner cannot be removed. */
  async remove(db: Executor, businessId: string, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await membershipsRepo.lockOwners(tx, businessId);
      const target = await membershipsRepo.get(tx, businessId, userId);
      if (!target) return;
      if (target.role === "owner") {
        const owners = await membershipsRepo.list(tx, businessId, { role: "owner" });
        if (owners.length <= 1) throw new ValidationError("A business must keep at least one owner");
      }
      await tx.delete(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)));
    });
  },
};
