/**
 * Decision → execution (BUILD §11.3, §12.3, AC-11.3.4, AC-11.3.5).
 *
 * compilePlan:   option click or free text → the `planCompiler` route (Opus, locked; deterministic rule engine in mock)
 *                → `PlanOutput` of typed actions. Hard gates always compile to `request_human_action`.
 * evaluatePlan:  every action is checked against the Cedar policies (packages/policy) as the gateway would check the
 *                acting agent's own call (the Chief of Staff when no agent acts): its autonomy override, spend cap and
 *                approval threshold, the business's spend cap per action and the vacation budget ceiling; `allow`
 *                executes, `ask` needs the founder's confirmation, `deny` is recorded and skipped.
 * sections:      a plan runs as the person who decided (or confirmed) it, so `assertPlanSectionAccess` refuses one that
 *                changes a section they cannot write to (BUILD §11.9), before anything is written.
 * executePlan:   actions the API can carry out itself run in-process (tasks, channels, budgets, approved spends,
 *                models, founder actions); the rest are dispatched to the orchestrator's `planExecution` workflow. A
 *                plan whose dispatch did not reach Temporal stays `executing` with no workflow id and its actions
 *                pending, which is the durable record that it still has to start: `redispatchPlans` starts it on the
 *                next decision or Continue (audit api-services-15).
 */
import { buildSystemPrompt, chiefOfStaff, getTemplateByAgentType } from "@foundmill/agents";
import { APP_NAME, LIMITS } from "@foundmill/config";
import { repos, type Agent, type Business, type Department, type Executor, type PlanAction as PlanActionRow, type PlanWithActions } from "@foundmill/db";
import { compileOptionPlan as compileOptionPlanRules, compilePlanRuleBased, PLAN_ACTION_PARAMS, PlanOutput, SetAgentModelParams, UpdateRoadmapParams, type DecisionOption, type ModelClient, type OptionAgent, type PlanAction, type RoadmapItemRef } from "@foundmill/models";
import { agentAutonomy, agentPrincipal, evaluate, type EvaluateResult, type ToolCtxInput } from "@foundmill/policy";
import { AppError, CHANNEL_KEYS, CHANNEL_META, CreatePlaybookParams, ForbiddenError, hasSectionAccess, MODEL_KEYS, planActionSection, planSectionWalls, TASK_KINDS, type ChannelKey, type ModelKey, type ModuleKey, type PlanActionType, type PolicyOutcome, type Section, type SectionMembership, type TaskKind } from "@foundmill/shared";
import { changeAgentModels } from "./agent-model";
import { assertChannelMayRun, CHANNEL_NOT_AVAILABLE, channelRowsFor, FOUNDER_POSTS_CHANNEL, runnableChannels, type ChannelAvailabilityScope } from "./channel-availability";
import { DISTRIBUTION_NOT_STARTED } from "./engines";
import type { TemporalService } from "./temporal";
import { WORKFLOWS, workflowIds } from "./temporal";

export interface PlanContext {
  business: Business;
  agents: readonly Agent[];
  holidayActive: boolean;
  /** The active vacation's budget ceiling: while it lasts it caps every plan spend, as it caps every tool call. */
  holidayBudgetMinor?: number | null;
  currency: string;
  /** The roadmap the compiler names items from (an `update_roadmap` action carries the id of the item it changes). */
  roadmap?: readonly RoadmapItemRef[];
  /**
   * What the chosen decision option is: an option marked not reversible is evaluated as an irreversible step and a
   * costed one as spending its cost, so Assisted and Augmented ask before a one-click choice does what cannot be
   * undone or spends past the threshold (audit AC-02). Absent for free text, whose actions carry their own amounts.
   */
  choice?: { reversible?: boolean; costMinor?: number };
}

/**
 * The agents as the compilers see them: who runs which channel (the template it was hired from) and which template it
 * is, so a channel's work goes to the agent running the channel and never to whoever has "Lead" in the title (audit
 * FR-20), and an option's `assignee` names its template.
 */
export function planAgents(agents: readonly Agent[]): OptionAgent[] {
  return agents.map((a) => {
    const template = getTemplateByAgentType(a.agentType);
    return { id: a.id, name: a.name, role: a.role, department_id: a.departmentIds[0] ?? undefined, ...(template?.channelKey ? { channel: template.channelKey } : {}), ...(template ? { template_key: template.key } : {}) };
  });
}

