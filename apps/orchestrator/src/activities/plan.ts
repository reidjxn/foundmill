/**
 * Plan execution (BUILD §11.3 "Decision → execution", §12.3, AC-11.3.4, AC-11.3.5).
 *
 * Every PLAN_ACTION_TYPE has a typed handler. Before a handler runs, the action is evaluated against the Cedar policies
 * with the acting agent (or the Chief of Staff) as the principal: `deny` is recorded and skipped, `ask` creates an
 * approvals row + `approval.requested` and returns `awaiting_approval` (the workflow waits on the `decision` signal),
 * `allow` executes. `request_human_action` is the hard-gate action: it creates a founder task and an inbox item and
 * never executes the underlying request. External actions (send_message, schedule_meeting) go through the gateway with
 * a session token minted for the acting agent, never to a vendor directly, as the connectors' own tools with their own
 * argument shapes (audit VGPC-X1, VGPC-X2): a message is Gmail `send_message` (or SendGrid `send_mail` from a verified
 * sender), a meeting Google Calendar `create_event`. Recipients are email addresses, or CRM records (by id or exact name)
 * resolved to their email. An action that names no wording or no time is handed to the acting agent as a task (it
 * drafts or finds a slot with its own tools, through the same gateway and policy). The gateway's answer is checked:
 * `ask` waits for the founder (once), a refused or failed tool call fails the action with the connector's reason.
 */
import { LIMITS } from "@foundmill/config";
import { getTemplate, getTemplateByAgentType, initialVersionFromTemplate, type AgentTemplate } from "@foundmill/agents";
import { repos, type Agent, type Business, type Entity, type PlanAction as PlanActionRow } from "@foundmill/db";
import { PRICING_CURRENCY } from "@foundmill/models";
import { evaluate, type ToolCtxInput } from "@foundmill/policy";
import { CHANNEL_KEYS, CHANNEL_META, MODEL_KEYS, TASK_KINDS, uuid, type ChannelKey, type ModelKey, type PlanActionType, type PolicyOutcome, type TaskKind } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { GatewayCallResponse } from "../gateway-client";
import { grantApproval, openApprovalNote } from "./approvals";
import { openAgentSession } from "./dispatch";
import type { LoadedPlan, PlanActionResult, PlanActionView } from "./types";
import { gmailSendArgs, messageFor, sendgridSendArgs } from "./connector-calls";

/** Policy attributes per action type (same table as apps/api/src/services/plans.ts; kept in sync by the plan tests). */
export const ACTION_TOOLS: Record<PlanActionType, ToolCtxInput & { internal?: boolean }> = {
  create_task: { connector: "platform", name: "create_task", internal: true },
  enable_channel: { connector: "platform", name: "enable_channel", internal: true },
  disable_channel: { connector: "platform", name: "disable_channel", internal: true },
  set_budget: { connector: "platform", name: "set_budget", spendsMoney: true },
  approve_spend: { connector: "platform", name: "approve_spend", spendsMoney: true },
  update_spec: { connector: "platform", name: "update_spec", internal: true },
  update_roadmap: { connector: "platform", name: "update_roadmap", internal: true },
  send_message: { connector: "platform", name: "send_message", contactsThirdParty: true },
  schedule_meeting: { connector: "platform", name: "schedule_meeting", contactsThirdParty: true },
  hire_agent: { connector: "platform", name: "hire_agent", internal: true },
  train_agent: { connector: "platform", name: "train_agent", internal: true, spendsMoney: true },
  set_agent_model: { connector: "platform", name: "set_agent_model", internal: true },
  create_playbook: { connector: "platform", name: "create_playbook", internal: true },
  request_human_action: { connector: "platform", name: "request_human_action", internal: true },
  reply_only: { connector: "platform", name: "reply_only", internal: true },
};

/** Hard gates never execute automatically (BUILD §2.2). */
export const HARD_GATE_ACTIONS: ReadonlySet<PlanActionType> = new Set<PlanActionType>(["request_human_action"]);

