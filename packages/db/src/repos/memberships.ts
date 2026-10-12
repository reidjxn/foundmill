/** memberships — staff of a club (BUILD §7.1; routers team.humans.*). */
import { MEMBERSHIP_ROLES, ValidationError, type MembershipRole } from "@foundmill/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { businesses, memberships, type Business, type Membership } from "../schema";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";

export const SectionPermissions = z.record(z.string(), z.enum(["read", "write", "none"]));
export type SectionPermissions = z.infer<typeof SectionPermissions>;

export const AddMembershipInput = z.object({
  userId: Id,
  role: z.enum(MEMBERSHIP_ROLES),
  sectionPermissions: SectionPermissions.default({}),
});
export type AddMembershipInput = z.input<typeof AddMembershipInput>;

export const membershipsRepo = {
  async list(db: Executor, businessId: string, filter: { role?: MembershipRole } = {}): Promise<Membership[]> {
    return db
      .select()
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), filter.role ? eq(memberships.role, filter.role) : undefined))
      .orderBy(asc(memberships.createdAt));
  },

  async get(db: Executor, businessId: string, userId: string): Promise<Membership | null> {
    return maybeOne(await db.select().from(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).limit(1));
  },

  /**
   * What apps/api's `businessProcedure` checks before every procedure: the user's membership and the business, in one
   * statement (one round trip pair instead of two lookups on two connections). No membership: both null, whether or
   * not the business exists, so a non-member learns nothing about it. A membership of an archived business comes back
   * with a null business, as `businesses.get` would not find it.
   */
  async access(db: Executor, businessId: string, userId: string): Promise<{ membership: Membership | null; business: Business | null }> {
    const rows = await db
      .select({ membership: memberships, business: businesses })
      .from(memberships)
      .leftJoin(businesses, and(eq(businesses.id, memberships.businessId), isNull(businesses.archivedAt)))
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

  /** Adds a member; re-adding an existing user updates the role and permissions. */
  async add(db: Executor, businessId: string, input: AddMembershipInput): Promise<Membership> {
    const v = parseInput(AddMembershipInput, input, "membership");
    const rows = await db
      .insert(memberships)
      .values({ businessId, userId: v.userId, role: v.role, sectionPermissions: v.sectionPermissions })
      .onConflictDoUpdate({
        target: [memberships.businessId, memberships.userId],
        set: { role: v.role, sectionPermissions: v.sectionPermissions },
      })
      .returning();
    return one(rows, "membership");
  },

  async setRole(db: Executor, businessId: string, userId: string, role: MembershipRole): Promise<Membership> {
    const r = parseInput(z.enum(MEMBERSHIP_ROLES), role, "role");
    return one(await db.update(memberships).set({ role: r }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(), "membership", userId);
  },

  async setSectionPermissions(db: Executor, businessId: string, userId: string, sectionPermissions: SectionPermissions): Promise<Membership> {
    const p = parseInput(SectionPermissions, sectionPermissions, "section permissions");
    return one(
      await db.update(memberships).set({ sectionPermissions: p }).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))).returning(),
      "membership",
      userId,
    );
  },

  /** Removes the user from the club. The last owner cannot be removed. */
  async remove(db: Executor, businessId: string, userId: string): Promise<void> {
    const target = await membershipsRepo.get(db, businessId, userId);
    if (!target) return;
    if (target.role === "owner") {
      const owners = await membershipsRepo.list(db, businessId, { role: "owner" });
      if (owners.length <= 1) throw new ValidationError("A business must keep at least one owner");
    }
    await db.delete(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId)));
  },
};