/**
 * Only the business's own agents act in its plans (audit api-services-28): an agent id the model wrote that is not one
 * of them (made up, pasted, another business's) is dropped from the action and from its params, so the action falls
 * back to the Chief of Staff instead of failing the decision or writing a foreign id into a task.
 */
export function ownAgentsOnly(actions: readonly PlanAction[], agents: readonly Pick<Agent, "id">[]): PlanAction[] {
  const own = new Set(agents.map((a) => a.id));
  return actions.map((a) => {
    const agentId = a.agent_id && own.has(a.agent_id) ? a.agent_id : null;
    const foreign = typeof a.params.agent_id === "string" && !own.has(a.params.agent_id);
    return { ...a, agent_id: agentId, params: foreign ? { ...a.params, agent_id: null } : a.params };
  });
}

export interface CompiledPlan {
  summary: string;
  actions: PlanAction[];
  source: "model" | "rules";
}

/**
 * Compile the founder's instruction into typed actions. The rule engine reads it first and decides every hard gate: an
 * instruction with one (money, signing, filings, terms, deletion, security) compiles to the rules' plan, with
 * `request_human_action` for each gated clause, and the model is not asked (audit MB-3). A live plan may never automate
 * a gated clause (BUILD §2.2), so that was already the outcome whenever the model proposed any automated action beside a
 * gate; the model's plan stood only when it, too, left everything to the founder (or proposed nothing at all). Policy
 * and section checks run on the compiled plan wherever it is staged, whichever compiled it.
 */
export async function compilePlan(models: ModelClient, text: string, ctx: PlanContext): Promise<CompiledPlan> {
  const rules = compilePlanRuleBased(text, { agents: planAgents(ctx.agents), defaultCurrency: ctx.currency, roadmap: ctx.roadmap });
  if (rules.actions.some((a) => a.type === "request_human_action")) return { summary: rules.summary, actions: rules.actions, source: "rules" };
  const agents = ctx.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, agent_type: a.agentType, department_id: a.departmentIds[0] ?? null, channel: getTemplateByAgentType(a.agentType)?.channelKey ?? null }));
  const roadmap = (ctx.roadmap ?? []).map((r) => ({ id: r.id, title: r.title, horizon: r.horizon, target_start: r.targetStart, target_end: r.targetEnd }));
  const input = {
    business: { id: ctx.business.id, name: ctx.business.name, business_mode: ctx.business.businessMode, archetype: ctx.business.archetype, currency: ctx.currency },
    reply: text,
    agents,
    roadmap,
    action_types: [...Object.keys(ACTION_TOOLS)],
    // Each action's params by name: what the api and the orchestrator read (audit VRB-X1).
    action_params: PLAN_ACTION_PARAMS,
  };
  const result = await models.complete({
    route: "planCompiler",
    schema: PlanOutput,
    // House rules first (audit-conversation P1): the Chief of Staff compiles plans, so its instructions follow them.
    system: [
      buildSystemPrompt({ businessName: ctx.business.name, appName: APP_NAME, template: chiefOfStaff }),
      "You are the plan compiler. Turn the founder's reply into typed actions. Hard-gated requests (money, signing, filings, terms, deletion, security, untrusted instructions) compile to request_human_action only. Write each action's params with exactly the names in `action_params`; a roadmap change carries the `roadmap_item_id` of the item it changes, taken from `roadmap`, and agent ids come from `agents`.",
      PLAYBOOK_PROMPT,
    ],
    cacheSystem: true,
    messages: [{ role: "user", content: "```json\n" + JSON.stringify(input) + "\n```" }],
    attribution: { businessId: ctx.business.id, kind: "plan_compiler" },
  });
  // A playbook the model wrote must match the contract the engine runs; otherwise the rule engine's reading stands.
  if (result.json.actions.some((a) => a.type === "create_playbook" && !CreatePlaybookParams.safeParse(a.params).success)) {
    return { summary: rules.summary, actions: rules.actions, source: "rules" };
  }
  return { summary: result.json.summary, actions: ownAgentsOnly(result.json.actions, ctx.agents), source: models.mode === "mock" ? "rules" : "model" };
}

