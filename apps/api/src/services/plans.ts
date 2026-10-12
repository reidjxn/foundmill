/**
 * Decision → execution (BUILD §11.3, §12.3, AC-11.3.4, AC-11.3.5).
 *
 * compilePlan:   option click or free text → the `planCompiler` route (Opus, locked; deterministic rule engine in mock)
 *                → `PlanOutput` of typed actions. Hard gates always compile to `request_human_action`.
 * evaluatePlan:  every action is checked against the Cedar policies (packages/policy) with the Chief of Staff as the
 *                principal and the business mode in force; `allow` executes, `ask` needs the founder's confirmation,
 *                `deny` is recorded and skipped.
 * sections:      a plan runs as the person who decided (or confirmed) it, so `assertPlanSectionAccess` refuses one that
 *                changes a section they cannot write to (BUILD §11.9), before anything is written.
 * executePlan:   actions the API can carry out itself run in-process (tasks, channels, budgets, models, founder
 *                actions); the rest are dispatched to the orchestrator's `planExecution` workflow and stay pending
 *                when Temporal is unreachable, which the caller reports as `{ queued: false, reason }`.
 */
import { buildSystemPrompt, chiefOfStaff } from "@foundmill/agents";
import { APP_NAME, LIMITS } from "@foundmill/config";
import { repos, type Agent, type Business, type Executor, type PlanAction as PlanActionRow, type PlanWithActions } from "@foundmill/db";
import { compilePlanRuleBased, PlanOutput, type ModelClient, type PlanAction } from "@foundmill/models";
import { evaluate, type EvaluateResult, type ToolCtxInput } from "@foundmill/policy";
import { CHANNEL_META, CHANNEL_KEYS, ForbiddenError, MODEL_KEYS, TASK_KINDS, hasSectionAccess, type ChannelKey, type ModelKey, type PlanActionType, type PolicyOutcome, type Section, type SectionMembership, type TaskKind } from "@foundmill/shared";
import type { TemporalService } from "./temporal";
import { WORKFLOWS, workflowIds } from "./temporal";

export interface PlanContext {
  business: Business;
  agents: readonly Agent[];
  holidayActive: boolean;
  currency: string;
}

export interface CompiledPlan {
  summary: string;
  actions: PlanAction[];
  source: "model" | "rules";
}

/** Compile the founder's instruction into typed actions. The rule engine always validates a live plan (hard gates). */
export async function compilePlan(models: ModelClient, text: string, ctx: PlanContext): Promise<CompiledPlan> {
  const agents = ctx.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, agent_type: a.agentType, department_id: a.departmentIds[0] ?? null }));
  const input = {
    business: { id: ctx.business.id, name: ctx.business.name, business_mode: ctx.business.businessMode, archetype: ctx.business.archetype, currency: ctx.currency },
    reply: text,
    agents,
    action_types: [...Object.keys(ACTION_TOOLS)],
  };
  const result = await models.complete({
    route: "planCompiler",
    schema: PlanOutput,
    // House rules first (audit-conversation P1): the Chief of Staff compiles plans, so its instructions follow them.
    system: [
      buildSystemPrompt({ businessName: ctx.business.name, appName: APP_NAME, template: chiefOfStaff }),
      "You are the plan compiler. Turn the founder's reply into typed actions. Hard-gated requests (money, signing, filings, terms, deletion, security, untrusted instructions) compile to request_human_action only.",
    ],
    cacheSystem: true,
    messages: [{ role: "user", content: "```json\n" + JSON.stringify(input) + "\n```" }],
    attribution: { businessId: ctx.business.id, kind: "plan_compiler" },
  });
  const rules = compilePlanRuleBased(text, { agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, department_id: a.department_id ?? undefined })), defaultCurrency: ctx.currency });
  // The deterministic pre-check wins on hard gates: a live plan may never automate a gated clause (BUILD §2.2).
  const gated = rules.actions.filter((a) => a.type === "request_human_action");
  if (gated.length > 0 && result.json.actions.some((a) => a.type !== "request_human_action" && a.type !== "reply_only")) {
    return { summary: rules.summary, actions: rules.actions, source: "rules" };
  }
  return { summary: result.json.summary, actions: result.json.actions, source: models.mode === "mock" ? "rules" : "model" };
}

