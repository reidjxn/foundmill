/**
 * inbox.decide (BUILD §11.3 "Decision → execution", AC-11.3.4, AC-11.3.5).
 *
 * option click (rule engine, in-process) or free text (plan compiler, Opus) → plan → policy per action → inside policy:
 * write plan + plan_actions and execute
 * / outside: return `{ requiresConfirmation: true, plan }` → item marked answered (releases Continue) →
 * `decision.made` through the outbox → follow-up Update item with links to the artefacts. A plan outside policy waits in
 * the database (`pending_confirmation`, each action's policy outcome) until `plan.confirm`, which needs only its id:
 * inbox.get hands the waiting confirmation back (`pendingConfirmation`) to whoever reopens the item.
 *
 * An approval's decision item (an agent's gated call waiting for the founder, audit FR-01) is answered without a plan
 * compiler: Approve or Reject resolves the approval (./approvals), records a one-line plan for the history, and the
 * decision reaches the session or wait that asked.
 */
import { classifyFounderText } from "@foundmill/agents";
import { approvalOutcomeOf, closeApprovalItem, repos, type Approval, type DbTx, type Decision, type InboxItem, type PlanWithActions } from "@foundmill/db";
import { ValidationError, hasSectionAccess, type SectionMembership } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { assertApprovalAccess, deliverApprovalAnswer, recordApprovalAnswer, type ApprovalAnswer } from "./approvals";
import { idsOfItem, inboxWalls, isWalled, loadRedactionSource, mentionIds, noteMask, redactInboxItem, redactPlan, redactValue } from "./inbox-redaction";
import { assertInstructionSectionAccess, assertPlanSectionAccess, choiceOf, compileOptionPlan, compilePlan, dispatchPlan, evaluatePlan, executePlanActions, planSectionRefusal, requiresConfirmation, syncChannelEngines, type ActionEvaluation, type ChannelToggle, type DecisionOption, type PlanContext } from "./plans";

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
  /** The answer to an approval's decision item: where it was delivered and what the task does next. */
  approval?: ApprovalAnswer | null;
}

type ItemOption = DecisionOption;

export async function planContextFor(ctx: BusinessContext): Promise<PlanContext> {
  const [agents, holiday, roadmap] = await Promise.all([repos.agents.list(ctx.db, ctx.businessId, { limit: 200 }), repos.holidays.current(ctx.db, ctx.businessId), repos.product.listRoadmap(ctx.db, ctx.businessId)]);
  // Amounts the founder writes without a symbol ("spend up to 300 on ads") are in the business's own currency (0025).
  return { business: ctx.business, agents: agents.items, holidayActive: holiday !== null, currency: ctx.business.currency, roadmap };
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
  // Refused before the plan compiler (a model call on the platform key) runs: answering an answered item again would
  // otherwise cost a call every time and only fail at the write. `repos.inbox.decide` re-checks it under the row lock.
  if (item.state === "answered" || item.state === "archived") throw new ValidationError(`Inbox item is already ${item.state}`, { itemId: item.id });
  const options = ((item.decision as { options?: ItemOption[] } | null)?.options ?? []) as ItemOption[];
  const option = chosenOption ? options.find((o) => o.id === chosenOption) : undefined;
  if (chosenOption && !option) throw new ValidationError("chosenOption is not one of the item's options", { chosenOption, options: options.map((o) => o.id) });
  // An agent's gated call waiting for the founder: Approve or Reject answers the approval itself.
  const approval = await ctx.rls((tx) => repos.approvals.forInboxItem(tx, ctx.businessId, item.id));
  if (approval) return decideApprovalItem(ctx, item, approval, { chosenOption, freeText });

  const planCtx = { ...(await planContextFor(ctx)), ...(option ? { choice: choiceOf(option) } : {}) };
  // Section walls hold in the Inbox too (audit RUI-01): a plan that changes a section the decider cannot write to is
  // refused before anything is written, and the item stays open for someone who can. Free text is read by the rule
  // engine first, so what it already shows is refused before the plan compiler (Opus) is paid for (SEC2 S3).
  if (freeText) assertInstructionSectionAccess(ctx.membership, freeText, planCtx);
  // Only free text goes to the plan compiler model (BUILD §11.3); an option click compiles in-process, so the founder
  // never waits on a model call for a pre-written answer.
  const compiled = freeText ? await compilePlan(ctx.models, freeText, planCtx) : compileOptionPlan(option!, item, planCtx);
  const evaluations = evaluatePlan(compiled.actions, planCtx);
  // The compiled plan's own walls (an option's actions are known here, before any model call).
  assertPlanSectionAccess(ctx.membership, evaluations.map((e) => ({ type: e.action.type, params: e.action.params, denied: e.outcome === "deny" })));
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
    const exec = confirm ? { executed: [], deferred: plan.actions.map((a) => a.id), denied: [], needsOrchestrator: false, channels: [] } : await executePlanActions(tx, ctx.businessId, plan, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency });

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
  await syncChannelEngines(ctx, written.exec.channels);

  return asSeenBy(ctx, item, {
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
  });
}

