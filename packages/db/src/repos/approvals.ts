/**
 * approvals — a tool call the policy engine answered "ask" (BUILD §9.5 gateway pipeline, §9.4 approvalWait).
 * The gateway creates the row and returns `outcome: "ask"`; the founder (or the Chief of Staff on holiday,
 * within authority) resolves it; `approvalWait` continues on the `decision` signal.
 */
import { DECISION_TYPES, ValidationError, type DecisionType } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, APPROVAL_BY_KINDS, APPROVAL_OUTCOMES, approvals, departments, memberships, type Approval, type APPROVAL_HANDLER_KINDS } from "../schema";
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
  /**
   * The Responsibilities decision type when the creator knows it (the gateway does); omitted, it is inferred from the
   * tool; null (a hard gate) leaves the approval with the founder.
   */
  decisionType: z.enum(DECISION_TYPES).nullable().optional(),
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

/** One row of a department's `approvers` (team.responsibilities.set): who handles a decision type there. */
const ApproverRow = z.object({ decisionType: z.enum(DECISION_TYPES), handler: z.object({ kind: z.enum(["founder", "user", "agent"]), id: Id.nullable().default(null) }) });

/** A department's `approvers` JSON as rows; anything malformed is ignored (the founder handles it). */
export function approversOf(raw: unknown): z.infer<typeof ApproverRow>[] {
  return Array.isArray(raw) ? raw.map((r) => ApproverRow.safeParse(r)).filter((r) => r.success).map((r) => r.data) : [];
}

/**
 * The Responsibilities decision type an approval is, from the gated tool when its creator did not say (BUILD §11.9:
 * spend above threshold, publish content, merge to main, sign contracts, message customers, hire agents, change
 * models). Null when the tool fits none of them: the founder handles it.
 */
export function inferDecisionType(connectorKey: string | null | undefined, tool: string | null | undefined): DecisionType | null {
  const t = (tool ?? "").toLowerCase();
  const c = (connectorKey ?? "").toLowerCase();
  if (c === "dropbox_sign" || c === "docusign" || /(^|_)(sign|accept_terms)($|_)/.test(t)) return "sign_contracts";
  if (t === "merge_pr" || t === "merge_pull_request") return "merge_to_main";
  if (t === "hire_agent") return "hire_agents";
  if (t === "set_agent_model") return "change_models";
  if (/(^|_)(set_budget|approve_spend|create_coupon|charge|pay|purchase|buy|top_up)($|_)/.test(t)) return "spend_above_threshold";
  if (/(^|_)(launch_campaign|publish|post|schedule_post|tweet)($|_)/.test(t)) return "publish_content";
  if (/(^|_)(send|email|message|reply|dm)($|_)/.test(t)) return "message_customers";
  return null;
}

export interface ApprovalRouting {
  decisionType: DecisionType | null;
  handlerKind: (typeof APPROVAL_HANDLER_KINDS)[number] | null;
  handlerId: string | null;
  /** A named agent decides its approvals itself the moment they open (never a hard gate). */
  decidedByAgent: string | null;
}

/**
 * Who handles a new approval (AC-11.9.2): the decision type's handler in the requesting agent's department
 * (`departments.approvers`, set from Team › Responsibilities), or, with no department to go by, the business-wide
 * handler when every department agrees. A staff member who left, or an agent released or paused, hands it back to the
 * founder. Signing is a hard gate: an agent never decides it, nor its own request.
 */
export async function routeApproval(db: Executor, businessId: string, input: { agentId?: string | null; decisionType: DecisionType | null }): Promise<ApprovalRouting> {
  const none: ApprovalRouting = { decisionType: input.decisionType, handlerKind: null, handlerId: null, decidedByAgent: null };
  if (!input.decisionType) return none;
  const live = await db.select({ id: departments.id, approvers: departments.approvers }).from(departments).where(and(eq(departments.businessId, businessId), isNull(departments.archivedAt)));
  if (live.length === 0) return none;
  const requester = input.agentId ? (await db.select({ departmentIds: agents.departmentIds }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, input.agentId))).limit(1))[0] : undefined;
  const handlerIn = (approvers: unknown) => approversOf(approvers).find((r) => r.decisionType === input.decisionType)?.handler ?? { kind: "founder" as const, id: null };
  const home = requester?.departmentIds.map((id) => live.find((d) => d.id === id)).find((d) => d !== undefined);
  let handler = home ? handlerIn(home.approvers) : null;
  if (!handler) {
    const all = live.map((d) => handlerIn(d.approvers));
    handler = all.every((h) => h.kind === all[0]!.kind && h.id === all[0]!.id) ? all[0]! : { kind: "founder", id: null };
  }
  if (handler.kind === "founder" || !handler.id) return none;
  if (handler.kind === "user") {
    const member = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, handler.id))).limit(1);
    return member.length ? { ...none, handlerKind: "user", handlerId: handler.id } : none;
  }
  const agent = (await db.select({ id: agents.id, status: agents.status, archivedAt: agents.archivedAt }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, handler.id))).limit(1))[0];
  // An agent never approves its own request: that would be no approval at all, so the founder answers it.
  if (!agent || agent.archivedAt || agent.status === "paused" || agent.id === input.agentId || input.decisionType === "sign_contracts") return none;
  return { ...none, handlerKind: "agent", handlerId: agent.id, decidedByAgent: agent.id };
}

export const approvalsRepo = {
  /**
   * Opens an approval, routed by the Responsibilities matrix (`routeApproval`): its decision type (given, or inferred
   * from the tool) and its handler are stored on the row. An approval handed to an agent is decided by that agent at
   * once (approved, `by_kind` 'agent').
   */
  async create(db: Executor, businessId: string, input: CreateApprovalInput): Promise<Approval> {
    const v = parseInput(CreateApprovalInput, input, "approval");
    // An explicit null (a hard gate) is the founder's and is not routed; omitted, the tool says what it is.
    const routing = await routeApproval(db, businessId, { agentId: v.agentId, decisionType: v.decisionType === undefined ? inferDecisionType(v.connectorKey, v.tool) : v.decisionType });
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
          decisionType: routing.decisionType,
          handlerKind: routing.handlerKind,
          handlerId: routing.handlerId,
          ...(routing.decidedByAgent ? { outcome: "approved" as const, byKind: "agent" as const, byId: routing.decidedByAgent, resolvedAt: new Date() } : {}),
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
