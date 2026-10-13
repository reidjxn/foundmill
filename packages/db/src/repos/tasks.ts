/** tasks + task_edges — the Development Plan graph (BUILD §11.6; routers dev.tasks.*). */
import { PLANNABLE_TASK_STATUSES, TASK_KINDS, TASK_PHASES, TASK_STATUSES, ValidationError, type TaskStatus } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { taskEdges, tasks, type Task, type TaskEdge } from "../schema";
import { Currency, defined, Id, JsonArray, MinorAmount, numericText, one, PageInput, parseInput, rowsOf, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";

export const CreateTaskInput = z.object({
  kind: z.enum(TASK_KINDS),
  title: z.string().trim().min(1).max(200),
  goalMd: z.string().default(""),
  acceptance: JsonArray.default([]),
  fileScope: z.array(z.string().max(400)).default([]),
  roadmapItemId: Id.nullable().optional(),
  departmentId: Id.nullable().optional(),
  assigneeAgentId: Id.nullable().optional(),
  planActionId: Id.nullable().optional(),
  status: z.enum(TASK_STATUSES).default("planned"),
  phase: z.enum(TASK_PHASES).nullable().optional(),
  eta: z.coerce.date().nullable().optional(),
  priority: z.number().int().default(0),
  budgetMinor: MinorAmount.nullable().optional(),
  currency: Currency.optional(),
  /** Tasks this one depends on (edges from_task = dependency → to_task = this). */
  dependsOn: z.array(Id).default([]),
});
export type CreateTaskInput = z.input<typeof CreateTaskInput>;

export const UpdateTaskInput = patchSchema(CreateTaskInput.omit({ dependsOn: true, kind: true, status: true }));
export type UpdateTaskInput = z.input<typeof UpdateTaskInput>;

export const TaskListFilter = PageInput.extend({
  status: z.union([z.enum(TASK_STATUSES), z.array(z.enum(TASK_STATUSES))]).optional(),
  assigneeAgentId: Id.optional(),
  kind: z.enum(TASK_KINDS).optional(),
  departmentId: Id.optional(),
  roadmapItemId: Id.optional(),
  includeArchived: z.boolean().default(false),
});
export type TaskListFilter = z.input<typeof TaskListFilter>;

/** Statuses from which a transition is allowed (BUILD §11.6 task lifecycle). */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  planned: ["ready", "running", "stopped"],
  ready: ["running", "planned", "stopped"],
  running: ["paused", "blocked", "review", "done", "failed", "stopped"],
  paused: ["running", "stopped"],
  blocked: ["running", "ready", "stopped", "failed"],
  review: ["merging", "running", "done", "failed", "stopped"],
  merging: ["done", "failed", "review"],
  done: [],
  failed: ["ready", "running"],
  stopped: ["ready"],
};

const scoped = (businessId: string, taskId: string) => and(eq(tasks.businessId, businessId), eq(tasks.id, taskId));

/** Statuses a cycle may start a task from (the orchestrator's DISPATCHABLE; apps/orchestrator retry.ts bounds the retries). */
export const PLANNABLE_STATUSES = PLANNABLE_TASK_STATUSES;

/** A planning candidate: the task, its dependencies and why it may not start now. */
export interface PlanningCandidate extends Task {
  dependsOn: string[];
  /** An unfinished dependency (anywhere in the business, however old) blocks it. */
  blocked: boolean;
  /** A session of this task holds a gated call nobody has decided yet. */
  awaitingApproval: boolean;
}

