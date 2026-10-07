/**
 * approvals — a tool call the policy engine answered "ask" (BUILD §9.5 gateway pipeline, §9.4 approvalWait).
 * The gateway creates the row and returns `outcome: "ask"`; the founder (or the Chief of Staff on holiday,
 * within authority) resolves it; `approvalWait` continues on the `decision` signal.
 */
import { ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { APPROVAL_BY_KINDS, APPROVAL_OUTCOMES, approvals, type Approval } from "../schema";
import { DateRange, Id, JsonObject, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

export const CreateApprovalInput = z.object({
  planActionId: Id.nullable().optional(),
  agentId: Id.nullable().optional(),
  sessionId: Id.nullable().optional(),
  inboxItemId: Id.nullable().optional(),
  connectorKey: z.string().max(60).nullable().optional(),
  tool: z.string().max(120).nullable().optional(),
  /** Arguments as the agent sent them; secrets never appear here (the gateway injects credentials after approval). */
  args: JsonObject.default({}),
  reasons: z.array(z.string().max(500)).default([]),
});
export type CreateApprovalInput = z.input<typeof CreateApprovalInput>;

export const ResolveApprovalInput = z.object({
  outcome: z.enum(APPROVAL_OUTCOMES),
  byKind: z.enum(APPROVAL_BY_KINDS).default("user"),
  byId: Id.nullable().optional(),
});
export type ResolveApprovalInput = z.input<typeof ResolveApprovalInput>;

export const ApprovalListFilter = PageInput.extend(DateRange.shape).extend({
  pending: z.boolean().optional(),
  outcome: z.union([z.enum(APPROVAL_OUTCOMES), z.array(z.enum(APPROVAL_OUTCOMES))]).optional(),
  agentId: Id.optional(),
  sessionId: Id.optional(),
  connectorKey: z.string().max(60).optional(),
});
export type ApprovalListFilter = z.input<typeof ApprovalListFilter>;

const scoped = (businessId: string, approvalId: string) => and(eq(approvals.businessId, businessId), eq(approvals.id, approvalId));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const approvalsRepo = {
  async create(db: Executor, businessId: string, input: CreateApprovalInput): Promise<Approval> {
    const v = parseInput(CreateApprovalInput, input, "approval");
    return one(
      await db
        .insert(approvals)
        .values({
          businessId,
          planActionId: v.planActionId ?? null,
          agentId: v.agentId ?? null,
          sessionId: v.sessionId ?? null,
          inboxItemId: v.inboxItemId ?? null,
          connectorKey: v.connectorKey ?? null,
          tool: v.tool ?? null,
          args: v.args,
          reasons: v.reasons,
        })
        .returning(),
      "approval",
    );
  },

  async get(db: Executor, businessId: string, approvalId: string): Promise<Approval> {
    return one(await db.select().from(approvals).where(scoped(businessId, approvalId)).limit(1), "approval", approvalId);
  },

  async list(db: Executor, businessId: string, filter: ApprovalListFilter = {}): Promise<Page<Approval>> {
    const f = parseInput(ApprovalListFilter, filter, "approval filter");
    const ks = timeKeyset<Approval>(approvals.requestedAt, approvals.id, (r) => ({ at: r.requestedAt, id: r.id }));
    const outcomes = toArray(f.outcome);
    const rows = await db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.businessId, businessId),
          f.pending === true ? isNull(approvals.resolvedAt) : f.pending === false ? isNotNull(approvals.resolvedAt) : undefined,
          outcomes?.length ? inArray(approvals.outcome, outcomes) : undefined,
          f.agentId ? eq(approvals.agentId, f.agentId) : undefined,
          f.sessionId ? eq(approvals.sessionId, f.sessionId) : undefined,
          f.connectorKey ? eq(approvals.connectorKey, f.connectorKey) : undefined,
          timeRange(approvals.requestedAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** Unresolved approvals, oldest first (the queue the Inbox and the holiday Chief of Staff work through). */
  async pending(db: Executor, businessId: string, limit = 100): Promise<Approval[]> {
    return db.select().from(approvals).where(and(eq(approvals.businessId, businessId), isNull(approvals.resolvedAt))).orderBy(asc(approvals.requestedAt)).limit(limit);
  },

  async countPending(db: Executor, businessId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.businessId, businessId), isNull(approvals.resolvedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  async forPlanAction(db: Executor, businessId: string, planActionId: string): Promise<Approval | null> {
    const rows = await db.select().from(approvals).where(and(eq(approvals.businessId, businessId), eq(approvals.planActionId, planActionId))).orderBy(desc(approvals.requestedAt)).limit(1);
    return rows[0] ?? null;
  },

  /** Resolves once; a second resolution is refused so two founders cannot both answer. */
  async resolve(db: Executor, businessId: string, approvalId: string, input: ResolveApprovalInput): Promise<Approval> {
    const v = parseInput(ResolveApprovalInput, input, "approval resolution");
    const rows = await db
      .update(approvals)
      .set({ outcome: v.outcome, byKind: v.byKind, byId: v.byId ?? null, resolvedAt: new Date() })
      .where(and(scoped(businessId, approvalId), isNull(approvals.resolvedAt)))
      .returning();
    const row = rows[0];
    if (!row) {
      const existing = await approvalsRepo.get(db, businessId, approvalId);
      throw new ValidationError(`Approval already resolved (${existing.outcome})`, { approvalId, outcome: existing.outcome });
    }
    return row;
  },

  /** Expires every pending approval requested before `before` (session ended, holiday over). Returns how many. */
  async expireBefore(db: Executor, businessId: string, before: Date): Promise<number> {
    const rows = await db
      .update(approvals)
      .set({ outcome: "expired", byKind: "system", resolvedAt: new Date() })
      .where(and(eq(approvals.businessId, businessId), isNull(approvals.resolvedAt), sql`${approvals.requestedAt} < ${before.toISOString()}`))
      .returning({ id: approvals.id });
    return rows.length;
  },
};
