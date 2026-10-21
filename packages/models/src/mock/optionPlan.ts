/**
 * An option click compiled into a plan (BUILD §11.3: "option click or free text → (free text) Opus compiles a Plan").
 *
 * The option was written with the Inbox item, so it compiles in-process, with no model call on the click path:
 *
 * - An option written with its own typed actions (the Board's first decision, the Import report's first decisions;
 *   `OptionAction` in @foundmill/shared) runs exactly those actions. Nothing is read out of its prose, so "Rebuild the
 *   Specification" is the Product Lead's spec task, not a task titled after a fragment of the consequence (audit
 *   IAE-20, SOAK-11, VIAE-X1, AC-01).
 * - Any other option (a composer-written one) compiles its label with the deterministic rule engine; the consequence
 *   describes what follows and is never parsed into actions. Hard gates still compile to `request_human_action` only.
 *   An action that cannot do anything as compiled (an approval with no amount, a model change with no model, training
 *   with no agent) is dropped (audit api-services-11).
 * - When nothing actionable is left, the agent who asked gets one task to carry the choice out (a clarifying question
 *   back to the founder would undo the click), and an option that means "not now" records the choice and runs nothing.
 * - The option's cost is part of the plan (audit FR-10, OL-11): a costed option spends, as a budget on the channel it
 *   works through, or else as a spend the founder approves, so policy sees the amount and a cost above the approval
 *   threshold asks first ("Here is what will happen").
 *
 * A pure function in @foundmill/models so that every place that decides an option can run the same plan for it: the
 * founder's `inbox.decide` (apps/api) today, and the Chief of Staff deciding on the founder's behalf while they are on
 * vacation (apps/orchestrator) as it moves to running its decisions as plans.
 */
import { CHANNEL_KEYS, CHANNEL_META, formatMoney, OptionAction, type ChannelKey, type PlanActionType } from "@foundmill/shared";
import type { PlanAction, PlanOutput } from "../schemas";
import type { AgentLike } from "./inputs";
import { compilePlanRuleBased } from "./planCompiler";

/** One of an Inbox decision's pre-written options (the Composer schema's `decision.options[]`). */
export interface DecisionOption {
  id: string;
  label: string;
  consequence?: string;
  /** What choosing it costs, in minor units of the business's currency (an Estimate written with the option). */
  cost_minor?: number;
  reversible?: boolean;
  /** What choosing it runs, written with the option; when present nothing is parsed from its words. */
  actions?: unknown;
}

/** An agent as an option plan sees it: the template it was hired from resolves an action's `assignee`. */
export interface OptionAgent extends AgentLike {
  template_key?: string;
}

export interface OptionPlanContext {
  agents: readonly OptionAgent[];
  /** ISO 4217 code of the business's own currency: an option's cost and any amount without one are in it. */
  defaultCurrency?: string;
}

/** A pre-written option that means "do nothing for now" (only consulted when the rules found no action in it). */
export const NO_ACTION_OPTION_RE = /^(?:not now|not yet|no thanks|skip(?: (?:it|this))?|dismiss|ignore(?: it| this)?|decline|hold off|wait(?: and see)?|do nothing|no change|stay the course|park (?:it|this)|leave (?:it|things) as (?:it is|they are)|keep (?:it|things) as (?:it is|they are))(?=$|[\s.,;:!?–—-])(?!\s+(?:on|with|to|for)\s)/i;

const isChannelKey = (v: unknown): v is ChannelKey => typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
const amountOf = (p: Record<string, unknown>): number => (typeof p.amount_minor === "number" && Number.isFinite(p.amount_minor) && p.amount_minor > 0 ? Math.round(p.amount_minor) : 0);

/** The typed actions written with the option, or null when it has none (or they do not parse). */
export function optionActions(option: Pick<DecisionOption, "actions">): OptionAction[] | null {
  const parsed = OptionAction.array().min(1).max(8).safeParse(option.actions);
  return parsed.success ? parsed.data : null;
}

/** Rule actions that cannot do anything as compiled; the option's own task carries the choice instead. */
function inert(action: PlanAction): boolean {
  const p = action.params;
  switch (action.type) {
    case "reply_only":
      return true;
    case "approve_spend":
      return amountOf(p) === 0 && typeof p.approval_id !== "string";
    case "set_agent_model":
      return typeof p.model_key !== "string";
    case "train_agent":
      return typeof p.agent_id !== "string" && action.agent_id === null;
    default:
      return false;
  }
}

