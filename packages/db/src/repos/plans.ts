/**
 * plans + plan_actions — a decision compiled into typed actions (BUILD §11.3 "Decision → execution",
 * §12.3; routers plan.preview/confirm/status).
 *
 * A plan is created with its actions in one transaction (`create`), confirmed by the founder or executed
 * straight away when every action is inside policy (`confirm`), and the orchestrator moves each action
 * through pending → running → done/failed/skipped/denied (`startAction`, `finishAction`). `status` rolls the
 * action states up into the plan's own status so the Inbox can show "3 of 5 done".
 */
import { PLAN_ACTION_TYPES, PLAN_ORIGINS, PLAN_STATUSES, POLICY_OUTCOMES, ValidationError, type PlanStatus } from "@foundmill/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { PLAN_ACTION_STATUSES, planActions, plans, type Plan, type PlanAction } from "../schema";
import { changes, Id, JsonObject, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

export const PlanActionInput = z.object({
  type: z.enum(PLAN_ACTION_TYPES),
  params: JsonObject.default({}),
  agentId: Id.nullable().optional(),
  policyOutcome: z.enum(POLICY_OUTCOMES).nullable().optional(),
  /** Hard-gated actions arrive already `awaiting_approval`; everything else starts `pending`. */
  status: z.enum(PLAN_ACTION_STATUSES).default("pending"),
});
export type PlanActionInput = z.input<typeof PlanActionInput>;

export const CreatePlanInput = z.object({
  origin: z.enum(PLAN_ORIGINS),
  summaryMd: z.string().default(""),
  inboxItemId: Id.nullable().optional(),
  playbookId: Id.nullable().optional(),
  workflowId: z.string().max(200).nullable().optional(),
  status: z.enum(PLAN_STATUSES).default("pending_confirmation"),
  actions: z.array(PlanActionInput).min(1).max(50),
});
export type CreatePlanInput = z.input<typeof CreatePlanInput>;

export const PlanListFilter = PageInput.extend({
  status: z.union([z.enum(PLAN_STATUSES), z.array(z.enum(PLAN_STATUSES))]).optional(),
  origin: z.enum(PLAN_ORIGINS).optional(),
  inboxItemId: Id.optional(),
  includeArchived: z.boolean().default(false),
});
export type PlanListFilter = z.input<typeof PlanListFilter>;

export const FinishActionInput = z.object({
  status: z.enum(["done", "failed", "skipped", "denied"]),
  result: JsonObject.nullable().optional(),
  policyOutcome: z.enum(POLICY_OUTCOMES).nullable().optional(),
});
export type FinishActionInput = z.input<typeof FinishActionInput>;

export type PlanActionStatus = (typeof PLAN_ACTION_STATUSES)[number];
export interface PlanWithActions extends Plan {
  actions: PlanAction[];
}
export interface PlanStatusSummary {
  plan: Plan;
  counts: Record<PlanActionStatus, number>;
  total: number;
  /** Fraction of actions in a terminal state (done/failed/skipped/denied). */
  progress: number;
}

const scoped = (businessId: string, planId: string) => and(eq(plans.businessId, businessId), eq(plans.id, planId));
const scopedAction = (businessId: string, actionId: string) => and(eq(planActions.businessId, businessId), eq(planActions.id, actionId));
const TERMINAL: readonly PlanActionStatus[] = ["done", "failed", "skipped", "denied"];

export const plansRepo = {
  async list(db: Executor, businessId: string, filter: PlanListFilter = {}): Promise<Page<Plan>> {
    const f = parseInput(PlanListFilter, filter, "plan filter");
    const ks = timeKeyset<Plan>(plans.createdAt, plans.id, (r) => ({ at: r.createdAt, id: r.id }));
    const statuses = f.status === undefined ? undefined : Array.isArray(f.status) ? f.status : [f.status];
    const rows = await db
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.businessId, businessId),
          f.includeArchived ? undefined : isNull(plans.archivedAt),
          statuses?.length ? inArray(plans.status, statuses) : undefined,
          f.origin ? eq(plans.origin, f.origin) : undefined,
          f.inboxItemId ? eq(plans.inboxItemId, f.inboxItemId) : undefined,
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async get(db: Executor, businessId: string, planId: string): Promise<PlanWithActions> {
    const plan = one(await db.select().from(plans).where(scoped(businessId, planId)).limit(1), "plan", planId);
    const actions = await plansRepo.listActions(db, businessId, planId);
    return { ...plan, actions };
  },

  /** The plan compiled for an inbox item (the latest one), or null. */
  async forInboxItem(db: Executor, businessId: string, inboxItemId: string): Promise<PlanWithActions | null> {
    const rows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.businessId, businessId), eq(plans.inboxItemId, inboxItemId), isNull(plans.archivedAt)))
      .orderBy(sql`${plans.createdAt} desc`)
      .limit(1);
    const plan = rows[0];
    if (!plan) return null;
    return { ...plan, actions: await plansRepo.listActions(db, businessId, plan.id) };
  },

  /** Inserts the plan and its actions (positions in input order) in one transaction. */
  async create(db: Executor, businessId: string, input: CreatePlanInput): Promise<PlanWithActions> {
    const v = parseInput(CreatePlanInput, input, "plan");
    return db.transaction(async (tx) => {
      const plan = one(
        await tx
          .insert(plans)
          .values({ businessId, origin: v.origin, summaryMd: v.summaryMd, inboxItemId: v.inboxItemId ?? null, playbookId: v.playbookId ?? null, workflowId: v.workflowId ?? null, status: v.status })
          .returning(),
        "plan",
      );
      const actions = await tx
        .insert(planActions)
        .values(
          v.actions.map((a, position) => ({
            businessId,
            planId: plan.id,
            position,
            type: a.type,
            params: a.params,
            agentId: a.agentId ?? null,
            policyOutcome: a.policyOutcome ?? null,
            status: a.status,
          })),
        )
        .returning();
      actions.sort((a, b) => a.position - b.position);
      return { ...plan, actions };
    });
  },

  /** Founder confirmed "Here is what will happen": the plan starts executing. */
  async confirm(db: Executor, businessId: string, planId: string, options: { workflowId?: string | null } = {}): Promise<Plan> {
    return db.transaction(async (tx) => {
      const plan = one(await tx.select().from(plans).where(scoped(businessId, planId)).limit(1), "plan", planId);
      if (plan.status !== "pending_confirmation") throw new ValidationError(`Plan is ${plan.status}, not pending confirmation`, { planId, status: plan.status });
      return one(
        await tx
          .update(plans)
          .set({ status: "executing", confirmedAt: new Date(), ...(options.workflowId !== undefined ? { workflowId: options.workflowId } : {}) })
          .where(scoped(businessId, planId))
          .returning(),
        "plan",
        planId,
      );
    });
  },

  async setStatus(db: Executor, businessId: string, planId: string, status: PlanStatus): Promise<Plan> {
    const s = parseInput(z.enum(PLAN_STATUSES), status, "plan status");
    const terminal = s === "done" || s === "failed";
    return one(
      await db
        .update(plans)
        .set({ status: s, ...(terminal ? { completedAt: new Date() } : {}) })
        .where(scoped(businessId, planId))
        .returning(),
      "plan",
      planId,
    );
  },

  async setWorkflowId(db: Executor, businessId: string, planId: string, workflowId: string | null): Promise<Plan> {
    return one(await db.update(plans).set({ workflowId }).where(scoped(businessId, planId)).returning(), "plan", planId);
  },

  async updateSummary(db: Executor, businessId: string, planId: string, summaryMd: string): Promise<Plan> {
    return one(await db.update(plans).set({ summaryMd: parseInput(z.string(), summaryMd, "summary") }).where(scoped(businessId, planId)).returning(), "plan", planId);
  },

  async archive(db: Executor, businessId: string, planId: string): Promise<Plan> {
    return one(await db.update(plans).set({ archivedAt: new Date() }).where(scoped(businessId, planId)).returning(), "plan", planId);
  },

  // actions -----------------------------------------------------------------------------------------------------------
  async listActions(db: Executor, businessId: string, planId: string): Promise<PlanAction[]> {
    return db.select().from(planActions).where(and(eq(planActions.businessId, businessId), eq(planActions.planId, planId))).orderBy(asc(planActions.position));
  },

  async getAction(db: Executor, businessId: string, actionId: string): Promise<PlanAction> {
    return one(await db.select().from(planActions).where(scopedAction(businessId, actionId)).limit(1), "plan action", actionId);
  },

  /** The next action still to run (pending, by position), or null when every action has started. */
  async nextPendingAction(db: Executor, businessId: string, planId: string): Promise<PlanAction | null> {
    const rows = await db
      .select()
      .from(planActions)
      .where(and(eq(planActions.businessId, businessId), eq(planActions.planId, planId), eq(planActions.status, "pending")))
      .orderBy(asc(planActions.position))
      .limit(1);
    return rows[0] ?? null;
  },

  async updateAction(db: Executor, businessId: string, actionId: string, patch: { params?: Record<string, unknown>; agentId?: string | null; policyOutcome?: (typeof POLICY_OUTCOMES)[number] | null; status?: PlanActionStatus }): Promise<PlanAction> {
    const v = parseInput(
      z.object({ params: JsonObject.optional(), agentId: Id.nullable().optional(), policyOutcome: z.enum(POLICY_OUTCOMES).nullable().optional(), status: z.enum(PLAN_ACTION_STATUSES).optional() }),
      patch,
      "plan action update",
    );
    return one(await db.update(planActions).set(changes(v, "plan action")).where(scopedAction(businessId, actionId)).returning(), "plan action", actionId);
  },

  /** pending/awaiting_approval → running; stamps started_at. */
  async startAction(db: Executor, businessId: string, actionId: string): Promise<PlanAction> {
    return db.transaction(async (tx) => {
      const action = await plansRepo.getAction(tx, businessId, actionId);
      if (action.status !== "pending" && action.status !== "awaiting_approval") throw new ValidationError(`Plan action is ${action.status}`, { actionId });
      return one(await tx.update(planActions).set({ status: "running", startedAt: new Date() }).where(scopedAction(businessId, actionId)).returning(), "plan action", actionId);
    });
  },

  /** Marks the action terminal with its result, then rolls the plan status up (done when all terminal and none failed). */
  async finishAction(db: Executor, businessId: string, actionId: string, input: FinishActionInput): Promise<{ action: PlanAction; plan: Plan }> {
    const v = parseInput(FinishActionInput, input, "plan action result");
    return db.transaction(async (tx) => {
      const action = one(
        await tx
          .update(planActions)
          .set({ status: v.status, result: v.result ?? null, endedAt: new Date(), ...(v.policyOutcome !== undefined ? { policyOutcome: v.policyOutcome } : {}) })
          .where(scopedAction(businessId, actionId))
          .returning(),
        "plan action",
        actionId,
      );
      const summary = await plansRepo.status(tx, businessId, action.planId);
      let plan = summary.plan;
      const allTerminal = summary.progress >= 1;
      if (allTerminal && plan.status === "executing") {
        plan = await plansRepo.setStatus(tx, businessId, plan.id, summary.counts.failed > 0 ? "failed" : "done");
      }
      return { action, plan };
    });
  },

  /** The orchestrator's view (router plan.status): the plan plus counts per action status and a progress fraction. */
  async status(db: Executor, businessId: string, planId: string): Promise<PlanStatusSummary> {
    const plan = one(await db.select().from(plans).where(scoped(businessId, planId)).limit(1), "plan", planId);
    const rows = await db
      .select({ status: planActions.status, n: sql<number>`count(*)::int` })
      .from(planActions)
      .where(and(eq(planActions.businessId, businessId), eq(planActions.planId, planId)))
      .groupBy(planActions.status);
    const counts = Object.fromEntries(PLAN_ACTION_STATUSES.map((s) => [s, 0])) as Record<PlanActionStatus, number>;
    let total = 0;
    for (const r of rows) {
      counts[r.status] = Number(r.n);
      total += Number(r.n);
    }
    const terminal = TERMINAL.reduce((n, s) => n + counts[s], 0);
    return { plan, counts, total, progress: total === 0 ? 1 : terminal / total };
  },
};
