/** departments + department_members (BUILD §11.13; routers department.*). Departments are labels over modules. */
import { DEPT_COLOUR_TOKENS, MODULE_KEYS, slugify, ValidationError } from "@foundmill/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, departmentMembers, departments, MEMBER_KINDS, screenDefinitions, tasks, type Department, type DepartmentMember } from "../schema";
import { Currency, changes, Id, JsonArray, maybeOne, MinorAmount, one, parseInput, type Executor, patchSchema } from "./_shared";

export const CreateDepartmentInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  icon: z.string().max(60).default("folder"),
  colourToken: z.enum(DEPT_COLOUR_TOKENS).default("dept-1"),
  position: z.number().int().min(0).optional(),
  leadAgentId: Id.nullable().optional(),
  moduleKeys: z.array(z.enum(MODULE_KEYS)).default([]),
  budgetMinor: MinorAmount.nullable().optional(),
  currency: Currency.optional(),
  approvers: JsonArray.default([]),
  hidden: z.boolean().default(false),
});
export type CreateDepartmentInput = z.input<typeof CreateDepartmentInput>;

export const UpdateDepartmentInput = patchSchema(CreateDepartmentInput);
export type UpdateDepartmentInput = z.input<typeof UpdateDepartmentInput>;

const live = (businessId: string) => and(eq(departments.businessId, businessId), isNull(departments.archivedAt));