/**
 * Approve or Reject on an approval's decision item. Free text alongside the choice is the founder's reason (for a
 * rejection, the agent and the Chief of Staff note quote it); free text alone decides nothing. The plan written here
 * records the answer as one done action, so the item's history reads like any other decision; nothing is compiled
 * and no model is called.
 */
async function decideApprovalItem(ctx: BusinessContext, item: InboxItem, approval: Approval, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const outcome = approvalOutcomeOf(input.chosenOption);
  if (!outcome) throw new ValidationError("Choose Approve or Reject: this note asks about one call an agent wants to make.", { itemId: item.id, approvalId: approval.id });
  if (approval.outcome !== null) {
    // Settled some other way (a hold that went on by itself, an expiry, a plan): the note stops asking and stops
    // blocking Continue, instead of waiting for an answer nobody can give any more.
    await ctx.rls((tx) => closeApprovalItem(tx, ctx.businessId, approval));
    throw new ValidationError(`This request was already ${approval.outcome}`, { itemId: item.id, approvalId: approval.id });
  }
  // Section walls hold here too: approving a Stripe call needs Finance write, a GitHub call Development write.
  assertApprovalAccess(ctx.membership, approval);
  const note = input.freeText?.slice(0, 2000) ?? null;
  const written = await ctx.rls(async (tx) => {
    const recorded = await recordApprovalAnswer(tx, ctx, approval, outcome, note);
    const plan = await repos.plans.create(tx, ctx.businessId, {
      origin: "option",
      summaryMd: recorded.summary,
      inboxItemId: item.id,
      status: "executing",
      actions: [{ type: "reply_only", params: { acknowledgement: recorded.summary, approval_id: approval.id, outcome }, agentId: approval.agentId, policyOutcome: "allow" }],
    });
    const decided = await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption: input.chosenOption, freeText: note, decidedByKind: "user", decidedBy: ctx.userId, planId: plan.id });
    const action = plan.actions[0]!;
    await repos.plans.startAction(tx, ctx.businessId, action.id);
    await repos.plans.finishAction(tx, ctx.businessId, action.id, { status: "done", result: { approvalId: approval.id, outcome, taskId: recorded.task?.id ?? null } });
    await emit(tx, ctx, { type: "decision.made", payload: { decisionId: decided.decision.id, inboxItemId: item.id, chosenOption: input.chosenOption, freeText: note, decidedBy: "user", planId: plan.id, planActionCount: 1, hardGateActions: 0 } });
    await audit(tx, ctx, { action: "inbox.decide", target: { kind: "inbox_item", id: item.id }, details: { chosenOption: input.chosenOption, approvalId: approval.id, outcome, planId: plan.id } });
    return { recorded, decided, plan: await repos.plans.get(tx, ctx.businessId, plan.id), actionId: action.id };
  });
  const answer = await deliverApprovalAnswer(ctx, written.recorded);
  return asSeenBy(ctx, item, {
    item: written.decided.item,
    decision: written.decided.decision,
    plan: written.plan,
    evaluations: [],
    requiresConfirmation: false,
    executed: [written.actionId],
    deferred: [],
    denied: [],
    dispatch: null,
    followUp: answer.note,
    approval: answer,
  });
}


/** What a confirmation that ran nothing reports: the plan was confirmed before, so nothing runs twice. */
const NOTHING_RUN = { executed: [] as string[], deferred: [] as string[], denied: [] as string[], needsOrchestrator: false, channels: [] as ChannelToggle[] };

/**
 * Confirm a plan that policy flagged (BUILD §11.3 "Here is what will happen"). It works from the stored plan alone (the
 * plan id; no state from the page that staged it), so the founder can confirm after a reload, from another tab or
 * device, or on returning from a vacation. Idempotent: a plan someone already confirmed comes back as it is
 * (`alreadyConfirmed`), with nothing executed, audited or written a second time; two presses at once run it once
 * (`repos.plans.claimConfirmation` is one conditional update).
 */