export const tasksRepo = {
  async list(db: Executor, businessId: string, filter: TaskListFilter = {}): Promise<Page<Task>> {
    const f = parseInput(TaskListFilter, filter, "task filter");
    const ks = timeKeyset<Task>(tasks.createdAt, tasks.id, (r) => ({ at: r.createdAt, id: r.id }));
    const statuses = f.status === undefined ? undefined : Array.isArray(f.status) ? f.status : [f.status];
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.businessId, businessId),
          f.includeArchived ? undefined : isNull(tasks.archivedAt),
          statuses?.length ? inArray(tasks.status, statuses) : undefined,
          f.assigneeAgentId ? eq(tasks.assigneeAgentId, f.assigneeAgentId) : undefined,
          f.kind ? eq(tasks.kind, f.kind) : undefined,
          f.departmentId ? eq(tasks.departmentId, f.departmentId) : undefined,
          f.roadmapItemId ? eq(tasks.roadmapItemId, f.roadmapItemId) : undefined,
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async get(db: Executor, businessId: string, taskId: string): Promise<Task> {
    return one(await db.select().from(tasks).where(scoped(businessId, taskId)).limit(1), "task", taskId);
  },

  async create(db: Executor, businessId: string, input: CreateTaskInput): Promise<Task> {
    const v = parseInput(CreateTaskInput, input, "task");
    return db.transaction(async (tx) => {
      const task = one(
        await tx
          .insert(tasks)
          .values({
            businessId,
            kind: v.kind,
            title: v.title,
            goalMd: v.goalMd,
            acceptance: v.acceptance,
            fileScope: v.fileScope,
            roadmapItemId: v.roadmapItemId ?? null,
            departmentId: v.departmentId ?? null,
            assigneeAgentId: v.assigneeAgentId ?? null,
            planActionId: v.planActionId ?? null,
            status: v.status,
            phase: v.phase ?? null,
            eta: v.eta ?? null,
            priority: v.priority,
            budgetMinor: v.budgetMinor ?? null,
            ...(v.currency ? { currency: v.currency } : {}),
          })
          .returning(),
        "task",
      );
      for (const dep of v.dependsOn) await tasksRepo.addEdge(tx, businessId, dep, task.id);
      return task;
    });
  },

  async update(db: Executor, businessId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const v = parseInput(UpdateTaskInput, input, "task update");
    return one(await db.update(tasks).set(defined(v)).where(scoped(businessId, taskId)).returning(), "task", taskId);
  },

  /** Moves a task through its lifecycle, enforcing TASK_TRANSITIONS; stamps started_at / ended_at. */
  async setStatus(db: Executor, businessId: string, taskId: string, status: TaskStatus, options: { force?: boolean } = {}): Promise<Task> {
    const s = parseInput(z.enum(TASK_STATUSES), status, "task status");
    return db.transaction(async (tx) => {
      const task = await tasksRepo.get(tx, businessId, taskId);
      if (task.status === s) return task;
      if (!options.force && !TASK_TRANSITIONS[task.status].includes(s)) {
        throw new ValidationError(`Task cannot move from ${task.status} to ${s}`, { taskId, from: task.status, to: s });
      }
      const now = new Date();
      const terminal = s === "done" || s === "failed" || s === "stopped";
      return one(
        await tx
          .update(tasks)
          .set({
            status: s,
            startedAt: s === "running" && !task.startedAt ? now : task.startedAt,
            endedAt: terminal ? now : null,
            ...(s === "done" ? { progress: "1", phase: "done" as const } : {}),
          })
          .where(scoped(businessId, taskId))
          .returning(),
        "task",
        taskId,
      );
    });
  },

  /**
   * Claims a task for a manual start: moves it to `running` only from one of `from`, in one conditional update, so of
   * two starts at once (a double click, two tabs) exactly one wins. Null when the task was not in one of `from`.
   */
  async claimForStart(db: Executor, businessId: string, taskId: string, from: readonly TaskStatus[]): Promise<Task | null> {
    const statuses = parseInput(z.array(z.enum(TASK_STATUSES)).min(1), [...from], "task statuses");
    const rows = await db
      .update(tasks)
      .set({ status: "running", startedAt: sql`coalesce(${tasks.startedAt}, now())`, endedAt: null })
      .where(and(scoped(businessId, taskId), isNull(tasks.archivedAt), inArray(tasks.status, statuses)))
      .returning();
    return rows[0] ?? null;
  },

  /** Titles of the tasks `taskId` depends on that are not done yet (a start waits for them). */
  async openDependencies(db: Executor, businessId: string, taskId: string): Promise<{ id: string; title: string; status: TaskStatus }[]> {
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(taskEdges)
      .innerJoin(tasks, eq(tasks.id, taskEdges.fromTask))
      .where(and(eq(taskEdges.businessId, businessId), eq(taskEdges.toTask, taskId), sql`${tasks.status} <> 'done'`, isNull(tasks.archivedAt)));
    return rows;
  },

  async setProgress(db: Executor, businessId: string, taskId: string, input: { progress: number; phase?: (typeof TASK_PHASES)[number] | null; eta?: Date | null }): Promise<Task> {
    const v = parseInput(z.object({ progress: z.number().min(0).max(1), phase: z.enum(TASK_PHASES).nullable().optional(), eta: z.coerce.date().nullable().optional() }), input, "task progress");
    return one(
      await db
        .update(tasks)
        .set({ progress: numericText(v.progress) ?? "0", ...(v.phase !== undefined ? { phase: v.phase } : {}), ...(v.eta !== undefined ? { eta: v.eta } : {}) })
        .where(scoped(businessId, taskId))
        .returning(),
      "task",
      taskId,
    );
  },

  async reassign(db: Executor, businessId: string, taskId: string, assigneeAgentId: string | null): Promise<Task> {
    return tasksRepo.update(db, businessId, taskId, { assigneeAgentId });
  },

  async archive(db: Executor, businessId: string, taskId: string): Promise<Task> {
    return one(await db.update(tasks).set({ archivedAt: new Date() }).where(scoped(businessId, taskId)).returning(), "task", taskId);
  },

  // graph -------------------------------------------------------------------------------------------------------------
  /** Edge `fromTask → toTask`: toTask depends on fromTask. Both must belong to the business; cycles are refused. */
  async addEdge(db: Executor, businessId: string, fromTask: string, toTask: string): Promise<TaskEdge> {
    if (fromTask === toTask) throw new ValidationError("A task cannot depend on itself", { fromTask });
    const owned = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.businessId, businessId), inArray(tasks.id, [fromTask, toTask])));
    if (owned.length !== 2) throw new ValidationError("Both tasks must belong to the business", { fromTask, toTask });
    if (await tasksRepo.reaches(db, businessId, toTask, fromTask)) throw new ValidationError("Edge would create a cycle", { fromTask, toTask });
    return one(
      await db.insert(taskEdges).values({ businessId, fromTask, toTask }).onConflictDoUpdate({ target: [taskEdges.fromTask, taskEdges.toTask], set: { businessId } }).returning(),
      "task edge",
    );
  },

  async removeEdge(db: Executor, businessId: string, fromTask: string, toTask: string): Promise<void> {
    await db.delete(taskEdges).where(and(eq(taskEdges.businessId, businessId), eq(taskEdges.fromTask, fromTask), eq(taskEdges.toTask, toTask)));
  },

  async listEdges(db: Executor, businessId: string, taskIds?: readonly string[]): Promise<TaskEdge[]> {
    if (taskIds && taskIds.length === 0) return [];
    return db
      .select()
      .from(taskEdges)
      .where(and(eq(taskEdges.businessId, businessId), taskIds ? or(inArray(taskEdges.fromTask, [...taskIds]), inArray(taskEdges.toTask, [...taskIds])) : undefined));
  },

  /** True when `to` is reachable from `from` following edges (used for cycle checks). */
  async reaches(db: Executor, businessId: string, from: string, to: string): Promise<boolean> {
    if (from === to) return true;
    const hits = rowsOf(
      await db.execute(sql`
        with recursive walk(id) as (
          select ${from}::uuid
          union
          select e.to_task from task_edges e join walk w on e.from_task = w.id where e.business_id = ${businessId}
        )
        select 1 as hit from walk where id = ${to}::uuid limit 1`),
    );
    return hits.length > 0;
  },

  /** The whole plan: live tasks and the edges between them (the Plan tab's DAG). */
  async graph(db: Executor, businessId: string): Promise<{ tasks: Task[]; edges: TaskEdge[] }> {
    const rows = await db.select().from(tasks).where(and(eq(tasks.businessId, businessId), isNull(tasks.archivedAt))).orderBy(asc(tasks.priority), asc(tasks.createdAt));
    const ids = rows.map((t) => t.id);
    const edges = ids.length ? await db.select().from(taskEdges).where(and(eq(taskEdges.businessId, businessId), inArray(taskEdges.toTask, ids))) : [];
    return { tasks: rows, edges };
  },

  /** Tasks ready to dispatch: status ready/planned with every dependency done. */
  async dispatchable(db: Executor, businessId: string, limit = 50): Promise<Task[]> {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.businessId, businessId),
          isNull(tasks.archivedAt),
          inArray(tasks.status, ["ready", "planned"]),
          sql`not exists (select 1 from task_edges e join tasks d on d.id = e.from_task where e.to_task = ${tasks.id} and d.status <> 'done')`,
        ),
      )
      .orderBy(asc(tasks.priority), asc(tasks.createdAt))
      .limit(limit);
  },

  /**
   * What a cycle may plan from (audit SOAK-04): every task in a dispatchable status, not one recency page of the open
   * ones, most important first and then oldest first, so the first tasks of a business never fall out of view.
   * `blocked` is computed against every unfinished dependency (an old blocker still blocks), `awaitingApproval` says a
   * session of the task holds a gated call nobody has answered yet (running it again would only wait on it again).
   */
  async planningCandidates(db: Executor, businessId: string, options: { statuses?: readonly TaskStatus[]; limit?: number } = {}): Promise<{ items: PlanningCandidate[]; total: number }> {
    const statuses = [...(options.statuses ?? PLANNABLE_STATUSES)];
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 2000);
    const where = and(eq(tasks.businessId, businessId), isNull(tasks.archivedAt), inArray(tasks.status, statuses));
    const [rows, [count]] = await Promise.all([
      db
        .select({
          task: tasks,
          dependsOn: sql<string[]>`coalesce((select array_agg(e.from_task::text) from task_edges e where e.business_id = tasks.business_id and e.to_task = tasks.id), '{}'::text[])`,
          blocked: sql<boolean>`exists (select 1 from task_edges e join tasks d on d.id = e.from_task where e.business_id = tasks.business_id and e.to_task = tasks.id and d.status <> 'done' and d.archived_at is null)`,
          awaitingApproval: sql<boolean>`exists (select 1 from approvals a join agent_sessions s on s.id = a.session_id where a.business_id = tasks.business_id and s.task_id = tasks.id and a.resolved_at is null)`,
        })
        .from(tasks)
        .where(where)
        .orderBy(desc(tasks.priority), asc(tasks.createdAt), asc(tasks.id))
        .limit(limit),
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r.task, dependsOn: [...(r.dependsOn ?? [])], blocked: Boolean(r.blocked), awaitingApproval: Boolean(r.awaitingApproval) })), total: Number(count?.n ?? rows.length) };
  },

  /** The task a plan action created (a retried action finds it instead of creating another). */
  async byPlanAction(db: Executor, businessId: string, planActionId: string): Promise<Task | null> {
    const rows = await db.select().from(tasks).where(and(eq(tasks.businessId, businessId), eq(tasks.planActionId, planActionId))).limit(1);
    return rows[0] ?? null;
  },

  /**
   * An unfinished task that already carries this exact work (same title and goal): an option clicked again, or chosen
   * again on the next "Set the focus" decision, reuses it instead of piling up identical tasks (audit SOAK-04).
   */
  async openDuplicate(db: Executor, businessId: string, input: { title: string; goalMd: string }): Promise<Task | null> {
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.businessId, businessId), isNull(tasks.archivedAt), eq(tasks.title, input.title), eq(tasks.goalMd, input.goalMd), notInArray(tasks.status, ["done", "stopped"])))
      .orderBy(asc(tasks.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  async countByStatus(db: Executor, businessId: string): Promise<Record<TaskStatus, number>> {
    const rows = await db
      .select({ status: tasks.status, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.businessId, businessId), isNull(tasks.archivedAt)))
      .groupBy(tasks.status);
    const out = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  },
};
