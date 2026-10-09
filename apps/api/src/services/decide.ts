/**
 * inbox.decide (BUILD §11.3 "Decision → execution", AC-11.3.4, AC-11.3.5).
 *
 * option click (rule engine, in-process) or free text (plan compiler, Opus) → plan → policy per action → inside policy:
 * write plan + plan_actions and execute
 * / outside: return `{ requiresConfirmation: true, plan }` → item marked answered (releases Continue) →
 * `decision.made` through the outbox → follow-up Update item with links to the artefacts.
 */
import { classifyFounderText } from "@foundmill/agents";
import { repos, type DbTx, type Decision, type InboxItem, type PlanWithActions } from "@foundmill/db";
import { ValidationError } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { compileOptionPlan, compilePlan, dispatchPlan, evaluatePlan, executePlanActions, requiresConfirmation, type ActionEvaluation, type PlanContext } from "./plans";

export interface DecideItemInput {
  itemId: string;
  chosenOption?: string | null;
  freeText?: string | null;
}

export interface DecideItemResult {
  item: InboxItem;
  decision: Decision;
  plan: PlanWithActions;
  evaluations: ActionEvaluation[];
  requiresConfirmation: boolean;
  executed: string[];
  deferred: string[];
  denied: string[];
  dispatch: { queued: boolean; workflowId: string; reason?: string } | null;
  followUp: InboxItem | null;
}

interface ItemOption {
  id: string;
  label: string;
  consequence?: string;
}

export async function planContextFor(ctx: BusinessContext): Promise<PlanContext> {
  const [agents, holiday] = await Promise.all([repos.agents.list(ctx.db, ctx.businessId, { limit: 200 }), repos.holidays.current(ctx.db, ctx.businessId)]);
  return { business: ctx.business, agents: agents.items, holidayActive: holiday !== null, currency: "EUR" };
}

export async function decideInboxItem(ctx: BusinessContext, input: DecideItemInput): Promise<DecideItemResult> {
  const chosenOption = input.chosenOption?.trim() || null;
  const freeText = input.freeText?.trim() || null;
  if (!chosenOption && !freeText) throw new ValidationError("Choose an option or write what should happen");
  // Only an instruction decides an item from free text (audit-conversation P0). A question, a greeting, "thanks" or
  // "not now" names nothing to do: the plan compiler could only turn it into `reply_only` and the item would be used up
  // with nothing done. The Inbox sends free text through `agent.conversation.inboxReply`, which answers it at the
  // agent's desk instead.
  const intent = !chosenOption && freeText ? classifyFounderText(freeText) : null;
  if (intent === "question" || intent === "greeting") {
    throw new ValidationError("That reads as a question, so nothing was decided. Ask the agent in the conversation instead.", { route: "conversation", itemId: input.itemId });
  }
  if (intent === "acknowledge" || intent === "decline") {
    throw new ValidationError("That doesn't say what should happen, so nothing was decided. Pick an option, or say what you want done.", { route: "conversation", itemId: input.itemId });
  }

  const item = await ctx.rls((tx) => repos.inbox.get(tx, ctx.businessId, input.itemId));
  const options = ((item.decision as { options?: ItemOption[] } | null)?.options ?? []) as ItemOption[];
  const option = chosenOption ? options.find((o) => o.id === chosenOption) : undefined;
  if (chosenOption && !option) throw new ValidationError("chosenOption is not one of the item's options", { chosenOption, options: options.map((o) => o.id) });

  const planCtx = await planContextFor(ctx);
  // Only free text goes to the plan compiler model (BUILD §11.3); an option click compiles in-process, so the founder
  // never waits on a model call for a pre-written answer.
  const compiled = freeText ? await compilePlan(ctx.models, freeText, planCtx) : compileOptionPlan(option!, item, planCtx);
  const evaluations = evaluatePlan(compiled.actions, planCtx);
  const confirm = requiresConfirmation(evaluations);

  const written = await ctx.rls(async (tx) => {
    const plan = await repos.plans.create(tx, ctx.businessId, {
      origin: freeText ? "free_text" : "option",
      summaryMd: compiled.summary,
      inboxItemId: item.id,
      status: confirm ? "pending_confirmation" : "executing",
      actions: evaluations.map((e) => ({ type: e.action.type, params: e.action.params, agentId: e.action.agent_id, policyOutcome: e.outcome })),
    });
    const decided = await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption, freeText, decidedByKind: "user", decidedBy: ctx.userId, planId: plan.id });
    const exec = confirm ? { executed: [], deferred: plan.actions.map((a) => a.id), denied: [], needsOrchestrator: false } : await executePlanActions(tx, ctx.businessId, plan, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency });

    await emit(tx, ctx, {
      type: "decision.made",
      payload: {
        decisionId: decided.decision.id,
        inboxItemId: item.id,
        chosenOption,
        freeText,
        decidedBy: "user",
        planId: plan.id,
        planActionCount: plan.actions.length,
        hardGateActions: evaluations.filter((e) => e.hardGate).length,
      },
    });
    await audit(tx, ctx, {
      action: "inbox.decide",
      target: { kind: "inbox_item", id: item.id },
      details: { chosenOption, freeText: freeText ? freeText.slice(0, 500) : null, planId: plan.id, requiresConfirmation: confirm, actionTypes: plan.actions.map((a) => a.type) },
    });

    const followUp = confirm ? null : await writeFollowUp(tx, ctx, item, plan, compiled.summary, exec.executed.length, exec.deferred.length);
    const refreshed = await repos.plans.get(tx, ctx.businessId, plan.id);
    return { plan: refreshed, decided, exec, followUp };
  });

  const dispatch = !confirm && written.exec.needsOrchestrator ? await dispatchPlan(ctx.temporal, ctx.businessId, written.plan.id) : null;
  if (dispatch?.queued) await repos.plans.setWorkflowId(ctx.db, ctx.businessId, written.plan.id, dispatch.workflowId);

  return {
    item: written.decided.item,
    decision: written.decided.decision,
    plan: written.plan,
    evaluations,
    requiresConfirmation: confirm,
    executed: written.exec.executed,
    deferred: written.exec.deferred,
    denied: written.exec.denied,
    dispatch,
    followUp: written.followUp,
  };
}