/** A pre-written option that means "do nothing for now" (only consulted when the rules found no action in it). */
const NO_ACTION_OPTION_RE = /^(?:not now|not yet|no thanks|skip(?: (?:it|this))?|dismiss|ignore(?: it| this)?|decline|hold off|wait(?: and see)?|do nothing|no change|stay the course|park (?:it|this)|leave (?:it|things) as (?:it is|they are)|keep (?:it|things) as (?:it is|they are))(?=$|[\s.,;:!?–—-])(?!\s+(?:on|with|to|for)\s)/i;

export interface DecisionOption {
  id: string;
  label: string;
  consequence?: string;
}

/**
 * An option click (BUILD §11.3: "option click or free text → (free text) Opus compiles a Plan"). The option was written
 * with the item, so it is compiled by the deterministic rule engine in-process, with no model call on the click path;
 * hard gates still compile to `request_human_action` only. When the rules find no action in the option's words, the
 * agent who asked gets one task to carry the choice out (a clarifying question back to the founder would undo the click),
 * and an option that means "not now" records the choice and runs nothing. Free text keeps `compilePlan` (Opus).
 */
export function compileOptionPlan(option: DecisionOption, item: { fromAgentId: string | null; subject: string }, ctx: PlanContext): CompiledPlan {
  const label = option.label.trim();
  const text = `${label}. ${option.consequence?.trim() ?? ""}`.trim();
  const agents = ctx.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, department_id: a.departmentIds[0] ?? undefined }));
  const rules = compilePlanRuleBased(text, { agents, defaultCurrency: ctx.currency });
  const actions = rules.actions.filter((a) => a.type !== "reply_only");
  if (actions.length > 0) return { summary: rules.summary, actions, source: "rules" };
  if (NO_ACTION_OPTION_RE.test(label)) {
    return { summary: `You chose "${label}". Nothing runs now.`, actions: [{ type: "reply_only", params: { acknowledgement: `You chose "${label}"; nothing runs now.`, option: option.id }, agent_id: null }], source: "rules" };
  }
  const agent = (item.fromAgentId && ctx.agents.find((a) => a.id === item.fromAgentId)) || null;
  return {
    summary: `${agent?.name ?? "The team"} carries out your choice: ${label}.`,
    actions: [{ type: "create_task", params: { kind: "ops", title: label.slice(0, 80), goal: text, decided_option: option.id, decision: item.subject.slice(0, 200) }, agent_id: agent?.id ?? null }],
    source: "rules",
  };
}

/** Policy attributes of each plan action, expressed as a platform tool for the Cedar evaluator. */
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

/**
 * The section each plan action changes (BUILD §11.9; audit RUI-01). A plan compiled from an Inbox decision, a confirmation
 * or an agent's hand-off runs as the person who decided it, so they need write access to every section it changes,
 * exactly as that section's own screen requires (distribution.channels.*, finance, team.agents.*, product.spec.*, crm).
 * Null: nothing beyond Inbox write (a reply, a founder task, a plain task for the agent who asked).
 */
export function sectionForAction(action: { type: PlanActionType; params?: unknown }): Section | null {
  const p = (action.params ?? {}) as Record<string, unknown>;
  switch (action.type) {
    case "enable_channel":
    case "disable_channel":
      return "distribution";
    case "set_budget":
      // A channel's budget is set on the Distribution screen; a department's or the business's is Finance's.
      return isChannelKey(p.channel) ? "distribution" : "finance";
    case "approve_spend":
      return "finance";
    case "create_task":
      return isChannelKey(p.channel) ? "distribution" : p.kind === "code" ? "development" : null;
    case "update_spec":
    case "update_roadmap":
      return "product";
    case "send_message":
    case "schedule_meeting":
      return "crm";
    case "hire_agent":
    case "train_agent":
    case "set_agent_model":
    case "create_playbook":
      return "team";
    case "request_human_action":
    case "reply_only":
      return null;
  }
}