export const departmentsRepo = {
  async list(db: Executor, businessId: string, options: { includeHidden?: boolean; includeArchived?: boolean } = {}): Promise<Department[]> {
    return db
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.businessId, businessId),
          options.includeArchived ? undefined : isNull(departments.archivedAt),
          options.includeHidden ? undefined : eq(departments.hidden, false),
        ),
      )
      .orderBy(asc(departments.position), asc(departments.createdAt));
  },

  async get(db: Executor, businessId: string, departmentId: string): Promise<Department> {
    return one(await db.select().from(departments).where(and(eq(departments.businessId, businessId), eq(departments.id, departmentId))).limit(1), "department", departmentId);
  },

  async getBySlug(db: Executor, businessId: string, slug: string): Promise<Department | null> {
    return maybeOne(await db.select().from(departments).where(and(live(businessId), eq(departments.slug, slug))).limit(1));
  },

  async create(db: Executor, businessId: string, input: CreateDepartmentInput): Promise<Department> {
    const v = parseInput(CreateDepartmentInput, input, "department");
    const position = v.position ?? Number(one(await db.select({ n: sql<number>`coalesce(max(${departments.position}), -1) + 1` }).from(departments).where(live(businessId)), "position").n);
    return one(
      await db
        .insert(departments)
        .values({
          businessId,
          name: v.name,
          slug: v.slug ?? slugify(v.name),
          icon: v.icon,
          colourToken: v.colourToken,
          position,
          leadAgentId: v.leadAgentId ?? null,
          moduleKeys: v.moduleKeys,
          budgetMinor: v.budgetMinor ?? null,
          ...(v.currency ? { currency: v.currency } : {}),
          approvers: v.approvers,
          hidden: v.hidden,
        })
        .returning(),
      "department",
    );
  },

  async update(db: Executor, businessId: string, departmentId: string, input: UpdateDepartmentInput): Promise<Department> {
    const v = parseInput(UpdateDepartmentInput, input, "department update");
    return one(await db.update(departments).set(changes(v, "department")).where(and(eq(departments.businessId, businessId), eq(departments.id, departmentId))).returning(), "department", departmentId);
  },

  async setLead(db: Executor, businessId: string, departmentId: string, leadAgentId: string | null): Promise<Department> {
    return departmentsRepo.update(db, businessId, departmentId, { leadAgentId });
  },

  /** Reorders the sidebar: ids in display order; every id must belong to the business. */
  async reorder(db: Executor, businessId: string, orderedIds: string[]): Promise<Department[]> {
    const ids = parseInput(z.array(Id).min(1), orderedIds, "department order");
    return db.transaction(async (tx) => {
      const owned = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.businessId, businessId), inArray(departments.id, ids)));
      if (owned.length !== new Set(ids).size) throw new ValidationError("Every department must belong to the business", { orderedIds });
      for (const [i, id] of ids.entries()) {
        await tx.update(departments).set({ position: i }).where(and(eq(departments.businessId, businessId), eq(departments.id, id)));
      }
      return departmentsRepo.list(tx, businessId, { includeHidden: true });
    });
  },

  /** Archives a department and its screens; members rows are kept for history. */
  async archive(db: Executor, businessId: string, departmentId: string): Promise<Department> {
    return db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(screenDefinitions).set({ archivedAt: now }).where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.departmentId, departmentId)));
      return one(await tx.update(departments).set({ archivedAt: now, hidden: true }).where(and(eq(departments.businessId, businessId), eq(departments.id, departmentId))).returning(), "department", departmentId);
    });
  },

  /**
   * Merge: moves members and module keys of `fromId` into `intoId`, then archives `fromId`. Its agents move across
   * (`agents.department_ids`, which every screen, wage total and the cycle read), its tasks follow, and its lead
   * becomes the target's lead when the target has none. Screens of the merged department are archived (the target
   * keeps its own tabs).
   */
  async merge(db: Executor, businessId: string, fromId: string, intoId: string): Promise<Department> {
    if (fromId === intoId) throw new ValidationError("Cannot merge a department into itself");
    return db.transaction(async (tx) => {
      const from = await departmentsRepo.get(tx, businessId, fromId);
      const into = await departmentsRepo.get(tx, businessId, intoId);
      if (from.archivedAt || into.archivedAt) throw new ValidationError("Only live departments can be merged", { fromId, intoId });
      const moduleKeys = parseInput(z.array(z.enum(MODULE_KEYS)), Array.from(new Set([...into.moduleKeys, ...from.moduleKeys])), "module keys");
      const members = await departmentsRepo.listMembers(tx, businessId, fromId);
      for (const m of members) await departmentsRepo.addMember(tx, businessId, intoId, { memberKind: m.memberKind, memberId: m.memberId });
      // `fromId` becomes `intoId` in each agent's departments, once, in the same place (an agent in both keeps one).
      await tx
        .update(agents)
        .set({ departmentIds: sql`array(select t.d from unnest(array_replace(${agents.departmentIds}, ${fromId}::uuid, ${intoId}::uuid)) with ordinality as t(d, i) group by t.d order by min(t.i))` })
        .where(and(eq(agents.businessId, businessId), sql`${agents.departmentIds} @> array[${fromId}::uuid]`));
      await tx.update(tasks).set({ departmentId: intoId }).where(and(eq(tasks.businessId, businessId), eq(tasks.departmentId, fromId)));
      const fromLead = into.leadAgentId === null && from.leadAgentId !== null ? maybeOne(await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, from.leadAgentId), isNull(agents.archivedAt))).limit(1)) : null;
      await departmentsRepo.archive(tx, businessId, fromId);
      return departmentsRepo.update(tx, businessId, intoId, { moduleKeys, ...(fromLead ? { leadAgentId: fromLead.id } : {}) });
    });
  },

  /** Split: creates a new department carrying `moduleKeys` taken from `sourceId`. */
  async split(db: Executor, businessId: string, sourceId: string, input: CreateDepartmentInput): Promise<{ source: Department; created: Department }> {
    return db.transaction(async (tx) => {
      const source = await departmentsRepo.get(tx, businessId, sourceId);
      const created = await departmentsRepo.create(tx, businessId, input);
      const remaining = source.moduleKeys.filter((k) => !created.moduleKeys.includes(k));
      const updated = await departmentsRepo.update(tx, businessId, sourceId, { moduleKeys: remaining as (typeof MODULE_KEYS)[number][] });
      return { source: updated, created };
    });
  },

  // members -----------------------------------------------------------------------------------------------------------
  async listMembers(db: Executor, businessId: string, departmentId: string): Promise<DepartmentMember[]> {
    return db.select().from(departmentMembers).where(and(eq(departmentMembers.businessId, businessId), eq(departmentMembers.departmentId, departmentId))).orderBy(asc(departmentMembers.createdAt));
  },

  /** Several memberships in one statement; every department must belong to the business (checked in one query). */
  async addMembers(db: Executor, businessId: string, inputs: { departmentId: string; memberKind: (typeof MEMBER_KINDS)[number]; memberId: string }[]): Promise<DepartmentMember[]> {
    if (inputs.length === 0) return [];
    const list = inputs.map((i) => parseInput(z.object({ departmentId: Id, memberKind: z.enum(MEMBER_KINDS), memberId: Id }), i, "department member"));
    const ids = [...new Set(list.map((v) => v.departmentId))];
    const owned = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.businessId, businessId), inArray(departments.id, ids)));
    if (owned.length !== ids.length) throw new ValidationError("Every department must belong to the business", { departmentIds: ids });
    const unique = [...new Map(list.map((v) => [`${v.departmentId}/${v.memberKind}/${v.memberId}`, v] as const)).values()];
    return db
      .insert(departmentMembers)
      .values(unique.map((v) => ({ businessId, departmentId: v.departmentId, memberKind: v.memberKind, memberId: v.memberId })))
      .onConflictDoUpdate({ target: [departmentMembers.departmentId, departmentMembers.memberKind, departmentMembers.memberId], set: { businessId } })
      .returning();
  },

  async addMember(db: Executor, businessId: string, departmentId: string, input: { memberKind: (typeof MEMBER_KINDS)[number]; memberId: string }): Promise<DepartmentMember> {
    const v = parseInput(z.object({ memberKind: z.enum(MEMBER_KINDS), memberId: Id }), input, "department member");
    await departmentsRepo.get(db, businessId, departmentId);
    return one(
      await db
        .insert(departmentMembers)
        .values({ businessId, departmentId, memberKind: v.memberKind, memberId: v.memberId })
        .onConflictDoUpdate({ target: [departmentMembers.departmentId, departmentMembers.memberKind, departmentMembers.memberId], set: { businessId } })
        .returning(),
      "department member",
    );
  },

  async removeMember(db: Executor, businessId: string, departmentId: string, memberId: string): Promise<void> {
    await db.delete(departmentMembers).where(and(eq(departmentMembers.businessId, businessId), eq(departmentMembers.departmentId, departmentId), eq(departmentMembers.memberId, memberId)));
  },
};
