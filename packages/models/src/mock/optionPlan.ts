/**
 * An option click compiled into a plan (BUILD §11.3: "option click or free text → (free text) Opus compiles a Plan").
 *
 * The option was written with the Inbox item, so the deterministic rule engine compiles it in-process, with no model
 * call on the click path; hard gates still compile to `request_human_action` only. When the rules find no action in the
 * option's words, the agent who asked gets one task to carry the choice out (a clarifying question back to the founder
 * would undo the click), and an option that means "not now" records the choice and runs nothing.
 *
 * A pure function shared by the two places that decide an option: the founder's `inbox.decide` (apps/api) and the
 * Chief of Staff deciding on the founder's behalf while they are on vacation (apps/orchestrator), so both run the same
 * plan for the same option.
 */
import type { PlanAction, PlanOutput } from "../schemas";
import type { AgentLike } from "./inputs";
import { compilePlanRuleBased } from "./planCompiler";

/** One of an Inbox decision's pre-written options. */
export interface DecisionOption {
  id: string;
  label: string;
  consequence?: string;
}

export interface OptionPlanContext {
  agents: readonly AgentLike[];
  /** ISO 4217 code for an amount the option names without a currency. */
  defaultCurrency?: string;
}

/** A pre-written option that means "do nothing for now" (only consulted when the rules found no action in it). */
export const NO_ACTION_OPTION_RE = /^(?:not now|not yet|no thanks|skip(?: (?:it|this))?|dismiss|ignore(?: it| this)?|decline|hold off|wait(?: and see)?|do nothing|no change|stay the course|park (?:it|this)|leave (?:it|things) as (?:it is|they are)|keep (?:it|things) as (?:it is|they are))(?=$|[\s.,;:!?–—-])(?!\s+(?:on|with|to|for)\s)/i;

export function compileOptionPlan(option: DecisionOption, item: { fromAgentId: string | null; subject: string }, ctx: OptionPlanContext): PlanOutput {
  const label = option.label.trim();
  const text = `${label}. ${option.consequence?.trim() ?? ""}`.trim();
  const rules = compilePlanRuleBased(text, { agents: [...ctx.agents], defaultCurrency: ctx.defaultCurrency });
  const actions: PlanAction[] = rules.actions.filter((a) => a.type !== "reply_only");
  if (actions.length > 0) return { summary: rules.summary, actions };
  if (NO_ACTION_OPTION_RE.test(label)) {
    return { summary: `You chose "${label}". Nothing runs now.`, actions: [{ type: "reply_only", params: { acknowledgement: `You chose "${label}"; nothing runs now.`, option: option.id }, agent_id: null }] };
  }
  const agent = (item.fromAgentId && ctx.agents.find((a) => a.id === item.fromAgentId)) || null;
  return {
    summary: `${agent?.name ?? "The team"} carries out your choice: ${label}.`,
    actions: [{ type: "create_task", params: { kind: "ops", title: label.slice(0, 80), goal: text, decided_option: option.id, decision: item.subject.slice(0, 200) }, agent_id: agent?.id ?? null }],
  };
}