const ACTION_WORDS: Record<PlanActionType, string> = {
  create_task: "start a task",
  enable_channel: "turn on a channel",
  disable_channel: "turn off a channel",
  set_budget: "set a budget",
  approve_spend: "approve spending",
  update_spec: "change the specification",
  update_roadmap: "change the roadmap",
  send_message: "message a contact",
  schedule_meeting: "schedule a meeting",
  hire_agent: "hire an agent",
  train_agent: "train an agent",
  set_agent_model: "change an agent's model",
  create_playbook: "create a playbook",
  request_human_action: "ask you to act",
  reply_only: "reply",
};

/** The sections a plan's actions change that this person cannot write to, with the actions that need each. */
export function sectionWalls(membership: SectionMembership, actions: readonly { type: PlanActionType; params?: unknown }[]): { section: Section; actionTypes: PlanActionType[] }[] {
  const walls = new Map<Section, PlanActionType[]>();
  for (const action of actions) {
    const section = sectionForAction(action);
    if (!section || hasSectionAccess(membership, section, "write")) continue;
    const types = walls.get(section) ?? [];
    if (!types.includes(action.type)) types.push(action.type);
    walls.set(section, types);
  }
  return [...walls].map(([section, actionTypes]) => ({ section, actionTypes }));
}

/**
 * Refuses (403, before anything is written) a plan that changes a section the person cannot write to: the item stays
 * open for someone who can. Policy-denied actions never run, so they are not counted.
 */
export function assertPlanSectionAccess(membership: SectionMembership, actions: readonly { type: PlanActionType; params?: unknown; denied?: boolean }[]): void {
  const walls = sectionWalls(membership, actions.filter((a) => !a.denied));
  if (walls.length === 0) return;
  const sections = walls.map((w) => w.section);
  const doing = [...new Set(walls.flatMap((w) => w.actionTypes))].map((t) => ACTION_WORDS[t]);
  const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  throw new ForbiddenError(`You do not have write access to ${list(sections)}, and this plan would ${list(doing)}. Someone with that access can decide it.`);
}

export interface ActionEvaluation {
  action: PlanAction;
  outcome: PolicyOutcome;
  reasons: string[];
  policyIds: string[];
  /** The action itself asks the founder to act (hard gate) — never automated. */
  hardGate: boolean;
}

