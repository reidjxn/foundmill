/** playbooks — natural-language rules compiled to {trigger, steps, approvals, stop} (BUILD §11.13). */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { playbooks, type Playbook } from "../schema";
import { changes, Id, one, parseInput, type Executor, patchSchema } from "./_shared";

export const CompiledPlaybook = z.object({
  trigger: z.record(z.string(), z.unknown()),
  steps: z.array(z.record(z.string(), z.unknown())),
  approvals: z.array(z.record(z.string(), z.unknown())).default([]),
  stop: z.record(z.string(), z.unknown()).default({}),
});
export type CompiledPlaybook = z.infer<typeof CompiledPlaybook>;

export const CreatePlaybookInput = z.object({
  departmentId: Id.nullable().optional(),
  name: z.string().trim().max(120).default(""),
  sourceText: z.string().trim().min(1),
  compiled: CompiledPlaybook.optional(),
  enabled: z.boolean().default(false),
  createdBy: Id.nullable().optional(),
});
export type CreatePlaybookInput = z.input<typeof CreatePlaybookInput>;

export const UpdatePlaybookInput = patchSchema(CreatePlaybookInput.omit({ createdBy: true }));
export type UpdatePlaybookInput = z.input<typeof UpdatePlaybookInput>;

const scoped = (businessId: string, id: string) => and(eq(playbooks.businessId, businessId), eq(playbooks.id, id));

export const playbooksRepo = {
  async list(db: Executor, businessId: string, filter: { departmentId?: string; enabled?: boolean } = {}): Promise<Playbook[]> {
    return db
      .select()
      .from(playbooks)
      .where(
        and(
          eq(playbooks.businessId, businessId),
          isNull(playbooks.archivedAt),
          filter.departmentId ? eq(playbooks.departmentId, filter.departmentId) : undefined,
          filter.enabled === undefined ? undefined : eq(playbooks.enabled, filter.enabled),
        ),
      )
      .orderBy(asc(playbooks.createdAt));
  },

  async get(db: Executor, businessId: string, playbookId: string): Promise<Playbook> {
    return one(await db.select().from(playbooks).where(scoped(businessId, playbookId)).limit(1), "playbook", playbookId);
  },

  async create(db: Executor, businessId: string, input: CreatePlaybookInput): Promise<Playbook> {
    const v = parseInput(CreatePlaybookInput, input, "playbook");
    return one(
      await db
        .insert(playbooks)
        .values({ businessId, departmentId: v.departmentId ?? null, name: v.name, sourceText: v.sourceText, compiled: v.compiled ?? {}, enabled: v.enabled, createdBy: v.createdBy ?? null })
        .returning(),
      "playbook",
    );
  },

  async update(db: Executor, businessId: string, playbookId: string, input: UpdatePlaybookInput): Promise<Playbook> {
    const v = parseInput(UpdatePlaybookInput, input, "playbook update");
    return one(await db.update(playbooks).set(changes(v, "playbook")).where(scoped(businessId, playbookId)).returning(), "playbook", playbookId);
  },

  async setEnabled(db: Executor, businessId: string, playbookId: string, enabled: boolean): Promise<Playbook> {
    return playbooksRepo.update(db, businessId, playbookId, { enabled });
  },

  async markRun(db: Executor, businessId: string, playbookId: string, at: Date = new Date()): Promise<Playbook> {
    return one(await db.update(playbooks).set({ lastRunAt: at }).where(scoped(businessId, playbookId)).returning(), "playbook", playbookId);
  },

  async archive(db: Executor, businessId: string, playbookId: string): Promise<Playbook> {
    return one(await db.update(playbooks).set({ archivedAt: new Date(), enabled: false }).where(scoped(businessId, playbookId)).returning(), "playbook", playbookId);
  },
};