/** What the plan compiler is told about `create_playbook` (the contract of packages/shared `CreatePlaybookParams`). */
const PLAYBOOK_PROMPT = [
  "A standing rule (\"when a lead replies positively, draft a reply and book a call; I approve the first message\") compiles to ONE create_playbook action, never to one-off actions.",
  "Its params: {source_text, name, trigger: {event, where?, condition?}, steps: [{action: {type, params}, label}], approvals: [{step, scope}], stop: {max_runs?}}.",
  "event is a platform event type such as lead.replied, signup.created, payment.received, customer.converted, runway.threshold_crossed or task.completed; where narrows it by payload field (sentiment: positive).",
  "Each step is one plan action (not create_playbook, not reply_only). approvals name a step by its 0-based index and a scope, first_run or every_run, for what the founder says they approve.",
  "If the founder names no event, answer with one reply_only question asking which event starts the rule.",
].join(" ");

export type { DecisionOption } from "@foundmill/models";

/** The part of an option the policy needs (`PlanContext.choice`). */
export function choiceOf(option: Pick<DecisionOption, "reversible" | "cost_minor">): NonNullable<PlanContext["choice"]> {
  const cost = Number(option.cost_minor);
  return { ...(typeof option.reversible === "boolean" ? { reversible: option.reversible } : {}), ...(Number.isFinite(cost) && cost > 0 ? { costMinor: Math.round(cost) } : {}) };
}

/**
 * An option click (BUILD §11.3: "option click or free text → (free text) Opus compiles a Plan"): compiled in-process
 * with no model call on the click path (`compileOptionPlan` in @foundmill/models, which the Chief of Staff's vacation
 * decisions use too). An option written with its own typed actions runs those; any other compiles its label only; its
 * cost becomes a budget or an approved spend that policy checks. Free text keeps `compilePlan` (Opus).
 */
export function compileOptionPlan(option: DecisionOption, item: { fromAgentId: string | null; subject: string }, ctx: PlanContext): CompiledPlan {
  const plan = compileOptionPlanRules(option, item, { agents: planAgents(ctx.agents), defaultCurrency: ctx.currency });
  return { summary: plan.summary, actions: ownAgentsOnly(plan.actions, ctx.agents), source: "rules" };
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

/** The section each plan action changes (BUILD §11.9; audit RUI-01): one definition in @foundmill/shared for every service. */
export const sectionForAction = planActionSection;

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
export const sectionWalls = planSectionWalls;

/**
 * Refuses (403, before anything is written) a plan that changes a section the person cannot write to: the item stays
 * open for someone who can. Policy-denied actions never run, so they are not counted.
 */
export function assertPlanSectionAccess(membership: SectionMembership, actions: readonly { type: PlanActionType; params?: unknown; denied?: boolean }[]): void {
  const refusal = planSectionRefusal(membership, actions);
  if (refusal) throw new ForbiddenError(refusal);
}

/** Why this person may not run the plan (the walls `assertPlanSectionAccess` refuses on), or null when they may. */
export function planSectionRefusal(membership: SectionMembership, actions: readonly { type: PlanActionType; params?: unknown; denied?: boolean }[]): string | null {
  const walls = sectionWalls(membership, actions.filter((a) => !a.denied));
  if (walls.length === 0) return null;
  const sections = walls.map((w) => w.section);
  const doing = [...new Set(walls.flatMap((w) => w.actionTypes))].map((t) => ACTION_WORDS[t]);
  const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return `You do not have write access to ${list(sections)}, and this plan would ${list(doing)}. Someone with that access can decide it.`;
}

/**
 * The section walls of a free-text instruction, checked before the plan compiler (Opus) is asked (SEC2 S3): the rule
 * engine reads the instruction in-process (no model call), and when what it finds already changes a section this person
 * cannot write to, the request is refused (403) before anything is spent. The compiled plan is checked again afterwards,
 * since the model may find more than the rules do.
 */
export function assertInstructionSectionAccess(membership: SectionMembership, text: string, ctx: PlanContext): void {
  const agents = ctx.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, department_id: a.departmentIds[0] ?? undefined }));
  const rules = compilePlanRuleBased(text, { agents, defaultCurrency: ctx.currency });
  const evaluations = evaluatePlan(rules.actions, ctx);
  assertPlanSectionAccess(membership, evaluations.map((e) => ({ type: e.action.type, params: e.action.params, denied: e.outcome === "deny" })));
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