function amountOf(action: PlanAction): number {
  const p = action.params;
  const n = typeof p.amount_minor === "number" ? p.amount_minor : typeof p.budget_minor === "number" ? p.budget_minor : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Evaluate every action against the policies; internal actions are allowed without a Cedar round-trip. */
export function evaluatePlan(actions: readonly PlanAction[], ctx: PlanContext): ActionEvaluation[] {
  const chief = ctx.agents.find((a) => a.agentType === "chief_of_staff") ?? ctx.agents[0];
  return actions.map((action) => {
    const tool = ACTION_TOOLS[action.type];
    const hardGate = action.type === "request_human_action";
    if (tool.internal) return { action, outcome: "allow", reasons: [], policyIds: [], hardGate };
    const agent = (action.agent_id && ctx.agents.find((a) => a.id === action.agent_id)) || chief;
    const result: EvaluateResult = evaluate({
      principal: {
        id: agent?.id ?? "chief_of_staff",
        department: agent?.departmentIds[0] ?? "team",
        type: agent?.agentType ?? "chief_of_staff",
        modelKey: agent?.modelKey ?? "opus",
        autonomy: "inherit",
        approvalThresholdMinor: LIMITS.approvalThresholdMinorDefault,
      },
      tool: { connector: tool.connector, name: tool.name, spendsMoney: tool.spendsMoney, contactsThirdParty: tool.contactsThirdParty },
      business: { id: ctx.business.id, businessMode: ctx.business.businessMode, holidayActive: ctx.holidayActive },
      context: { amountMinor: amountOf(action), holidayActive: ctx.holidayActive },
    });
    return { action, outcome: result.outcome, reasons: result.reasons, policyIds: result.policyIds, hardGate };
  });
}

export const requiresConfirmation = (evaluations: readonly ActionEvaluation[]) => evaluations.some((e) => e.outcome === "ask");

export interface ExecuteResult {
  executed: string[];
  deferred: string[];
  denied: string[];
  dispatch: { queued: boolean; workflowId: string; reason?: string } | null;
}

export interface ExecuteOptions {
  actorUserId: string;
  temporal: TemporalService;
  /** Defaults from the business glossary / EUR. */
  currency: string;
}

const isChannelKey = (v: unknown): v is ChannelKey => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
const isTaskKind = (v: unknown): v is TaskKind => typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
const isModelKey = (v: unknown): v is ModelKey => typeof v === "string" && (MODEL_KEYS as readonly string[]).includes(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v : fallback);

/** A channel a plan action switched on or off in-process; its engine follows after commit (`syncChannelEngines`). */
export interface ChannelToggle {
  channelId: string;
  channelKey: ChannelKey;
  enabled: boolean;
}

/**
 * Execute a plan's pending actions. Runs inside the caller's transaction for the in-process actions; the orchestrator
 * dispatch and the channel engines (`channels`) happen after commit (the caller passes the result through).
 */
export async function executePlanActions(tx: Executor, businessId: string, plan: PlanWithActions, opts: ExecuteOptions): Promise<Omit<ExecuteResult, "dispatch"> & { needsOrchestrator: boolean; channels: ChannelToggle[] }> {
  const executed: string[] = [];
  const deferred: string[] = [];
  const denied: string[] = [];
  const channels: ChannelToggle[] = [];
  for (const action of plan.actions) {
    if (action.status !== "pending") continue;
    if (action.policyOutcome === "deny") {
      await repos.plans.finishAction(tx, businessId, action.id, { status: "denied", result: { reason: "policy denied" } });
      denied.push(action.id);
      continue;
    }
    const handled = await executeLocally(tx, businessId, action, opts);
    if (handled) {
      await repos.plans.startAction(tx, businessId, action.id);
      await repos.plans.finishAction(tx, businessId, action.id, { status: "done", result: handled });
      executed.push(action.id);
      if ((action.type === "enable_channel" || action.type === "disable_channel") && typeof handled.channelId === "string" && isChannelKey(handled.channelKey)) {
        channels.push({ channelId: handled.channelId, channelKey: handled.channelKey, enabled: handled.enabled === true });
      }
    } else deferred.push(action.id);
  }
  return { executed, deferred, denied, needsOrchestrator: deferred.length > 0, channels };
}

/**
 * The engine workflow follows a channel a plan switched (AC-11.7.2), as the Board toggle does
 * (`distribution.channels.enable`): enabling starts `channelEngine`, disabling signals it to stop. Called after the
 * plan's transaction commits; without Temporal the channel stays enabled and the result says why (audit VGJC-X1).
 */
export async function syncChannelEngines(ctx: { db: Executor; temporal: TemporalService; businessId: string; userId: string }, toggles: readonly ChannelToggle[]) {
  const results: { channelId: string; workflow: Awaited<ReturnType<TemporalService["start"]>> }[] = [];
  for (const t of toggles) {
    const workflowId = workflowIds.engine(t.channelId);
    const workflow = t.enabled
      ? await ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId, args: [{ businessId: ctx.businessId, channelId: t.channelId, channelKey: t.channelKey }] })
      : await ctx.temporal.signal(workflowId, "stop", { reason: "channel_disabled", by: ctx.userId });
    if (workflow.queued) await repos.channels.setEngineWorkflow(ctx.db, ctx.businessId, t.channelId, t.enabled ? workflowId : null);
    results.push({ channelId: t.channelId, workflow });
  }
  return results;
}

/** Dispatch the plan to the orchestrator; degrades to `{ queued: false, reason }` when Temporal is unreachable. */
export async function dispatchPlan(temporal: TemporalService, businessId: string, planId: string) {
  return temporal.start(WORKFLOWS.planExecution, { workflowId: workflowIds.plan(planId), args: [{ businessId, planId }] });
}

/** The department whose modules include distribution (channel tasks land there); never by name (BUILD §2.1 rule 5). */
async function departmentForChannel(tx: Executor, businessId: string, _channel: ChannelKey): Promise<string | null> {
  const departments = await repos.departments.list(tx, businessId);
  return departments.find((d) => d.moduleKeys.includes("distribution"))?.id ?? null;
}