/** Confirm a plan that policy flagged (BUILD §11.3 "Here is what will happen"). */
export async function confirmPlan(ctx: BusinessContext, planId: string) {
  const planCtx = await planContextFor(ctx);
  const written = await ctx.rls(async (tx) => {
    const plan = await repos.plans.get(tx, ctx.businessId, planId);
    if (plan.status !== "pending_confirmation") throw new ValidationError(`Plan is ${plan.status}, not awaiting confirmation`, { planId });
    await repos.plans.confirm(tx, ctx.businessId, planId);
    const confirmed = await repos.plans.get(tx, ctx.businessId, planId);
    const exec = await executePlanActions(tx, ctx.businessId, confirmed, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency });
    await audit(tx, ctx, { action: "plan.confirm", target: { kind: "plan", id: planId }, details: { executed: exec.executed.length, deferred: exec.deferred.length } });
    const item = plan.inboxItemId ? await repos.inbox.get(tx, ctx.businessId, plan.inboxItemId) : null;
    const followUp = item ? await writeFollowUp(tx, ctx, item, confirmed, confirmed.summaryMd, exec.executed.length, exec.deferred.length) : null;
    return { plan: await repos.plans.get(tx, ctx.businessId, planId), exec, followUp };
  });
  const dispatch = written.exec.needsOrchestrator ? await dispatchPlan(ctx.temporal, ctx.businessId, planId) : null;
  if (dispatch?.queued) await repos.plans.setWorkflowId(ctx.db, ctx.businessId, planId, dispatch.workflowId);
  return { ...written, dispatch };
}

async function writeFollowUp(tx: DbTx, ctx: BusinessContext, item: InboxItem, plan: PlanWithActions, summary: string, executed: number, deferred: number): Promise<InboxItem | null> {
  const from = item.fromAgentId ?? (await repos.agents.chiefOfStaff(tx, ctx.businessId))?.id ?? null;
  if (!from) return null;
  const lines = plan.actions.map((a) => `- ${describeAction(a.type, a.params as Record<string, unknown>)} — ${a.status}${a.policyOutcome === "ask" ? " (confirmed by you)" : ""}`);
  const body = [`Decided: ${item.subject}.`, "", summary, "", ...lines, "", executed > 0 || deferred > 0 ? `${executed} done now, ${deferred} handed to the team.` : "Nothing further to run."].join("\n");
  return repos.inbox.createItem(
    tx,
    ctx.businessId,
    { type: "update", from_agent_id: from, subject: `Decided: ${item.subject}`.slice(0, 80), body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: item.entityIds },
    { state: "unread" },
  );
}

function describeAction(type: string, p: Record<string, unknown>): string {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (type) {
    case "create_task":
      return `Task: ${s("title") || s("goal") || "new task"}`;
    case "enable_channel":
      return `Enable channel ${s("channel")}`;
    case "disable_channel":
      return `Disable channel ${s("channel")}`;
    case "set_budget":
      return `Budget ${typeof p.amount_minor === "number" ? (p.amount_minor / 100).toFixed(2) : "?"} ${s("currency")} for ${s("channel") || s("department") || "the business"}`;
    case "request_human_action":
      return `Founder action: ${s("request") || s("original_text")}`;
    case "reply_only":
      return s("question") ? `Question: ${s("question")}` : s("acknowledgement") || "No action";
    default:
      return type.replace(/_/g, " ");
  }
}
