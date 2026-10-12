/**
 * memberships — staff of a business (BUILD §7.1; routers team.humans.*).
 *
 * Ownership is guarded here, in apps/api and in the database (0026_membership_guards): `add` never overwrites an
 * existing member, and neither `setRole` nor `remove` may leave a business without an owner.
 */
import { ConflictError, MEMBERSHIP_ROLES, ValidationError, type MembershipRole } from "@foundmill/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { memberships, type Membership } from "../schema";
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
      .values({ businessId, userId: v.userId, role: v.role, sectionPermissions: v.sectionPermissions })
      .onConflictDoNothing({ target: [memberships.businessId, memberships.userId] })
      .returning();
    if (rows.length === 0) throw new ConflictError("That person is already a member of this business; change their role instead", { userId: v.userId });
    return one(rows, "membership");
  },

  /** Changes a member's role. The last owner cannot be demoted: a business always keeps at least one owner. */
  async setRole(db: Executor, businessId: string, userId: string, role: MembershipRole): Promise<Membership> {
    const r = parseInput(z.enum(MEMBERSHIP_ROLES), role, "role");
    const target = await membershipsRepo.get(db, businessId, userId);
    if (target?.role === "owner" && r !== "owner") {
      const owners = await membershipsRepo.list(db, businessId, { role: "owner" });
      if (owners.length <= 1) throw new ValidationError("A business must keep at least one owner");
    }
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

  /** Removes the user from the business. The last owner cannot be removed. */
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