export async function confirmPlan(ctx: BusinessContext, planId: string) {
  const planCtx = await planContextFor(ctx);
  const written = await ctx.rls(async (tx) => {
    const plan = await repos.plans.get(tx, ctx.businessId, planId);
    if (plan.status !== "pending_confirmation") {
      if (plan.confirmedAt) return { plan, exec: NOTHING_RUN, followUp: null, alreadyConfirmed: true };
      throw new ValidationError(`Plan is ${plan.status}, not awaiting confirmation`, { planId });
    }
    // The confirmer needs write on every section the plan changes, whoever staged it (audit RUI-01).
    assertPlanSectionAccess(ctx.membership, plan.actions.filter((a) => a.status === "pending").map((a) => ({ type: a.type, params: a.params, denied: a.policyOutcome === "deny" })));
    const claimed = await repos.plans.claimConfirmation(tx, ctx.businessId, planId);
    if (!claimed) return { plan: await repos.plans.get(tx, ctx.businessId, planId), exec: NOTHING_RUN, followUp: null, alreadyConfirmed: true };
    const confirmed = await repos.plans.get(tx, ctx.businessId, planId);
    const exec = await executePlanActions(tx, ctx.businessId, confirmed, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency });
    await audit(tx, ctx, { action: "plan.confirm", target: { kind: "plan", id: planId }, details: { executed: exec.executed.length, deferred: exec.deferred.length } });
    const item = plan.inboxItemId ? await repos.inbox.get(tx, ctx.businessId, plan.inboxItemId) : null;
    const followUp = item ? await writeFollowUp(tx, ctx, item, confirmed, confirmed.summaryMd, exec.executed.length, exec.deferred.length) : null;
    // Other members' open Inbox shows the plan confirmed and the follow-up at once (audit RUI-09).
    if (item) await emit(tx, ctx, { type: "inbox.item_updated", payload: { inboxItemId: item.id, change: "plan_confirmed", planId, followUpItemId: followUp?.id ?? null } });
    return { plan: await repos.plans.get(tx, ctx.businessId, planId), exec, followUp, alreadyConfirmed: false };
  });
  if (written.alreadyConfirmed) return asSeenBy(ctx, null, { ...written, dispatch: null });
  const dispatch = written.exec.needsOrchestrator ? await dispatchPlan(ctx.temporal, ctx.businessId, planId) : null;
  if (dispatch?.queued) await repos.plans.setWorkflowId(ctx.db, ctx.businessId, planId, dispatch.workflowId);
  await syncChannelEngines(ctx, written.exec.channels);
  return asSeenBy(ctx, null, { ...written, dispatch });
}

/** A plan still waiting for "Here is what will happen", as inbox.get hands it back to whoever reopens the item. */
export interface PendingConfirmation {
  planId: string;
  /** Actions outside the current policy: they need the go-ahead. */
  asks: number;
  /** Actions the founder takes personally (hard gates): the team prepares, they act. */
  hardGates: number;
  /** Actions policy denied: skipped when the plan runs. */
  denied: number;
  /** Whether this reader may give the go-ahead (Inbox write and write on every section the plan changes). */
  canConfirm: boolean;
  /** Why not, in words, when `canConfirm` is false. */
  blockedReason: string | null;
}

/**
 * The pending confirmation of a stored plan (audit OL-01, FR-08): the plan row (status `pending_confirmation`, each
 * action's policy outcome) is the server's record of what needs confirming, so the Inbox can offer the go-ahead after a
 * reload or on another device and `plan.confirm` runs it from that record. Null for a plan that is not waiting.
 */
export function pendingConfirmation(membership: SectionMembership, plan: PlanWithActions): PendingConfirmation | null {
  if (plan.status !== "pending_confirmation") return null;
  const pending = plan.actions.filter((a) => a.status === "pending");
  const sectionRefusal = planSectionRefusal(membership, pending.map((a) => ({ type: a.type, params: a.params, denied: a.policyOutcome === "deny" })));
  const blockedReason = !hasSectionAccess(membership, "inbox", "write") ? "Your access to the Inbox is read-only, so someone who can answer notes gives the go-ahead." : sectionRefusal;
  return {
    planId: plan.id,
    asks: pending.filter((a) => a.policyOutcome === "ask").length,
    hardGates: pending.filter((a) => a.type === "request_human_action").length,
    denied: pending.filter((a) => a.policyOutcome === "deny").length,
    canConfirm: blockedReason === null,
    blockedReason,
  };
}

/**
 * The result as the person who decided may read it (audit RUI-02): someone walled from Finance or the CRM may still
 * answer a note, but the note, the plan and the follow-up come back masked the way inbox.get masks them.
 */
async function asSeenBy<R extends { item?: InboxItem; plan: PlanWithActions; followUp: InboxItem | null; evaluations?: ActionEvaluation[] }>(ctx: BusinessContext, note: InboxItem | null, result: R): Promise<R> {
  const walls = inboxWalls(ctx.membership);
  if (!isWalled(walls)) return result;
  const ids = [...(note ? idsOfItem(note) : []), ...(result.followUp ? idsOfItem(result.followUp) : []), ...mentionIds(result.plan.summaryMd), ...mentionIds(JSON.stringify(result.plan.actions.map((a) => a.params)))];
  const source = await ctx.rls((tx) => loadRedactionSource(tx, ctx.businessId, walls, ids));
  const mask = note ? noteMask(note) : result.followUp ? noteMask(result.followUp) : {};
  return {
    ...result,
    ...(result.item ? { item: redactInboxItem(result.item, source) } : {}),
    plan: redactPlan(result.plan, source, mask),
    followUp: result.followUp ? redactInboxItem(result.followUp, source) : null,
    ...(result.evaluations ? { evaluations: result.evaluations.map((e) => ({ ...e, action: { ...e.action, params: redactValue(e.action.params, source, mask) } })) } : {}),
  };
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