/** What an agent with no spend allowance of its own says when a plan asks it to spend: the reason on "Needs your go-ahead". */
export const SPEND_ALLOWANCE_ASK = "Please set up my spend allowance";
/** The policy id of that ask (the refusal it replaces is Cedar's `spend-cap-exceeded`). */
export const SPEND_ALLOWANCE_POLICY_ID = "spend-allowance-needed";
const SPEND_CAP_POLICY_ID = "spend-cap-exceeded";

/**
 * A spend in a plan, assigned to an agent whose own allowance is nil (a lead, the Chief of Staff, or the Distribution
 * strategist standing in for a channel nobody runs yet: their templates spend nothing themselves), is not refused: the
 * founder is asked, and the agent says what is missing. Nothing runs until the founder confirms, as for any ask. Only
 * that case: an agent that has an allowance the amount exceeds, and an amount above an active vacation's budget
 * ceiling, are still refused, and so is anything a second policy also forbids.
 */
function needsSpendAllowance(result: EvaluateResult, agent: Agent | undefined, scope: { businessMode: Business["businessMode"]; holidayActive: boolean; holidayBudgetMinor: number | null }, amountMinor: number): boolean {
  if (result.outcome !== "deny" || result.policyIds.length !== 1 || result.policyIds[0] !== SPEND_CAP_POLICY_ID) return false;
  if (!agent || agentAutonomy(agent, scope.businessMode).spendCapMinor !== 0) return false;
  return !(scope.holidayActive && scope.holidayBudgetMinor !== null && amountMinor > scope.holidayBudgetMinor);
}

/**
 * A plan action as `repos.plans.create` stages it. An action that asks keeps the reasons it asks for, where a reload
 * or another device reads them ("Here is what will happen" shows them under the action).
 */
export function stagedAction(e: ActionEvaluation) {
  return { type: e.action.type, params: e.action.params, agentId: e.action.agent_id, policyOutcome: e.outcome, ...(e.outcome === "ask" && e.reasons.length > 0 ? { result: { policyReasons: e.reasons } } : {}) };
}

