/** departments + department_members (BUILD §11.13; routers department.*). Departments are labels over modules. */
import { departmentLetters, DEPT_COLOUR_TOKENS, isDepartmentShortcut, MODULE_KEYS, slugify, ValidationError } from "@foundmill/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { departmentMembers, departments, MEMBER_KINDS, screenDefinitions, type Department, type DepartmentMember } from "../schema";
import { Currency, defined, Id, JsonArray, maybeOne, MinorAmount, one, parseInput, type Executor, patchSchema } from "./_shared";

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

/**
 * Gives every live department a stored G-chord letter (0040). Letters already stored stay; the others take the first
 * free letter of their name (`departmentLetters`, the shell's own rule). Visible departments go first, in sidebar
 * order, so a business from before 0040 keeps exactly the letters its sidebar showed; hidden ones follow. Called on
 * every change that can add, rename or remove a department, so renaming one never moves another's letter.
 */
async function settleShortcuts(db: Executor, businessId: string): Promise<void> {
  const rows = await db
    .select({ id: departments.id, name: departments.name, shortcut: departments.shortcut })
    .from(departments)
    .where(live(businessId))
    .orderBy(asc(departments.hidden), asc(departments.position), asc(departments.name));
  const letters = departmentLetters(rows);
  for (const d of rows) {
    const letter = letters.get(d.id) ?? null;
    // Only empty slots are filled: stored letters are valid and unique by constraint, so they come back unchanged.
    if (d.shortcut !== letter) await db.update(departments).set({ shortcut: letter }).where(and(eq(departments.businessId, businessId), eq(departments.id, d.id)));
  }
}

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
    const created = one(
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
    // The new department takes the first free letter of its name; the others keep theirs.
    await settleShortcuts(db, businessId);
    return departmentsRepo.get(db, businessId, created.id);
  },

  async update(db: Executor, businessId: string, departmentId: string, input: UpdateDepartmentInput): Promise<Department> {
    const v = parseInput(UpdateDepartmentInput, input, "department update");
    if (v.name === undefined) return one(await db.update(departments).set(defined(v)).where(and(eq(departments.businessId, businessId), eq(departments.id, departmentId))).returning(), "department", departmentId);
    // A rename re-derives this department's letter from its new name (AC-11.13.1) unless the founder chose it; every
    // other department keeps the letter it has now, stored first for a business that has none stored yet.
    await settleShortcuts(db, businessId);
    const current = await departmentsRepo.get(db, businessId, departmentId);
    const patch = { ...defined(v), ...(current.name !== v.name && !current.shortcutChosen ? { shortcut: null } : {}) };
    await db.update(departments).set(patch).where(and(eq(departments.businessId, businessId), eq(departments.id, departmentId)));
    await settleShortcuts(db, businessId);
    return departmentsRepo.get(db, businessId, departmentId);
  },

  /**
   * The founder's own letter for a department (Settings › Departments), or `null` to go back to the automatic one. A
   * letter another department holds is swapped: that department takes this one's previous letter.
   */
  async setShortcut(db: Executor, businessId: string, departmentId: string, letter: string | null): Promise<Department> {
    const wanted = letter === null ? null : letter.trim().toUpperCase();
    if (wanted !== null && !isDepartmentShortcut(wanted)) throw new ValidationError("A shortcut is one letter from A to Z other than G, H, I and C (G starts the chord; H, I and C open Home, Inbox and CRM)", { letter });
    return db.transaction(async (tx) => {
      await settleShortcuts(tx, businessId);
      const dept = await departmentsRepo.get(tx, businessId, departmentId);
      if (dept.archivedAt) throw new ValidationError("An archived department has no shortcut", { departmentId });
      const where = (id: string) => and(eq(departments.businessId, businessId), eq(departments.id, id));
      if (wanted === null) {
        await tx.update(departments).set({ shortcut: null, shortcutChosen: false }).where(where(departmentId));
      } else if (wanted !== dept.shortcut) {
        const holder = maybeOne(await tx.select({ id: departments.id }).from(departments).where(and(live(businessId), eq(departments.shortcut, wanted))).limit(1));
        // One letter per live department (a unique index): free it, take it, then hand the holder this one's old letter.
        if (holder) await tx.update(departments).set({ shortcut: null, shortcutChosen: false }).where(where(holder.id));
        await tx.update(departments).set({ shortcut: wanted, shortcutChosen: true }).where(where(departmentId));
        if (holder && dept.shortcut) await tx.update(departments).set({ shortcut: dept.shortcut }).where(where(holder.id));
      } else {
        await tx.update(departments).set({ shortcutChosen: true }).where(where(departmentId));
      }
      await settleShortcuts(tx, businessId);
      return departmentsRepo.get(tx, businessId, departmentId);
    });
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
      // Its letter goes back to the pool for the next department that needs one.
      return one(await tx.update(departments).set({ archivedAt: now, hidden: true, shortcut: null, shortcutChosen: false }).where(and(eq(departments.businessId, businessId), eq(departments.id, departmentId))).returning(), "department", departmentId);
    });
  },

  /**
   * Merge: moves members and module keys of `fromId` into `intoId`, then archives `fromId`.
   * Screens of the merged department are archived (the target keeps its own tabs).
   */
  async merge(db: Executor, businessId: string, fromId: string, intoId: string): Promise<Department> {
    if (fromId === intoId) throw new ValidationError("Cannot merge a department into itself");
    return db.transaction(async (tx) => {
      const from = await departmentsRepo.get(tx, businessId, fromId);
      const into = await departmentsRepo.get(tx, businessId, intoId);
      const moduleKeys = parseInput(z.array(z.enum(MODULE_KEYS)), Array.from(new Set([...into.moduleKeys, ...from.moduleKeys])), "module keys");
      const members = await departmentsRepo.listMembers(tx, businessId, fromId);
      for (const m of members) await departmentsRepo.addMember(tx, businessId, intoId, { memberKind: m.memberKind, memberId: m.memberId });
      await departmentsRepo.archive(tx, businessId, fromId);
      return departmentsRepo.update(tx, businessId, intoId, { moduleKeys });
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