export function compileOptionPlan(option: DecisionOption, item: { fromAgentId: string | null; subject: string }, ctx: OptionPlanContext): PlanOutput {
  const label = option.label.trim();
  const currency = (ctx.defaultCurrency ?? "USD").toUpperCase();
  const asker = (item.fromAgentId && ctx.agents.find((a) => a.id === item.fromAgentId)) || null;
  const typed = optionActions(option);

  let actions: PlanAction[];
  let said: string | null = null;
  if (typed) {
    actions = typed.map((a) => {
      const params: Record<string, unknown> = { ...a.params, decided_option: option.id };
      if (amountOf(params) > 0 && typeof params.currency !== "string") params.currency = currency;
      if (a.type === "create_task") params.decision = item.subject.slice(0, 200);
      return { type: a.type, params, agent_id: assigneeFor(ctx.agents, a, asker) };
    });
  } else {
    // The label says what was chosen; the consequence says what follows and is never compiled (audit SOAK-11).
    const rules = compilePlanRuleBased(label, { agents: [...ctx.agents], defaultCurrency: currency });
    actions = rules.actions.filter((a) => !inert(a));
    said = rules.summary;
  }

  if (actions.length === 0) {
    if (NO_ACTION_OPTION_RE.test(label)) {
      return { summary: `You chose "${label}". Nothing runs now.`, actions: [{ type: "reply_only", params: { acknowledgement: `You chose "${label}"; nothing runs now.`, option: option.id }, agent_id: null }] };
    }
    const goal = [label, option.consequence?.trim()].filter(Boolean).join(". ");
    actions = [{ type: "create_task", params: { kind: "ops", title: label.slice(0, 80), goal, decided_option: option.id, decision: item.subject.slice(0, 200) }, agent_id: asker?.id ?? null }];
    said = `${asker?.name ?? "The team"} carries out your choice: ${label}.`;
  }

  const spend = costAction(option, actions, currency, asker);
  if (spend) {
    // Right after the channel it funds is switched on (or first), so the budget is in place before the work starts.
    const at = spend.type === "set_budget" ? actions.findIndex((a) => a.type === "enable_channel" && a.params.channel === spend.params.channel) + 1 : 0;
    actions.splice(at, 0, spend);
  }
  const summary = said === null ? actions.map((a) => describe(a, ctx.agents)).join(" ") : [said, spend ? describe(spend, ctx.agents) : null].filter(Boolean).join(" ");
  return { summary, actions };
}

/**
 * The spend that carries the option's cost (audit FR-10, OL-11), or null when the plan already budgets it (or it costs
 * nothing). A plan that works through a channel budgets that channel; anything else is a spend the founder approves.
 * Either way policy sees the amount, so a cost above the approval threshold asks before it runs.
 */
function costAction(option: DecisionOption, actions: readonly PlanAction[], currency: string, asker: OptionAgent | null): PlanAction | null {
  const cost = typeof option.cost_minor === "number" && Number.isFinite(option.cost_minor) ? Math.round(option.cost_minor) : 0;
  const budgeted = actions.filter((a) => a.type === "set_budget" || a.type === "approve_spend").reduce((n, a) => n + amountOf(a.params), 0);
  const rest = cost - budgeted;
  if (rest <= 0) return null;
  const channelAction = actions.find((a) => isChannelKey(a.params.channel) && a.type !== "disable_channel");
  if (channelAction && isChannelKey(channelAction.params.channel)) {
    return { type: "set_budget", params: { channel: channelAction.params.channel, amount_minor: rest, currency, period: "monthly", cap: true, decided_option: option.id }, agent_id: channelAction.agent_id };
  }
  return { type: "approve_spend", params: { amount_minor: rest, currency, what: option.label.trim().slice(0, 200), decided_option: option.id }, agent_id: asker?.id ?? null };
}

/** Who does an option's action: the named template, else the agent running its channel, else the agent who asked. */
function assigneeFor(agents: readonly OptionAgent[], action: OptionAction, asker: OptionAgent | null): string | null {
  if (action.type === "request_human_action" || action.type === "reply_only") return null;
  if (action.assignee) {
    const named = agents.find((a) => a.template_key === action.assignee);
    if (named) return named.id;
  }
  const channel = action.params.channel;
  if (isChannelKey(channel)) {
    const runner = agents.find((a) => a.channel === channel);
    if (runner) return runner.id;
  }
  return asker?.id ?? null;
}

const ACTION_WORDS: Partial<Record<PlanActionType, string>> = {
  update_spec: "Propose a change to the spec",
  update_roadmap: "Update the roadmap",
  hire_agent: "Hire an agent",
  train_agent: "Run a training session",
  set_agent_model: "Change an agent's model",
  create_playbook: "Create a playbook",
  send_message: "Draft a message for your approval",
  schedule_meeting: "Schedule a meeting",
};

/** One sentence of the plan's summary for an option's action. */
function describe(action: PlanAction, agents: readonly OptionAgent[]): string {
  const p = action.params;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");
  const channel = isChannelKey(p.channel) ? CHANNEL_META[p.channel].label : null;
  const money = amountOf(p) > 0 ? formatMoney({ amountMinor: amountOf(p), currency: s("currency") || "USD" }) : null;
  const who = (action.agent_id && agents.find((a) => a.id === action.agent_id)?.name) || null;
  switch (action.type) {
    case "enable_channel":
      return `Enable ${channel ?? "the channel"}.`;
    case "disable_channel":
      return `Pause ${channel ?? "the channel"}.`;
    case "set_budget":
      return `Set a ${(s("period") || "monthly").replace("_", "-")} budget of ${money ?? "an amount"} (Estimate) for ${channel ?? (s("department") || "the business")}.`;
    case "approve_spend":
      return `Approve ${money ?? "the spend"} (Estimate) for ${s("what") || "this choice"}.`;
    case "create_task":
      return `${who ?? "The team"} takes on "${s("title").replace(/[.!]+$/, "")}".`;
    case "request_human_action":
      return `Ask you to handle "${s("request") || s("title")}" yourself.`;
    case "reply_only":
      return s("acknowledgement") || "Nothing runs now.";
    default:
      return `${ACTION_WORDS[action.type] ?? action.type.replace(/_/g, " ")}${s("change") ? `: ${s("change")}` : ""}.`;
  }
}