/** Evaluate every action against the policies; internal actions are allowed without a Cedar round-trip. */
export function evaluatePlan(actions: readonly PlanAction[], ctx: PlanContext): ActionEvaluation[] {
  const chief = ctx.agents.find((a) => a.agentType === "chief_of_staff") ?? ctx.agents[0];
  return actions.map((action) => {
    const tool = ACTION_TOOLS[action.type];
    const hardGate = action.type === "request_human_action";
    const irreversible = ctx.choice?.reversible === false && !hardGate && action.type !== "reply_only";
    const choiceCost = ctx.choice?.costMinor ?? 0;
    // An internal step is allowed without a Cedar round trip, unless the choice behind it cannot be undone or costs money.
    if (tool.internal && !irreversible && choiceCost === 0) return { action, outcome: "allow", reasons: [], policyIds: [], hardGate };
    const agent = (action.agent_id && ctx.agents.find((a) => a.id === action.agent_id)) || chief;
    // The acting agent's own settings, as the gateway applies them to its tool calls (audit api-services-03).
    const scope = { businessMode: ctx.business.businessMode, businessSpendCapMinor: ctx.business.spendCapMinor ?? null, holidayActive: ctx.holidayActive, holidayBudgetMinor: ctx.holidayBudgetMinor ?? null };
    const result: EvaluateResult = evaluate({
      principal: agent
        ? agentPrincipal(agent, scope, { department: "team" })
        : { id: "chief_of_staff", department: "team", type: "chief_of_staff", modelKey: "opus", autonomy: "inherit", approvalThresholdMinor: Math.min(LIMITS.approvalThresholdMinorDefault, ctx.business.spendCapMinor ?? Number.MAX_SAFE_INTEGER) },
      tool: { connector: tool.connector, name: tool.name, spendsMoney: tool.spendsMoney || choiceCost > 0 || undefined, contactsThirdParty: tool.contactsThirdParty, ...(irreversible ? { irreversible: true } : {}) },
      business: { id: ctx.business.id, businessMode: ctx.business.businessMode, holidayActive: ctx.holidayActive },
      context: { amountMinor: Math.max(amountOf(action), choiceCost), holidayActive: ctx.holidayActive },
    });
    const amountMinor = Math.max(amountOf(action), choiceCost);
    if (needsSpendAllowance(result, agent, scope, amountMinor)) return { action, outcome: "ask", reasons: [SPEND_ALLOWANCE_ASK], policyIds: [SPEND_ALLOWANCE_POLICY_ID], hardGate };
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
  /** The business's own currency (`businesses.currency`, 0025) for an amount the plan did not price in one. */
  currency: string;
  /**
   * What channel availability is read from (the request's env and business). With it, a plan never turns on a channel
   * that cannot really act (founder, 2026-11-11): that action is recorded as denied with the founder's sentence.
   */
  availability?: ChannelAvailabilityScope;
}

const isChannelKey = (v: unknown): v is ChannelKey => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
const isTaskKind = (v: unknown): v is TaskKind => typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v : fallback);

/** A channel a plan action switched on or off in-process; its engine follows after commit (`syncChannelEngines`). */
export interface ChannelToggle {
  channelId: string;
  channelKey: ChannelKey;
  enabled: boolean;
}

/** Model retests a plan's model change queued; their workflows start after commit (`startModelRetests`). */
export interface ModelRetests {
  retests: string[];
  superseded: string[];
}

/**
 * Execute a plan's pending actions. Runs inside the caller's transaction for the in-process actions; the orchestrator
 * dispatch, the channel engines (`channels`) and model retests (`models`) happen after commit (the caller passes the
 * result through).
 */
export async function executePlanActions(tx: Executor, businessId: string, plan: PlanWithActions, opts: ExecuteOptions): Promise<Omit<ExecuteResult, "dispatch"> & { needsOrchestrator: boolean; channels: ChannelToggle[]; models: ModelRetests }> {
  const executed: string[] = [];
  const deferred: string[] = [];
  const denied: string[] = [];
  const channels: ChannelToggle[] = [];
  const models: ModelRetests = { retests: [], superseded: [] };
  for (const action of plan.actions) {
    if (action.status !== "pending") continue;
    if (action.policyOutcome === "deny") {
      await repos.plans.finishAction(tx, businessId, action.id, { status: "denied", result: { reason: "policy denied" } });
      denied.push(action.id);
      continue;
    }
    // A channel that cannot really act is not turned on, and neither is anything spent or planned on it through this
    // plan: the action is refused in the founder's words (one in offline tracking may be turned on).
    const refusal = await channelRefusalFor(tx, businessId, action, opts);
    if (refusal) {
      await repos.plans.finishAction(tx, businessId, action.id, { status: "denied", result: { reason: refusal, code: CHANNEL_NOT_AVAILABLE } });
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
      if (action.type === "set_agent_model") {
        models.retests.push(...strings(handled.retests));
        models.superseded.push(...strings(handled.superseded));
      }
    } else deferred.push(action.id);
  }
  return { executed, deferred, denied, needsOrchestrator: deferred.length > 0, channels, models };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The founder's sentence when a plan action would turn on a channel that cannot run; null when it may. */
async function channelRefusalFor(tx: Executor, businessId: string, action: PlanActionRow, opts: ExecuteOptions): Promise<string | null> {
  if (action.type !== "enable_channel" || !opts.availability) return null;
  const channel = (action.params as Record<string, unknown>).channel;
  if (!isChannelKey(channel)) return null;
  const existing = await repos.channels.getByKey(tx, businessId, channel);
  try {
    await assertChannelMayRun(tx, opts.availability, { channelKey: channel, kitMode: existing ? existing.kitMode : CHANNEL_META[channel].kitModeByDefault });
    return null;
  } catch (err) {
    if (err instanceof AppError && err.code === CHANNEL_NOT_AVAILABLE) return err.message;
    throw err;
  }
}

/**
 * The engine workflow follows a channel a plan switched (AC-11.7.2), as the Board toggle does
 * (`distribution.channels.enable`): enabling starts `channelEngine`, disabling signals it to stop. Called after the
 * plan's transaction commits; without Temporal the channel stays enabled and the result says why (audit VGJC-X1).
 */
export async function syncChannelEngines(ctx: { db: Executor; temporal: TemporalService; businessId: string; userId: string } & Partial<Pick<ChannelAvailabilityScope, "env" | "business">>, toggles: readonly ChannelToggle[]) {
  const results: { channelId: string; workflow: Awaited<ReturnType<TemporalService["start"]>> }[] = [];
  // Before the founder has started distribution (0062) an enabled channel keeps its place on the board, but no engine
  // starts and none is recorded: Start distribution starts them all.
  const started = toggles.some((t) => t.enabled) ? await repos.businesses.distributionStarted(ctx.db, ctx.businessId) : true;
  // A channel the founder posts by tap keeps its place on the board and gets no engine (founder, 2026-11-12): no agent
  // can publish there. Known only where the caller carries the deployment's env and the business (every request does).
  const turnedOn = toggles.filter((t) => t.enabled);
  let noEngine = new Set<string>();
  if (turnedOn.length > 0 && ctx.env && ctx.business) {
    const rows = await repos.channels.list(ctx.db, ctx.businessId, { enabled: true });
    const runnable = new Set((await runnableChannels(ctx.db, { env: ctx.env, businessId: ctx.businessId, business: ctx.business }, rows)).map((c) => c.id));
    noEngine = new Set(rows.filter((c) => !runnable.has(c.id)).map((c) => c.id));
  }
  for (const t of toggles) {
    const workflowId = workflowIds.engine(t.channelId);
    const workflow = t.enabled
      ? noEngine.has(t.channelId)
        ? { queued: false, workflowId, reason: FOUNDER_POSTS_CHANNEL }
        : started
          ? await ctx.temporal.start(WORKFLOWS.channelEngine, { workflowId, args: [{ businessId: ctx.businessId, channelId: t.channelId, channelKey: t.channelKey }] })
          : { queued: false, workflowId, reason: DISTRIBUTION_NOT_STARTED }
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

export type DispatchResult = Awaited<ReturnType<typeof dispatchPlan>>;

/**
 * Start the plans an earlier dispatch left behind (audit api-services-15): a plan whose `planExecution` start did not
 * reach Temporal stays executing with no workflow id and its actions pending, and is started here, oldest first, on the
 * next decision or Continue. The workflow id is recorded only once Temporal took the start (a deterministic id, so a
 * plan started twice at once runs once). Nothing starts while the team is stopped; resuming and pressing Continue does.
 */
export async function redispatchPlans(ctx: { db: Executor; temporal: TemporalService; businessId: string }, options: { limit?: number } = {}): Promise<{ planId: string; dispatch: DispatchResult }[]> {
  const stranded = await repos.plans.awaitingDispatch(ctx.db, ctx.businessId, { limit: options.limit ?? 20 });
  if (stranded.length === 0 || (await repos.businesses.agentsStopped(ctx.db, ctx.businessId))) return [];
  const out: { planId: string; dispatch: DispatchResult }[] = [];
  for (const plan of stranded) {
    const dispatch = await dispatchPlan(ctx.temporal, ctx.businessId, plan.id);
    if (dispatch.queued) await repos.plans.setWorkflowId(ctx.db, ctx.businessId, plan.id, dispatch.workflowId);
    out.push({ planId: plan.id, dispatch });
    // Temporal is not answering: the rest wait for the next try instead of each paying the timeout.
    if (!dispatch.queued) break;
  }
  return out;
}

/** Where each kind of work lives when the task names no channel and its agent belongs to no department. */
const KIND_MODULE: Record<TaskKind, ModuleKey> = { code: "development", specialist: "development", research: "product", channel: "distribution", finance: "finance", legal: "legal", ops: "team" };

/**
 * The department a decision's task belongs to, so it shows on that department's Home card and lists (audit VAC-X1):
 * a channel's work is Distribution's; otherwise the department of the agent doing it; otherwise the department whose
 * modules hold that kind of work (specialist work is Operations' when the business has one). Never by name (BUILD §2.1
 * rule 5): by module, and Operations by its slug.
 */
async function departmentForTask(tx: Executor, businessId: string, task: { channel: ChannelKey | null; kind: TaskKind; assigneeAgentId: string | null }): Promise<string | null> {
  const departments: Department[] = await repos.departments.list(tx, businessId);
  const byModule = (m: ModuleKey) => departments.find((d) => d.moduleKeys.includes(m))?.id ?? null;
  if (task.channel) return byModule("distribution");
  if (task.assigneeAgentId) {
    const agent = await repos.agents.get(tx, businessId, task.assigneeAgentId).catch(() => null);
    const own = agent?.departmentIds.find((id) => departments.some((d) => d.id === id));
    if (own) return own;
  }
  if (task.kind === "specialist") return departments.find((d) => d.slug === "operations")?.id ?? byModule("development");
  return byModule(KIND_MODULE[task.kind]);
}

async function executeLocally(tx: Executor, businessId: string, action: PlanActionRow, opts: ExecuteOptions): Promise<Record<string, unknown> | null> {
  const p = action.params as Record<string, unknown>;
  switch (action.type) {
    case "create_task": {
      const kind = isTaskKind(p.kind) ? p.kind : "ops";
      const channel = isChannelKey(p.channel) ? p.channel : null;
      const departmentId = await departmentForTask(tx, businessId, { channel, kind, assigneeAgentId: action.agentId });
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
        departmentId,
      });
      return { taskId: task.id, channel, departmentId };
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
        // A budget on a channel with no row yet creates the row; it goes on the board only if the team can run the
        // channel (one the founder posts by tap has nothing to spend a budget on, so a budget never puts it there).
        const onBoard = opts.availability ? (await channelRowsFor(tx, opts.availability)).teamRuns.includes(p.channel) : true;
        const existing = (await repos.channels.getByKey(tx, businessId, p.channel)) ?? (await repos.channels.upsert(tx, businessId, { channelKey: p.channel, line: CHANNEL_META[p.channel].line, enabled: onBoard, ownerAgentId: action.agentId }));
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
      // Exactly what Agent profile › Model does (audit api-services-28): locked work is skipped, a downgrade warns and
      // each changed agent's retest is queued. "all" and "type" widen it past the one agent the compiler named; the shared
      // param names (`apply_scope`, or the older `scope`) are read the same way here and in the orchestrator.
      const parsed = SetAgentModelParams.safeParse(p);
      if (!parsed.success) return null;
      const scope = parsed.data.apply_scope;
      const targetId = parsed.data.agent_id ?? action.agentId ?? "";
      if (scope === "agent" && !targetId) return null;
      const all = scope === "agent" ? [] : (await repos.agents.list(tx, businessId, { limit: 500 })).items;
      const target = targetId ? await repos.agents.get(tx, businessId, targetId).catch(() => null) : null;
      const targets = scope === "all" ? all : scope === "type" ? (target ? all.filter((a) => a.agentType === target.agentType) : []) : target ? [target] : [];
      if (targets.length === 0) return null;
      const change = await changeAgentModels(tx, businessId, targets, parsed.data.model_key, opts.actorUserId);
      return { modelKey: parsed.data.model_key, applyScope: scope, ...change };
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
    case "approve_spend": {
      // A spend the founder approves with the decision (an option's cost; "approve the €500"): recorded here, with the
      // amount policy checked. Resolving an agent's pending approval (`approval_id`) is the orchestrator's.
      const amount = typeof p.amount_minor === "number" && p.amount_minor > 0 ? Math.round(p.amount_minor) : null;
      if (amount === null || typeof p.approval_id === "string") return null;
      return { approvedMinor: amount, currency: str(p.currency, opts.currency).toUpperCase(), what: str(p.what, "the decision"), approvedBy: opts.actorUserId, decidedOption: str(p.decided_option) || null };
    }
    case "update_roadmap": {
      // A new roadmap item (`create` with a title) is written here, so a call's agreed item exists at once even without
      // the orchestrator (Team call, docs/TEAM_CALL.md §5); a change to an existing item stays the orchestrator's.
      const parsed = UpdateRoadmapParams.safeParse(p);
      if (!parsed.success || !parsed.data.create || !parsed.data.title) return null;
      const params = parsed.data;
      const created = await repos.product.upsertRoadmapItem(tx, businessId, { title: params.title!, descriptionMd: params.description ?? params.change ?? "", horizon: params.horizon ?? "next", targetStart: params.target_start ?? null, targetEnd: params.target_end ?? null, ...(params.confidence ? { confidence: params.confidence } : {}) });
      return { roadmapItemId: created.id, created: true };
    }
    case "update_spec":
    case "send_message":
    case "schedule_meeting":
    case "hire_agent":
    case "train_agent":
    case "create_playbook":
      return null; // orchestrator work (agents, approvals, playbook compilation)
    default:
      return null;
  }
}