async function executeLocally(tx: Executor, businessId: string, action: PlanActionRow, opts: ExecuteOptions): Promise<Record<string, unknown> | null> {
  const p = action.params as Record<string, unknown>;
  switch (action.type) {
    case "create_task": {
      const kind = isTaskKind(p.kind) ? p.kind : "ops";
      const channel = isChannelKey(p.channel) ? p.channel : null;
      const task = await repos.tasks.create(tx, businessId, {
        kind,
        title: str(p.title, "Task from your decision").slice(0, 200),
        goalMd: str(p.goal, str(p.title)),
        acceptance: Array.isArray(p.acceptance) ? p.acceptance : [],
        assigneeAgentId: action.agentId,
        planActionId: action.id,
        status: "ready",
        budgetMinor: typeof p.budget_minor === "number" ? p.budget_minor : null,
        currency: str(p.currency, opts.currency).toUpperCase(),
        departmentId: channel ? await departmentForChannel(tx, businessId, channel) : null,
      });
      return { taskId: task.id, channel };
    }
    case "enable_channel":
    case "disable_channel": {
      if (!isChannelKey(p.channel)) return null;
      const enabled = action.type === "enable_channel";
      const existing = await repos.channels.getByKey(tx, businessId, p.channel);
      const channel = existing ? await repos.channels.setEnabled(tx, businessId, existing.id, enabled) : await repos.channels.upsert(tx, businessId, { channelKey: p.channel, line: CHANNEL_META[p.channel].line, enabled, kitMode: CHANNEL_META[p.channel].kitModeByDefault, ownerAgentId: action.agentId });
      return { channelId: channel.id, channelKey: p.channel, enabled };
    }
    case "set_budget": {
      const amount = typeof p.amount_minor === "number" ? Math.round(p.amount_minor) : null;
      if (amount === null) return null;
      if (isChannelKey(p.channel)) {
        const existing = (await repos.channels.getByKey(tx, businessId, p.channel)) ?? (await repos.channels.upsert(tx, businessId, { channelKey: p.channel, line: CHANNEL_META[p.channel].line, enabled: true, ownerAgentId: action.agentId }));
        const channel = await repos.channels.setBudget(tx, businessId, existing.id, amount, str(p.currency, opts.currency).toUpperCase());
        return { channelId: channel.id, budgetMinor: amount };
      }
      if (p.scope === "department" && typeof p.department === "string") {
        const dept = (await repos.departments.list(tx, businessId)).find((d) => d.name.toLowerCase() === (p.department as string).toLowerCase() || d.slug === p.department);
        if (!dept) return null;
        await repos.departments.update(tx, businessId, dept.id, { budgetMinor: amount, currency: str(p.currency, opts.currency).toUpperCase() });
        return { departmentId: dept.id, budgetMinor: amount };
      }
      return null;
    }
    case "set_agent_model": {
      if (!isModelKey(p.model_key)) return null;
      const targetId = str(p.agent_id, action.agentId ?? "");
      if (!targetId) return null;
      const agent = await repos.agents.setModel(tx, businessId, targetId, p.model_key);
      return { agentId: agent.id, modelKey: p.model_key };
    }
    case "request_human_action": {
      const task = await repos.tasks.create(tx, businessId, {
        kind: "ops",
        title: `Founder action: ${str(p.request, str(p.original_text, "action required")).slice(0, 180)}`,
        goalMd: [str(p.instructions), str(p.original_text)].filter(Boolean).join("\n\n"),
        acceptance: ["The founder completed the action personally (hard gate, BUILD §2.2)."],
        assigneeAgentId: null,
        planActionId: action.id,
        status: "ready",
        priority: 100,
      });
      return { taskId: task.id, hardGate: str(p.gate, "hard_gate") };
    }
    case "reply_only":
      return { question: str(p.question) };
    case "update_spec":
    case "update_roadmap":
    case "send_message":
    case "schedule_meeting":
    case "hire_agent":
    case "train_agent":
    case "create_playbook":
    case "approve_spend":
      return null; // orchestrator work (agents, approvals, playbook compilation)
    default:
      return null;
  }
}