const isChannelKey = (v: unknown): v is ChannelKey => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
const isTaskKind = (v: unknown): v is TaskKind => typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
const isModelKey = (v: unknown): v is ModelKey => typeof v === "string" && (MODEL_KEYS as readonly string[]).includes(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export function amountOf(params: Record<string, unknown>): number {
  const n = num(params.amount_minor) ?? num(params.budget_minor) ?? 0;
  return n > 0 ? n : 0;
}

export interface PolicyVerdict {
  outcome: PolicyOutcome;
  reasons: string[];
  policyIds: string[];
  hardGate: boolean;
}

/** Evaluate one action against the policies; internal actions are allowed without a Cedar round-trip. */
export function evaluateAction(action: { type: PlanActionType; params: Record<string, unknown>; agentId: string | null }, ctx: { business: Pick<Business, "id" | "businessMode">; agents: readonly Agent[]; holidayActive: boolean }): PolicyVerdict {
  const hardGate = HARD_GATE_ACTIONS.has(action.type);
  const tool = ACTION_TOOLS[action.type];
  if (tool.internal) return { outcome: "allow", reasons: [], policyIds: [], hardGate };
  const chief = ctx.agents.find((a) => a.agentType === "chief_of_staff") ?? ctx.agents[0];
  const agent = (action.agentId && ctx.agents.find((a) => a.id === action.agentId)) || chief;
  const result = evaluate({
    principal: { id: agent?.id ?? "chief_of_staff", department: agent?.departmentIds[0] ?? "team", type: agent?.agentType ?? "chief_of_staff", modelKey: agent?.modelKey ?? "opus", autonomy: "inherit", approvalThresholdMinor: LIMITS.approvalThresholdMinorDefault },
    tool: { connector: tool.connector, name: tool.name, spendsMoney: tool.spendsMoney, contactsThirdParty: tool.contactsThirdParty },
    business: { id: ctx.business.id, businessMode: ctx.business.businessMode, holidayActive: ctx.holidayActive },
    context: { amountMinor: amountOf(action.params), holidayActive: ctx.holidayActive },
  });
  return { outcome: result.outcome, reasons: result.reasons, policyIds: result.policyIds, hardGate };
}

const view = (a: PlanActionRow): PlanActionView => ({ id: a.id, type: a.type, params: (a.params ?? {}) as Record<string, unknown>, agentId: a.agentId, policyOutcome: a.policyOutcome, status: a.status });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mail connectors in the order a message prefers them when the plan names none. */
export const MAIL_CONNECTORS = ["gmail", "sendgrid"] as const;
export const DEFAULT_MEETING_MINUTES = 30;

/** Thrown by a handler when the gateway asked the founder: the action waits for that approval. */
class AwaitingGatewayApproval extends Error {
  constructor(readonly approvalId: string) {
    super("waiting for the founder's approval");
  }
}

/** The values a plan names as recipients: strings or lists of strings under the usual keys. */
export function recipientValues(p: Record<string, unknown>, keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = p[k];
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return [...new Set(out)];
}

export function createPlanActivities(deps: OrchestratorDeps) {
  async function departmentForChannel(businessId: string): Promise<string | null> {
    const departments = await repos.departments.list(deps.db, businessId);
    return departments.find((d) => d.moduleKeys.includes("distribution"))?.id ?? null;
  }

  async function actingAgent(businessId: string, agentId: string | null, agents: readonly Agent[]): Promise<Agent | null> {
    return (agentId && agents.find((a) => a.id === agentId)) || (await repos.agents.chiefOfStaff(deps.db, businessId)) || agents[0] || null;
  }

  /**
   * Call connector tools through the gateway as the acting agent (never a vendor directly). A plan action runs outside
   * any agent session, so the token says so (`sessionId: null`) instead of naming a session that does not exist.
   */
  async function gatewayFor(businessId: string, agent: Agent, connector: string, tools: readonly string[]) {
    const minted = await deps.gateway.mintSessionToken({ businessId, agentId: agent.id, sessionId: null, allowedTools: tools.map((t) => `${connector}:${t}`), ttlSeconds: 300 });
    return (tool: string, args: Record<string, unknown>, context: Record<string, unknown> = {}) => deps.gateway.call(minted.token, { connector, tool, args, context });
  }

  /** One tool through the gateway as the acting agent. */
  async function gatewayCall(businessId: string, agent: Agent, connector: string, tool: string, args: Record<string, unknown>, context: Record<string, unknown>) {
    return (await gatewayFor(businessId, agent, connector, [tool]))(tool, args, context);
  }

  /**
   * The tool's data, or why not: `deny`/`rate_limited` and a tool that answered `ok: false` throw with the reason (the
   * action fails, the founder reads why); `ask` waits for the founder, unless this run already carries the approval the
   * gateway asked for, which would only ask again.
   */
  async function checkedResult(res: GatewayCallResponse, connector: string, tool: string, ctx: { approvalId: string | null; businessId: string }): Promise<unknown> {
    if (res.outcome === "deny" || res.outcome === "rate_limited") throw new Error(`The gateway refused ${connector}.${tool} (${res.outcome}): ${(res.reasons ?? []).join("; ") || "no reason given"}`);
    if (res.outcome === "ask") {
      const approved = ctx.approvalId ? await repos.approvals.get(deps.db, ctx.businessId, ctx.approvalId).catch(() => null) : null;
      if (approved && approved.connectorKey === connector) throw new Error(`The gateway asked again for ${connector}.${tool} after your approval; nothing was sent.`);
      if (!res.approvalId) throw new Error(`The gateway asked for approval of ${connector}.${tool} but opened none.`);
      throw new AwaitingGatewayApproval(res.approvalId);
    }
    const envelope = (res.result ?? {}) as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
    if (envelope.ok === false) throw new Error(`${connector}.${tool} failed: ${envelope.error?.message ?? envelope.error?.code ?? "unknown error"}`.slice(0, 500));
    return envelope.data;
  }

  /**
   * Email addresses for the recipients a plan names: addresses as given, CRM records by id or by exact name (their
   * `email` identifier). Records being deleted are never contacted. Returns the addresses and what could not be resolved.
   */
  async function resolveEmails(businessId: string, values: readonly string[]): Promise<{ emails: string[]; unresolved: string[] }> {
    const emails = new Set<string>();
    const unresolved: string[] = [];
    for (const v of values) {
      if (EMAIL_RE.test(v)) {
        emails.add(v.toLowerCase());
        continue;
      }
      let entity: Entity | null;
      if (UUID_RE.test(v)) entity = await repos.entities.resolve(deps.db, businessId, v).catch(() => null);
      else {
        const found = await repos.entities.search(deps.db, businessId, { q: v, limit: 5 }).catch(() => null);
        const hits = found?.hits ?? [];
        entity = hits.find((h) => h.entity.displayName.toLowerCase() === v.toLowerCase())?.entity ?? (hits.length === 1 ? hits[0]!.entity : null);
      }
      const email = entity && !entity.deletionRequestedAt ? (entity.identifiers as Record<string, unknown>).email : null;
      if (typeof email === "string" && EMAIL_RE.test(email)) emails.add(email.toLowerCase());
      else unresolved.push(v);
    }
    return { emails: [...emails], unresolved };
  }

  /** The mail connector a message goes out through: the plan's choice, else a connected Gmail, else SendGrid, else Gmail. */
  async function mailConnector(businessId: string, requested: unknown): Promise<(typeof MAIL_CONNECTORS)[number]> {
    if (requested === "gmail" || requested === "sendgrid") return requested;
    const integrations = await repos.integrations.list(deps.db, businessId).catch(() => []);
    const connected = new Set(integrations.filter((i) => i.status === "connected" || i.status === "mock" || i.status === "degraded").map((i) => i.connectorKey));
    return MAIL_CONNECTORS.find((c) => connected.has(c)) ?? "gmail";
  }

  /** Hands an action that names no wording (or no time) to the acting agent as a task with a session, like create_task. */
  async function delegate(businessId: string, action: PlanActionRow, agent: Agent, title: string, goal: string): Promise<{ result: Record<string, unknown>; spawn: PlanActionResult["spawn"] }> {
    const task = await repos.tasks.create(deps.db, businessId, { kind: "ops", title: title.slice(0, 200), goalMd: goal, acceptance: ["Done through the gateway's tools, within policy (approval where it asks)."], assigneeAgentId: agent.id, planActionId: action.id, status: "ready" });
    const opened = await openAgentSession(deps, { businessId, agentId: agent.id, taskId: task.id });
    const spawn: PlanActionResult["spawn"] = opened.sessionId ? [{ workflow: "agentSession", workflowId: opened.workflowId, args: { businessId, agentId: agent.id, taskId: task.id, sessionId: opened.sessionId } }] : [];
    return { result: { delegated: true, taskId: task.id, assigneeAgentId: agent.id, ...(opened.sessionId ? {} : { deferred: opened.detail }) }, spawn };
  }

  return {
    async loadPlan(input: { businessId: string; planId: string }): Promise<LoadedPlan> {
      const [plan, business] = await Promise.all([repos.plans.get(deps.db, input.businessId, input.planId), repos.businesses.get(deps.db, input.businessId)]);
      return { planId: plan.id, status: plan.status, businessMode: business.businessMode, actions: plan.actions.map(view) };
    },

    /**
     * Execute one action. `approved` = the founder (or the Chief of Staff within authority) approved the pending
     * approval the previous attempt created, so `ask` is treated as allow this time.
     */
    async executePlanAction(input: { businessId: string; planId: string; actionId: string; workflowId: string; approved?: boolean; approvalId?: string | null }): Promise<PlanActionResult> {
      const { db } = deps;
      const businessId = input.businessId;
      const [action, business, agentsPage, holiday] = await Promise.all([repos.plans.getAction(db, businessId, input.actionId), repos.businesses.get(db, businessId), repos.agents.list(db, businessId, { limit: 200 }), repos.holidays.current(db, businessId)]);
      const agents = agentsPage.items;
      const empty: PlanActionResult = { actionId: action.id, status: "skipped", outcome: action.policyOutcome, approvalId: null, result: null, spawn: [] };
      if (action.status !== "pending" && action.status !== "awaiting_approval") return { ...empty, status: action.status === "done" ? "done" : action.status === "denied" ? "denied" : action.status === "failed" ? "failed" : "skipped" };
      const params = (action.params ?? {}) as Record<string, unknown>;

      // While the team is stopped (Stop all agents, a revoked key, used-up credits) nothing goes out on the business's
      // behalf: a message or a meeting the plan holds fails with the reason instead of being sent or asked about, even
      // if Stop all agents' signal never reached this plan. Internal actions (tasks, specs, a founder task) still run.
      if (business.agentsStoppedAt && ACTION_TOOLS[action.type].contactsThirdParty) {
        const error = "agents are stopped; nothing is sent until an owner or admin resumes them";
        await repos.plans.finishAction(db, businessId, action.id, { status: "failed", result: { error, agentsStopped: true } });
        return { ...empty, status: "failed", result: { error } };
      }

      const verdict = evaluateAction({ type: action.type, params, agentId: action.agentId }, { business, agents, holidayActive: holiday !== null });

      // Hard gates: a founder task + inbox item, never the action itself.
      if (verdict.hardGate) {
        const chief = await repos.agents.chiefOfStaff(db, businessId);
        const title = `Founder action: ${str(params.request, str(params.original_text, "action required")).slice(0, 180)}`;
        const task = await repos.tasks.create(db, businessId, { kind: "ops", title, goalMd: [str(params.instructions), str(params.original_text)].filter(Boolean).join("\n\n"), acceptance: ["The founder completed the action personally (hard gate, BUILD §2.2)."], assigneeAgentId: null, planActionId: action.id, status: "ready", priority: 100 });
        let inboxItemId: string | null = null;
        if (chief) {
          const item = await repos.inbox.createItem(db, businessId, {
            type: "warning",
            from_agent_id: chief.id,
            subject: title.slice(0, 80),
            body_md: `This needs you personally: ${str(params.request, str(params.original_text, "an action the team is not allowed to take"))}. ${str(params.instructions, "Open the task for the steps.")} The team prepared everything it could and will not act on this itself (hard gate).`,
            status_strip: [],
            exhibit: { kind: "none", spec_ref: null },
            decision: null,
            blocks_continue: false,
            source_event_ids: [],
            entity_ids: [],
          });
          inboxItemId = item.id;
        }
        await repos.plans.startAction(db, businessId, action.id);
        const { action: finished } = await repos.plans.finishAction(db, businessId, action.id, { status: "done", result: { taskId: task.id, inboxItemId, hardGate: true, executed: false }, policyOutcome: "deny" });
        await repos.audit.append(db, businessId, { actorKind: "system", action: "plan.action.hard_gate", target: { kind: "plan_action", id: action.id }, details: { taskId: task.id, inboxItemId } });
        return { actionId: finished.id, status: "done", outcome: "deny", approvalId: null, result: { taskId: task.id, inboxItemId, hardGate: true, executed: false }, spawn: [] };
      }

      if (verdict.outcome === "deny") {
        await repos.plans.finishAction(db, businessId, action.id, { status: "denied", result: { reasons: verdict.reasons, policyIds: verdict.policyIds }, policyOutcome: "deny" });
        return { ...empty, status: "denied", outcome: "deny", result: { reasons: verdict.reasons } };
      }

      if (verdict.outcome === "ask" && !input.approved) {
        const existing = await repos.approvals.forPlanAction(db, businessId, action.id);
        if (existing && existing.outcome === null) return { ...empty, status: "awaiting_approval", outcome: "ask", approvalId: existing.id };
        if (existing?.outcome === "rejected" || existing?.outcome === "expired") {
          await repos.plans.finishAction(db, businessId, action.id, { status: "denied", result: { approvalId: existing.id, outcome: existing.outcome }, policyOutcome: "ask" });
          return { ...empty, status: "denied", outcome: "ask", approvalId: existing.id };
        }
        const agent = await actingAgent(businessId, action.agentId, agents);
        const amount = amountOf(params) > 0 ? { amountMinor: amountOf(params), currency: str(params.currency, business.currency).toUpperCase() } : null;
        const what = str(params.summary, str(params.title, str(params.request, JSON.stringify(params).slice(0, 200))));
        const approval = await repos.approvals.create(db, businessId, { planActionId: action.id, agentId: agent?.id ?? null, connectorKey: ACTION_TOOLS[action.type].connector, tool: ACTION_TOOLS[action.type].name, args: params, reasons: verdict.reasons, ...(amount ?? {}) });
        await repos.plans.updateAction(db, businessId, action.id, { status: "awaiting_approval", policyOutcome: "ask" });
        const requested = agent
          ? await emitEvent(db, {
              businessId,
              type: "approval.requested",
              actor: { kind: "agent", id: agent.id },
              payload: { approvalId: approval.id, planActionId: action.id, agentId: agent.id, connectorKey: ACTION_TOOLS[action.type].connector, tool: ACTION_TOOLS[action.type].name, amount, reasons: verdict.reasons, policyIds: verdict.policyIds, hardGate: false, summary: `${action.type.replace(/_/g, " ")}: ${what}`.slice(0, 1000) },
            })
          : null;
        // The founder answers it in the Inbox; Approve or Reject signals `approval:<id>`, the wait this plan runs in.
        await openApprovalNote(db, businessId, approval, { agent, taskTitle: null, argsSummary: what, sourceEventIds: requested ? [requested.id] : [] });
        return { ...empty, status: "awaiting_approval", outcome: "ask", approvalId: approval.id };
      }

      // The founder turned down the approval the connector's own policy asked for: the action is denied, not retried.
      if (!input.approved && !ACTION_TOOLS[action.type].internal) {
        const prior = await repos.approvals.forPlanAction(db, businessId, action.id);
        if (prior && (prior.outcome === "rejected" || prior.outcome === "expired")) {
          await repos.plans.finishAction(db, businessId, action.id, { status: "denied", result: { approvalId: prior.id, outcome: prior.outcome }, policyOutcome: "ask" });
          return { ...empty, status: "denied", outcome: "ask", approvalId: prior.id };
        }
      }

      // allow (or approved ask): run the typed handler.
      await repos.plans.startAction(db, businessId, action.id);
      try {
        const handled = await handle(action, params, { businessId, business, agents, workflowId: input.workflowId, approvalId: input.approvalId ?? null });
        const { action: finished } = await repos.plans.finishAction(db, businessId, action.id, { status: "done", result: handled.result, policyOutcome: input.approved ? "ask" : "allow" });
        await repos.audit.append(db, businessId, { actorKind: "system", action: `plan.action.${action.type}`, target: { kind: "plan_action", id: action.id }, details: { result: handled.result, approved: Boolean(input.approved) } });
        return { actionId: finished.id, status: "done", outcome: input.approved ? "ask" : "allow", approvalId: input.approvalId ?? null, result: handled.result, spawn: handled.spawn };
      } catch (err) {
        if (err instanceof AwaitingGatewayApproval) {
          // The connector's own policy asked (a new counterparty, augmented mode): the action waits for that approval.
          await repos.plans.updateAction(db, businessId, action.id, { status: "awaiting_approval", policyOutcome: "ask" });
          return { ...empty, status: "awaiting_approval", outcome: "ask", approvalId: err.approvalId };
        }
        const message = (err as Error).message ?? String(err);
        await repos.plans.finishAction(db, businessId, action.id, { status: "failed", result: { error: message.slice(0, 500) }, policyOutcome: verdict.outcome });
        return { ...empty, status: "failed", outcome: verdict.outcome, result: { error: message.slice(0, 500) } };
      }
    },

    async finishPlan(input: { businessId: string; planId: string }): Promise<{ status: string; progress: number }> {
      const summary = await repos.plans.status(deps.db, input.businessId, input.planId);
      let status: string = summary.plan.status;
      if (summary.progress >= 1 && (status === "pending_confirmation" || status === "executing")) {
        const target = summary.counts.done > 0 || summary.counts.skipped > 0 ? "done" : "failed";
        status = (await repos.plans.setStatus(deps.db, input.businessId, input.planId, target)).status;
      }
      return { status, progress: summary.progress };
    },
  };

  // ---- handlers --------------------------------------------------------------------------------------------------

  async function handle(action: PlanActionRow, p: Record<string, unknown>, ctx: { businessId: string; business: Business; agents: Agent[]; workflowId: string; approvalId: string | null }): Promise<{ result: Record<string, unknown>; spawn: PlanActionResult["spawn"] }> {
    const { db } = deps;
    const { businessId } = ctx;
    // An amount the plan did not price in a currency is in the business's own (0025).
    const currency = str(p.currency, ctx.business.currency).toUpperCase();
    switch (action.type) {
      case "create_task": {
        const kind = isTaskKind(p.kind) ? p.kind : "ops";
        const channel = isChannelKey(p.channel) ? p.channel : null;
        const assignee = action.agentId ?? (typeof p.agent_id === "string" ? p.agent_id : null);
        const task = await repos.tasks.create(db, businessId, { kind, title: str(p.title, "Task from your decision").slice(0, 200), goalMd: str(p.goal, str(p.title)), acceptance: Array.isArray(p.acceptance) ? p.acceptance : [], assigneeAgentId: assignee, planActionId: action.id, status: "ready", budgetMinor: num(p.budget_minor), currency, departmentId: channel ? await departmentForChannel(businessId) : (typeof p.department_id === "string" ? p.department_id : null), fileScope: Array.isArray(p.file_scope) ? p.file_scope.filter((f): f is string => typeof f === "string") : [] });
        const spawn: PlanActionResult["spawn"] = [];
        let deferred: string | null = null;
        if (assignee && p.start_now !== false) {
          // Same guard as a cycle's dispatch; refused (team stopped, agent paused or capped), the task stays ready for
          // the next cycle. The session row carries `session:<id>` before the workflow starts with that id.
          const opened = await openAgentSession(deps, { businessId, agentId: assignee, taskId: task.id });
          if (opened.sessionId) spawn.push({ workflow: "agentSession", workflowId: opened.workflowId, args: { businessId, agentId: assignee, taskId: task.id, sessionId: opened.sessionId } });
          else deferred = opened.detail;
        }
        return { result: { taskId: task.id, channel, assigneeAgentId: assignee, ...(deferred ? { deferred } : {}) }, spawn };
      }
      case "enable_channel":
      case "disable_channel": {
        if (!isChannelKey(p.channel)) throw new Error("channel is required");
        const enabled = action.type === "enable_channel";
        const existing = await repos.channels.getByKey(db, businessId, p.channel);
        const channel = existing ? await repos.channels.setEnabled(db, businessId, existing.id, enabled) : await repos.channels.upsert(db, businessId, { channelKey: p.channel, line: CHANNEL_META[p.channel].line, enabled, kitMode: CHANNEL_META[p.channel].kitModeByDefault, ownerAgentId: action.agentId });
        // The engine's id is recorded with the channel so Stop all agents (and the Distribution toggle) can reach it;
        // while the team is stopped no engine starts, and the recorded id is what makes resuming the agents start it.
        const stopped = enabled && (await repos.businesses.agentsStopped(db, businessId));
        const workflowId = `engine:${channel.id}`;
        if (enabled) await repos.channels.setEngineWorkflow(db, businessId, channel.id, workflowId);
        if (!enabled && channel.engineWorkflowId) await repos.channels.setEngineWorkflow(db, businessId, channel.id, null);
        const spawn: PlanActionResult["spawn"] = enabled && !stopped ? [{ workflow: "channelEngine", workflowId, args: { businessId, channelId: channel.id, channelKey: p.channel } }] : [];
        return { result: { channelId: channel.id, enabled, ...(stopped ? { deferred: "agents are stopped; the engine starts when they resume" } : {}) }, spawn };
      }
      case "set_budget": {
        const amount = num(p.amount_minor) ?? num(p.budget_minor);
        if (amount === null) throw new Error("amount_minor is required");
        if (isChannelKey(p.channel)) {
          const existing = (await repos.channels.getByKey(db, businessId, p.channel)) ?? (await repos.channels.upsert(db, businessId, { channelKey: p.channel, line: CHANNEL_META[p.channel].line, enabled: true, ownerAgentId: action.agentId }));
          const channel = await repos.channels.setBudget(db, businessId, existing.id, amount, currency);
          return { result: { channelId: channel.id, budgetMinor: amount, currency }, spawn: [] };
        }
        const departments = await repos.departments.list(db, businessId);
        const dept = departments.find((d) => d.id === p.department_id || d.slug === p.department || d.name.toLowerCase() === String(p.department ?? "").toLowerCase());
        if (!dept) throw new Error("set_budget needs a channel or a department");
        await repos.departments.update(db, businessId, dept.id, { budgetMinor: amount, currency });
        return { result: { departmentId: dept.id, budgetMinor: amount, currency }, spawn: [] };
      }
      case "approve_spend": {
        const approvalId = typeof p.approval_id === "string" ? p.approval_id : null;
        if (approvalId) {
          // Answered like the Inbox answers it: the item closes and a session waiting on the call carries on.
          await grantApproval(deps, businessId, approvalId, typeof p.by === "string" ? p.by : null);
          return { result: { approvalId, amountMinor: amountOf(p) }, spawn: [] };
        }
        return { result: { amountMinor: amountOf(p), currency, note: "spend approved within caps; the next matching tool call runs without asking" }, spawn: [] };
      }
      case "update_spec": {
        const agent = await actingAgent(businessId, action.agentId, ctx.agents);
        const blockId = typeof p.spec_block_id === "string" ? p.spec_block_id : null;
        const text = str(p.text, str(p.content, str(p.summary)));
        if (blockId) {
          const proposal = await repos.product.createProposal(db, businessId, { title: str(p.title, "Spec update from your decision").slice(0, 200), rationaleMd: str(p.rationale, text), severity: "normal", proposedByAgentId: agent?.id ?? null, hunks: [{ specBlockId: blockId, theirs: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } }] });
          return { result: { proposalId: proposal.id, specBlockId: blockId }, spawn: [] };
        }
        const block = await repos.product.createBlock(db, businessId, { section: str(p.section, "notes"), content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, authoredByKind: agent ? "agent" : "user", authoredBy: agent?.id ?? null });
        return { result: { specBlockId: block.id, created: true }, spawn: [] };
      }
      case "update_roadmap": {
        const item = await repos.product.upsertRoadmapItem(db, businessId, { ...(typeof p.roadmap_item_id === "string" ? { id: p.roadmap_item_id } : {}), title: str(p.title, "Roadmap item").slice(0, 200), descriptionMd: str(p.description, str(p.goal)), horizon: p.horizon === "now" || p.horizon === "next" || p.horizon === "later" ? p.horizon : "next", status: str(p.status, "planned") });
        return { result: { roadmapItemId: item.id }, spawn: [] };
      }
      case "send_message": {
        const agent = await actingAgent(businessId, action.agentId, ctx.agents);
        if (!agent) throw new Error("no agent can send on the business's behalf");
        const named = recipientValues(p, ["to", "email", "recipient_email", "recipient", "recipient_id", "entity_id", "entity_ids"]);
        const { emails, unresolved } = await resolveEmails(businessId, named);
        if (emails.length === 0) throw new Error(`No email address on record for ${unresolved.join(", ") || "the recipient"}. Add one to their CRM profile, then decide again.`);
        const body = str(p.body, str(p.text, str(p.message)));
        const intent = str(p.intent, str(p.summary, str(p.subject)));
        if (!body) {
          const disclosure = p.requires_disclosure === false ? "" : " Say plainly that you are an AI agent writing for the business.";
          return delegate(businessId, action, agent, `Write to ${emails.join(", ")}: ${intent || "the message from your decision"}`, `Draft and send this message to ${emails.join(", ")} through your mail tools: ${intent || "see the decision"}.${disclosure} The gateway checks suppression and asks for approval where the policy says so.`);
        }
        // The message with the AI disclosure that closes it unless the action says none is needed (connector-calls.ts).
        const message = messageFor({ ...p, to: emails, body, subject: str(p.subject, `A message from ${ctx.business.name}`).slice(0, 300), connector: await mailConnector(businessId, p.connector) }, ctx.business);
        if ("error" in message) throw new Error(message.error);
        const context = { recipient: message.to[0], planActionId: action.id };
        const checks = { approvalId: ctx.approvalId, businessId };
        if (message.connector === "gmail") {
          const data = (await checkedResult(await gatewayCall(businessId, agent, "gmail", "send_message", gmailSendArgs(message), context), "gmail", "send_message", checks)) as { id?: string } | undefined;
          return { result: { connector: message.connector, tool: "send_message", to: message.to, messageId: data?.id ?? null }, spawn: [] };
        }
        // SendGrid sends only from a verified sender identity of the account.
        const senders = (await checkedResult(await gatewayCall(businessId, agent, "sendgrid", "list_verified_senders", {}, {}), "sendgrid", "list_verified_senders", checks)) as { items?: { fromEmail: string; fromName: string | null; verified: boolean }[] } | undefined;
        const sender = senders?.items?.find((s) => s.verified);
        if (!sender) throw new Error("SendGrid has no verified sender; verify one in SendGrid or connect Gmail, then decide again.");
        const data = (await checkedResult(
          await gatewayCall(businessId, agent, "sendgrid", "send_mail", { ...sendgridSendArgs(message, sender.fromEmail), from: { email: sender.fromEmail, ...(sender.fromName ? { name: sender.fromName } : {}) }, customArgs: { planActionId: action.id } }, context),
          "sendgrid",
          "send_mail",
          checks,
        )) as { messageId?: string } | undefined;
        return { result: { connector: message.connector, tool: "send_mail", to: message.to, messageId: data?.messageId ?? null }, spawn: [] };
      }
      case "schedule_meeting": {
        const agent = await actingAgent(businessId, action.agentId, ctx.agents);
        if (!agent) throw new Error("no agent can schedule on the business's behalf");
        const named = recipientValues(p, ["attendees", "with", "to", "email", "entity_id", "entity_ids"]);
        const { emails, unresolved } = await resolveEmails(businessId, named);
        if (named.length > 0 && emails.length === 0) throw new Error(`No email address on record for ${unresolved.join(", ")}. Add one to their CRM profile, then decide again.`);
        const summary = str(p.title, str(p.summary, str(p.topic, "Meeting"))).slice(0, 300);
        const start = str(p.start);
        if (!start || Number.isNaN(Date.parse(start))) {
          return delegate(businessId, action, agent, `Schedule: ${summary}`, `Find a free slot${p.timeframe ? ` (${String(p.timeframe)})` : ""} with your calendar tools and invite ${emails.join(", ") || "the people named in the decision"}: ${summary}.`);
        }
        const startIso = new Date(start).toISOString();
        const end = str(p.end);
        const endIso = end && !Number.isNaN(Date.parse(end)) && Date.parse(end) > Date.parse(start) ? new Date(end).toISOString() : new Date(Date.parse(start) + (num(p.duration_minutes) ?? DEFAULT_MEETING_MINUTES) * 60_000).toISOString();
        const args = { calendarId: str(p.calendar_id, "primary"), summary, ...(str(p.description) ? { description: str(p.description).slice(0, 5000) } : {}), start: startIso, end: endIso, attendees: emails, ...(str(p.time_zone) ? { timeZone: str(p.time_zone) } : {}), addMeetLink: p.add_meet_link !== false };
        const event = (await checkedResult(await gatewayCall(businessId, agent, "google_calendar", "create_event", args, { recipient: emails[0], planActionId: action.id }), "google_calendar", "create_event", { approvalId: ctx.approvalId, businessId })) as { id?: string } | undefined;
        return { result: { connector: "google_calendar", tool: "create_event", eventId: event?.id ?? null, start: startIso, end: endIso, attendees: emails }, spawn: [] };
      }
      case "hire_agent": {
        const key = str(p.template_key, str(p.agent_type));
        const template: AgentTemplate | undefined = key ? (getTemplateByAgentType(key) ?? safeTemplate(key)) : undefined;
        if (!template) throw new Error(`unknown agent template "${key}"`);
        const agentId = uuid();
        const spec = initialVersionFromTemplate(template, agentId);
        const departmentIds = typeof p.department_id === "string" ? [p.department_id] : [];
        const created = await repos.agents.create(db, businessId, { name: str(p.name, template.name).slice(0, 80), role: template.role, agentType: template.agentType, layer: template.layer, descriptionMd: template.description, departmentIds, modelKey: template.modelKey, status: "idle", autonomy: spec.autonomy, wageCapMinor: template.wageCapMinor, currency, avatarSeed: agentId, initialVersion: { instructions: spec.instructions, tools: spec.tools, modelKey: spec.modelKey } });
        await repos.skills.upsertForAgent(db, businessId, created.id, template.skills.map((skillKey) => ({ skillKey, group: skillGroupFor(skillKey, template), tested: template.baselineRating, proven: null, nLive: 0, displayed: template.baselineRating, potential: template.baselineRating })));
        return { result: { agentId: created.id, templateKey: template.key }, spawn: [] };
      }
      case "train_agent": {
        const targetId = str(p.agent_id, action.agentId ?? "");
        if (!targetId) throw new Error("agent_id is required");
        if (await repos.businesses.agentsStopped(db, businessId)) throw new Error("agents are stopped; resume them, then start the training from the agent's profile");
        const agent = await repos.agents.get(db, businessId, targetId);
        const live = agent.currentVersionId ? await repos.agents.getVersion(db, businessId, agent.currentVersionId) : null;
        const instructions = { ...((live?.instructions ?? {}) as Record<string, unknown>), ...(typeof p.instructions === "object" && p.instructions ? (p.instructions as Record<string, unknown>) : {}) };
        const draft = await repos.agents.createVersion(db, businessId, agent.id, { instructions: instructions as never, tools: live?.tools ?? [], modelKey: isModelKey(p.model_key) ? p.model_key : agent.modelKey, state: "draft", createdByKind: "agent" });
        // A training run costs model calls: priced in the pricing currency, not the business's.
        const run = await repos.training.create(db, businessId, { agentId: agent.id, fromVersionId: live?.id ?? null, toVersionId: draft.id, status: "queued", currency: PRICING_CURRENCY });
        return { result: { trainingRunId: run.id, draftVersionId: draft.id }, spawn: [{ workflow: "trainingRun", workflowId: `training:${run.id}`, args: { businessId, trainingRunId: run.id } }] };
      }
      case "set_agent_model": {
        if (!isModelKey(p.model_key)) throw new Error("model_key is required");
        const scope = p.apply_scope === "type" || p.apply_scope === "all" ? p.apply_scope : "agent";
        const targetId = str(p.agent_id, action.agentId ?? "");
        const target = targetId ? await repos.agents.get(db, businessId, targetId) : null;
        const targets = scope === "agent" ? (target ? [target] : []) : ctx.agents.filter((a) => (scope === "all" ? true : a.agentType === target?.agentType));
        const updated: string[] = [];
        for (const a of targets) {
          if (a.agentType === "chief_of_staff" && p.model_key !== "opus") deps.log.warn({ agentId: a.id }, "Chief of Staff downgraded from Opus (BUILD §11.10 warning)");
          await repos.agents.setModel(db, businessId, a.id, p.model_key);
          updated.push(a.id);
        }
        return { result: { modelKey: p.model_key, applyScope: scope, updated }, spawn: [] };
      }
      case "create_playbook": {
        const sourceText = str(p.source_text, str(p.text, str(p.description)));
        if (!sourceText) throw new Error("source_text is required");
        const steps = Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [{ kind: "action", action: { type: "create_task", params: { title: sourceText.slice(0, 120), goal: sourceText } } }];
        const playbook = await repos.playbooks.create(db, businessId, { name: str(p.name, sourceText.slice(0, 60)), sourceText, compiled: { trigger: typeof p.trigger === "object" && p.trigger ? (p.trigger as Record<string, unknown>) : { event: str(p.event, "manual") }, steps, approvals: [], stop: typeof p.stop === "object" && p.stop ? (p.stop as Record<string, unknown>) : {} }, enabled: p.enabled !== false, createdBy: null });
        return { result: { playbookId: playbook.id, steps: steps.length }, spawn: [] };
      }
      case "reply_only":
        return { result: { question: str(p.question, str(p.text)) }, spawn: [] };
      case "request_human_action":
        // Handled before policy evaluation; unreachable, kept for exhaustiveness.
        return { result: { hardGate: true, executed: false }, spawn: [] };
      default: {
        const never: never = action.type;
        throw new Error(`unknown plan action type ${String(never)}`);
      }
    }
  }

  function safeTemplate(key: string): AgentTemplate | undefined {
    try {
      return getTemplate(key);
    } catch {
      return undefined;
    }
  }

  function skillGroupFor(skillKey: string, template: AgentTemplate): "craft" | "judgement" | "execution" {
    void template;
    if (/^(planning|scope_control|prioritisation|risk_awareness|knowing_when_to_ask)/.test(skillKey)) return "judgement";
    if (/^(speed|reliability|tool_use|cost_efficiency|communication)/.test(skillKey)) return "execution";
    return "craft";
  }
}

export type PlanActivities = ReturnType<typeof createPlanActivities>;
export { systemActor };
