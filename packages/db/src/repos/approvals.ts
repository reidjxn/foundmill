/**
 * approvals — a tool call the policy engine answered "ask" (BUILD §9.5 gateway pipeline, §9.4 approvalWait).
 * The gateway (or a session replaying a recorded hold, a plan action, a channel engine) creates the row and the decision
 * Inbox item that carries it (`../approvals`); the founder (or the Chief of Staff on holiday, within authority) resolves
 * it; the waiting session or `approvalWait` continues on the `decision` signal.
 *
 * 0030: a row knows its task and the amount the call would commit. One gated call has one approval: a call that asks
 * again while its approval is open waits on that one (`claimOpen`). A task waits while its approval is open (`holds`),
 * and a granted approval is used once (`useGranted`): by the same call of the session still waiting, or of the next
 * session on the task when the first one had ended before the founder answered.
 */
import { ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, isNotNull, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agentSessions, APPROVAL_BY_KINDS, APPROVAL_OUTCOMES, approvals, tasks, type Approval } from "../schema";
import { Currency, DateRange, Id, JsonObject, MinorAmount, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

export const CreateApprovalInput = z.object({
  planActionId: Id.nullable().optional(),
  agentId: Id.nullable().optional(),
  sessionId: Id.nullable().optional(),
  /** Defaults to the task of `sessionId` when omitted (0030). */
  taskId: Id.nullable().optional(),
  inboxItemId: Id.nullable().optional(),
  connectorKey: z.string().max(60).nullable().optional(),
  tool: z.string().max(120).nullable().optional(),
  /** Arguments as the agent sent them; secrets never appear here (the gateway injects credentials after approval). */
  args: JsonObject.default({}),
  reasons: z.array(z.string().max(500)).default([]),
  /** What the call would commit (0030); omit when it spends nothing. */
  amountMinor: MinorAmount.nonnegative().nullable().optional(),
  currency: Currency.nullable().optional(),
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
  taskId: Id.optional(),
  connectorKey: z.string().max(60).optional(),
});
export type ApprovalListFilter = z.input<typeof ApprovalListFilter>;

/** One gated call, as the gateway or a session sees it: the same connector, tool and arguments make the same call. */
export const GatedCall = z.object({
  connectorKey: z.string().min(1).max(60),
  tool: z.string().min(1).max(120),
  args: JsonObject.default({}),
});

export const ClaimOpenInput = GatedCall.extend({
  /** The session making the call: the open approval must be for its task (or for this very session). Null for a call made outside any agent session (a plan action, an import): it matches approvals that have no session. */
  sessionId: Id.nullable(),
  agentId: Id,
  /** What this call would commit: an open approval asks the founder about exactly this amount, in this currency. */
  amountMinor: MinorAmount.nonnegative().default(0),
  currency: Currency.nullable().optional(),
});
export type ClaimOpenInput = z.input<typeof ClaimOpenInput>;

export const UseGrantedInput = GatedCall.extend({
  /** The session making the call: the approval must be for its task (or for this very session). Null for a call made outside any agent session: it matches approvals that have no session. */
  sessionId: Id.nullable(),
  agentId: Id,
  /** What this call would commit; an approval never covers more than the amount it was asked for. */
  amountMinor: MinorAmount.nonnegative().default(0),
  /** The currency of `amountMinor`: a call that spends runs only under an approval in that same currency. */
  currency: Currency.nullable().optional(),
});
export type UseGrantedInput = z.input<typeof UseGrantedInput>;

/** Why a task is waiting on the founder rather than dispatchable: its approval is still open, or was rejected since its last session. */
export interface ApprovalHold {
  approvalId: string;
  outcome: null | "rejected";
}

const scoped = (businessId: string, approvalId: string) => and(eq(approvals.businessId, businessId), eq(approvals.id, approvalId));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
/** Same arguments: jsonb equality ignores key order and whitespace. */
const sameArgs = (args: Record<string, unknown>) => sql`${approvals.args} = ${JSON.stringify(args)}::jsonb`;

/** Which approvals a call belongs to: its session's task or the session itself, or (outside any session) the ones without a session. */
function sessionMatch(sessionId: string | null, taskId: string | null) {
  if (!sessionId) return isNull(approvals.sessionId);
  return taskId ? or(eq(approvals.sessionId, sessionId), eq(approvals.taskId, taskId)) : eq(approvals.sessionId, sessionId);
}

async function taskOfSession(db: Executor, businessId: string, sessionId: string): Promise<string | null> {
  const rows = await db.select({ taskId: agentSessions.taskId }).from(agentSessions).where(and(eq(agentSessions.businessId, businessId), eq(agentSessions.id, sessionId))).limit(1);
  return rows[0]?.taskId ?? null;
}

export const approvalsRepo = {
  async create(db: Executor, businessId: string, input: CreateApprovalInput): Promise<Approval> {
    const v = parseInput(CreateApprovalInput, input, "approval");
    const taskId = v.taskId !== undefined ? v.taskId : v.sessionId ? await taskOfSession(db, businessId, v.sessionId) : null;
    if (taskId && v.taskId) {
      const own = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.businessId, businessId), eq(tasks.id, taskId))).limit(1);
      if (own.length === 0) throw new ValidationError("taskId is not a task of this business", { taskId });
    }
    return one(
      await db
        .insert(approvals)
        .values({
          businessId,
          planActionId: v.planActionId ?? null,
          agentId: v.agentId ?? null,
          sessionId: v.sessionId ?? null,
          taskId,
          inboxItemId: v.inboxItemId ?? null,
          connectorKey: v.connectorKey ?? null,
          tool: v.tool ?? null,
          args: v.args,
          reasons: v.reasons,
          amountMinor: v.amountMinor ?? null,
          currency: v.amountMinor ? (v.currency ?? null) : null,
        })
        .returning(),
      "approval",
    );
  },

  async get(db: Executor, businessId: string, approvalId: string): Promise<Approval> {
    return one(await db.select().from(approvals).where(scoped(businessId, approvalId)).limit(1), "approval", approvalId);
  },

  /** The approval with this id, or null (an id from a tool result is checked before it is trusted). */
  async find(db: Executor, businessId: string, approvalId: string): Promise<Approval | null> {
    const rows = await db.select().from(approvals).where(scoped(businessId, approvalId)).limit(1);
    return rows[0] ?? null;
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
          f.taskId ? eq(approvals.taskId, f.taskId) : undefined,
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

  /** The approval a decision Inbox item asks about (0030), or null for any other item. */
  async forInboxItem(db: Executor, businessId: string, inboxItemId: string): Promise<Approval | null> {
    const rows = await db.select().from(approvals).where(and(eq(approvals.businessId, businessId), eq(approvals.inboxItemId, inboxItemId))).orderBy(desc(approvals.requestedAt)).limit(1);
    return rows[0] ?? null;
  },

  /** Records the Inbox item that asks the founder about this approval. */
  async linkInboxItem(db: Executor, businessId: string, approvalId: string, inboxItemId: string): Promise<Approval> {
    return one(await db.update(approvals).set({ inboxItemId, updatedAt: new Date() }).where(scoped(businessId, approvalId)).returning(), "approval", approvalId);
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

  /**
   * The approval still open for the same call (0030): same agent, connector, tool, arguments and amount, for this
   * session's task (or this very session). The call waits for that answer instead of opening a second request. An
   * approval opened by an earlier session on the task is handed to `sessionId`, so the founder's decision is sent to the
   * session waiting now. Null when there is none (the call opens its own).
   */
  async claimOpen(db: Executor, businessId: string, input: ClaimOpenInput): Promise<Approval | null> {
    const v = parseInput(ClaimOpenInput, input, "gated call");
    const taskId = v.sessionId ? await taskOfSession(db, businessId, v.sessionId) : null;
    const rows = await db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.businessId, businessId),
          isNull(approvals.outcome),
          eq(approvals.agentId, v.agentId),
          eq(approvals.connectorKey, v.connectorKey),
          eq(approvals.tool, v.tool),
          sameArgs(v.args),
          // The same spend: an open request for another amount (or currency) is not this call's question.
          sql`coalesce(${approvals.amountMinor}, 0) = ${v.amountMinor}`,
          v.amountMinor > 0 ? (v.currency ? eq(approvals.currency, v.currency) : isNull(approvals.currency)) : undefined,
          sessionMatch(v.sessionId, taskId),
        ),
      )
      .orderBy(desc(approvals.requestedAt))
      .limit(1);
    const open = rows[0];
    if (!open || open.sessionId === v.sessionId) return open ?? null;
    if (!v.sessionId) return null;
    const moved = await db
      .update(approvals)
      .set({ sessionId: v.sessionId, updatedAt: new Date() })
      .where(and(scoped(businessId, open.id), isNull(approvals.outcome)))
      .returning();
    return moved[0] ?? null;
  },

  /**
   * Uses a granted approval for one call (0030): the approval the founder granted for this session's task (or this very
   * session), agent, connector, tool and arguments, covering at least the call's amount in the same currency, that no
   * call has used. Marked used by `sessionId` under a condition on `used_at`, so two calls can never both run under one
   * approval. Null when there is none (the call asks as usual).
   */
  async useGranted(db: Executor, businessId: string, input: UseGrantedInput): Promise<Approval | null> {
    const v = parseInput(UseGrantedInput, input, "gated call");
    // ¥5,000 approved is not $5,000: a call that spends needs an approval in its own currency.
    if (v.amountMinor > 0 && !v.currency) return null;
    const taskId = v.sessionId ? await taskOfSession(db, businessId, v.sessionId) : null;
    const candidates = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.businessId, businessId),
          eq(approvals.outcome, "approved"),
          isNull(approvals.usedAt),
          eq(approvals.agentId, v.agentId),
          eq(approvals.connectorKey, v.connectorKey),
          eq(approvals.tool, v.tool),
          sameArgs(v.args),
          sql`coalesce(${approvals.amountMinor}, 0) >= ${v.amountMinor}`,
          v.amountMinor > 0 ? eq(approvals.currency, v.currency!) : undefined,
          sessionMatch(v.sessionId, taskId),
        ),
      )
      .orderBy(desc(approvals.resolvedAt))
      .limit(3);
    for (const c of candidates) {
      const used = await db
        .update(approvals)
        .set({ usedAt: new Date(), usedBySessionId: v.sessionId, updatedAt: new Date() })
        .where(and(scoped(businessId, c.id), isNull(approvals.usedAt)))
        .returning();
      if (used[0]) return used[0];
    }
    return null;
  },

  /**
   * Tasks waiting on the founder (0030), from `taskIds`: the task's latest approval is still open, or it was rejected
   * after the task's last session started (a session started since, by a cycle or by hand, asks again).
   */
  async holds(db: Executor, businessId: string, taskIds: readonly string[]): Promise<Map<string, ApprovalHold>> {
    const out = new Map<string, ApprovalHold>();
    if (taskIds.length === 0) return out;
    const latest = await db
      .selectDistinctOn([approvals.taskId], { taskId: approvals.taskId, id: approvals.id, outcome: approvals.outcome, resolvedAt: approvals.resolvedAt })
      .from(approvals)
      .where(and(eq(approvals.businessId, businessId), inArray(approvals.taskId, [...taskIds])))
      .orderBy(approvals.taskId, desc(approvals.requestedAt));
    const rejected = latest.filter((a) => a.outcome === "rejected");
    const lastStart = new Map<string, Date>();
    if (rejected.length) {
      const starts = await db
        .select({ taskId: agentSessions.taskId, at: max(agentSessions.startedAt) })
        .from(agentSessions)
        .where(and(eq(agentSessions.businessId, businessId), inArray(agentSessions.taskId, rejected.map((a) => a.taskId!))))
        .groupBy(agentSessions.taskId);
      for (const s of starts) if (s.taskId && s.at) lastStart.set(s.taskId, new Date(s.at));
    }
    for (const a of latest) {
      if (!a.taskId) continue;
      if (a.outcome === null) out.set(a.taskId, { approvalId: a.id, outcome: null });
      else if (a.outcome === "rejected" && a.resolvedAt && a.resolvedAt >= (lastStart.get(a.taskId) ?? new Date(0))) out.set(a.taskId, { approvalId: a.id, outcome: "rejected" });
    }
    return out;
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
