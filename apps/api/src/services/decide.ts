/**
 * inbox.decide (BUILD §11.3 "Decision → execution", AC-11.3.4, AC-11.3.5).
 *
 * option click (rule engine, in-process) or free text (plan compiler, Opus) → plan → policy per action → inside policy:
 * write plan + plan_actions and execute
 * / outside: return `{ requiresConfirmation: true, plan }` → item marked answered (releases Continue) →
 * `decision.made` through the outbox → dispatch what the orchestrator runs → follow-up Update item that reports each
 * action's real status and what the dispatch did (audit VRUI-X1, api-services-15). A plan outside policy waits in
 * the database (`pending_confirmation`, each action's policy outcome) until `plan.confirm`, which needs only its id:
 * inbox.get hands the waiting confirmation back (`pendingConfirmation`) to whoever reopens the item.
 *
 * An approval's decision item (an agent's gated call waiting for the founder, audit FR-01) is answered without a plan
 * compiler: Approve or Reject resolves the approval (./approvals), records a one-line plan for the history, and the
 * decision reaches the session or wait that asked. A sign-off note (the specification, the roadmap, Ready to start
 * selling; founder 2026-10-18) is answered the same way from its `product_signoffs` round (./signoff), and the Chief of
 * Staff's goal (founder 2026-11-07) from its `goals` row (./goals).
 *
 * Only a note that asks for a decision can be decided (audit VRUI-X2): an Update, a Milestone or a follow-up has nothing
 * to choose; free text on them goes to the agent's desk (`replyToInboxItem`).
 */
import { classifyFounderText } from "@foundmill/agents";
import { approvalOutcomeOf, closeApprovalItem, repos, type Approval, type DbTx, type Decision, type InboxItem, type PlanWithActions } from "@foundmill/db";
import { AppError, ONE_CLICK_ACTION_TYPES, SHOWCASE_ANSWER_HERE_MESSAGE, ValidationError, endSentence, hasSectionAccess, isPageReadyDecision, isShowcaseConsentDecision, type SectionMembership } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { assertApprovalAccess, deliverApprovalAnswer, recordApprovalAnswer, type ApprovalAnswer } from "./approvals";
import { assertMayConfirmAsks } from "./approver";
import { idsOfItem, inboxWalls, isWalled, loadRedactionSource, mentionIds, noteMask, redactInboxItem, redactPlan, redactValue } from "./inbox-redaction";
import { startModelRetests } from "./agent-model";
import { decideGoalItem } from "./goals";
import { decidePageNote } from "./pages";
import { decideSignoffItem } from "./signoff";
import { assertInstructionSectionAccess, assertPlanSectionAccess, choiceOf, compileOptionPlan, compilePlan, dispatchPlan, evaluatePlan, executePlanActions, planSectionRefusal, redispatchPlans, requiresConfirmation, stagedAction, syncChannelEngines, type ActionEvaluation, type ChannelToggle, type DecisionOption, type DispatchResult, type ModelRetests, type PlanContext } from "./plans";

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

/** The decision block of a note (Composer schema `decision`), or null for a note that asks for none. */
interface ItemDecision {
  options?: DecisionOption[];
  free_text?: boolean;
}

export async function planContextFor(ctx: BusinessContext): Promise<PlanContext> {
  const [agents, holiday, roadmap] = await Promise.all([repos.agents.list(ctx.db, ctx.businessId, { limit: 200 }), repos.holidays.current(ctx.db, ctx.businessId), repos.product.listRoadmap(ctx.db, ctx.businessId)]);
  // Amounts the founder writes without a symbol ("spend up to 300 on ads") are in the business's own currency (0025).
  return { business: ctx.business, agents: agents.items, holidayActive: holiday !== null, holidayBudgetMinor: holiday?.budgetCeilingMinor ?? null, currency: ctx.business.currency, roadmap };
}

/**
 * Whether free text decides this note: it is open, asks for a decision and takes free text (the Inbox shows its Write
 * box on the same rule). Anything else the founder writes on it goes to the agent's desk instead.
 */
export function decidesByText(item: Pick<InboxItem, "state" | "decision">): boolean {
  const decision = item.decision as ItemDecision | null;
  return item.state !== "answered" && item.state !== "archived" && !!decision && decision.free_text !== false;
}

/**
 * Whether a one-click answer from a founder email may give this option now (retention plan and its security review,
 * 2026-11-11): the option's plan is compiled exactly as a click in the Inbox would compile it and checked against the
 * policies, and every action must be one of ONE_CLICK_ACTION_TYPES, allowed without asking, and not a hard gate. An
 * approval or a sign-off is never answered this way; the goal's approval (decided in-process, no plan) is.
 */
export async function oneClickPlanAllowed(ctx: BusinessContext, itemId: string, optionId: string): Promise<boolean> {
  const item = await ctx.rls((tx) => repos.inbox.get(tx, ctx.businessId, itemId));
  const option = ((item.decision as ItemDecision | null)?.options ?? []).find((o) => o.id === optionId);
  if (!option) return false;
  if ((await ctx.rls((tx) => repos.approvals.listForInboxItem(tx, ctx.businessId, item.id))).length > 0) return false;
  if (await ctx.rls((tx) => repos.productSignoffs.forInboxItem(tx, ctx.businessId, item.id))) return false;
  if (await ctx.rls((tx) => repos.goals.forInboxItem(tx, ctx.businessId, item.id))) return true;
  const planCtx = { ...(await planContextFor(ctx)), choice: choiceOf(option) };
  const evaluations = evaluatePlan(compileOptionPlan(option, item, planCtx).actions, planCtx);
  return evaluations.length > 0 && evaluations.every((e) => e.outcome === "allow" && !e.hardGate && ONE_CLICK_ACTION_TYPES.includes(e.action.type));
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
  const decision = item.decision as ItemDecision | null;
  // Only a note that asks for a decision is decided (audit VRUI-X2): an Update or a Milestone has nothing to choose, and
  // running a plan from it would answer it and chain "Decided: Decided: …" follow-ups.
  if (!decision) throw new ValidationError("This note doesn't ask for a decision. Reply to the agent in the conversation instead.", { route: "conversation", itemId: item.id });
  // An agent's gated call waiting for the founder: Approve or Reject answers the approval itself.
  const approvals = await ctx.rls((tx) => repos.approvals.listForInboxItem(tx, ctx.businessId, item.id));
  if (approvals.length) return decideApprovalItem(ctx, item, approvals, { chosenOption, freeText });
  // The founder's sign-off of the specification or the roadmap, or Ready to start selling (founder, 2026-10-18): decided
  // in-process from its round; free text is a request for changes in the founder's words.
  const signoff = await ctx.rls((tx) => repos.productSignoffs.forInboxItem(tx, ctx.businessId, item.id));
  if (signoff) return decideSignoffItem(ctx, item, signoff, { chosenOption, freeText });
  // The Chief of Staff's goal (founder, 2026-11-07): Approve this goal, or Change it in the founder's words (a revised
  // proposal follows); decided in-process, no plan compiler.
  const goal = await ctx.rls((tx) => repos.goals.forInboxItem(tx, ctx.businessId, item.id));
  if (goal) return decideGoalItem(ctx, item, goal, { chosenOption, freeText });
  // The Product lead's "Your project's page is ready" (package 1.3): Check it and publish, or Later; decided in-process.
  if (isPageReadyDecision(item.decision) && item.fromAgentId) return decidePageNote(ctx, item, { chosenOption, freeText });
  // A founder's own showcase ask (0103) is answered from the note (showcase.answer), never by the plan compiler.
  if (isShowcaseConsentDecision(item.decision)) throw new AppError("showcase_answer_here", SHOWCASE_ANSWER_HERE_MESSAGE, 409);
  if (freeText && !chosenOption && decision.free_text === false) throw new ValidationError("This decision takes one of its options. Pick one, or talk it through with the agent first.", { route: "conversation", itemId: item.id });
  const options = decision.options ?? [];
  const option = chosenOption ? options.find((o) => o.id === chosenOption) : undefined;
  if (chosenOption && !option) throw new ValidationError("chosenOption is not one of the item's options", { chosenOption, options: options.map((o) => o.id) });

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
      actions: evaluations.map(stagedAction),
    });
    const decided = await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption, freeText, decidedByKind: "user", decidedBy: ctx.userId, planId: plan.id });
    const exec = confirm ? { ...NOTHING_RUN, deferred: plan.actions.map((a) => a.id) } : await executePlanActions(tx, ctx.businessId, plan, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency, availability: ctx });

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
    // The plan as its actions left it (audit VRUI-X1): what ran is done, what the team runs is still pending.
    return { plan: await repos.plans.get(tx, ctx.businessId, plan.id), decided, exec };
  });

  const after = confirm ? { dispatch: null, followUp: null, plan: null } : await afterCommit(ctx, item, written.plan, compiled.summary, written.exec);

  return asSeenBy(ctx, item, {
    item: written.decided.item,
    decision: written.decided.decision,
    plan: after.plan ?? written.plan,
    evaluations,
    requiresConfirmation: confirm,
    executed: written.exec.executed,
    deferred: written.exec.deferred,
    denied: written.exec.denied,
    dispatch: after.dispatch,
    followUp: after.followUp,
  });
}

/**
 * Approve or Reject on an approval's decision item. Free text alongside the choice is the founder's reason (for a
 * rejection, the agent and the Chief of Staff note quote it); free text alone decides nothing. The plan written here
 * records the answer as one done action, so the item's history reads like any other decision; nothing is compiled
 * and no model is called.
 */
/**
 * Approve or Reject on an approval's note answers every request the note covers: one for an ordinary note, several for a
 * batched one (first-time founder report, Nov 8, 2026: "5 channels want to launch a campaign" is one decision). Each
 * approval is recorded on its own row and told its own way; the plan carries one reply action per request.
 */
async function decideApprovalItem(ctx: BusinessContext, item: InboxItem, linked: readonly Approval[], input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const outcome = approvalOutcomeOf(input.chosenOption);
  const first = linked[0]!;
  if (!outcome) throw new ValidationError(linked.length > 1 ? "Choose Approve all or Reject all: this note asks about several calls the team wants to make." : "Choose Approve or Reject: this note asks about one call an agent wants to make.", { itemId: item.id, approvalId: first.id });
  const open = linked.filter((a) => a.outcome === null);
  if (open.length === 0) {
    // Settled some other way (a hold that went on by itself, an expiry, a plan): the note stops asking and stops
    // blocking Continue, instead of waiting for an answer nobody can give any more.
    await ctx.rls((tx) => closeApprovalItem(tx, ctx.businessId, first));
    throw new ValidationError(`This request was already ${first.outcome}`, { itemId: item.id, approvalId: first.id });
  }
  // Section walls hold here too: approving a Stripe call needs Finance write, a GitHub call Development write.
  for (const a of open) assertApprovalAccess(ctx.membership, a);
  const note = input.freeText?.slice(0, 2000) ?? null;
  const written = await ctx.rls(async (tx) => {
    const recorded = [];
    for (const a of open) recorded.push(await recordApprovalAnswer(tx, ctx, a, outcome, note));
    const summary = recorded.length === 1 ? recorded[0]!.summary : `You ${outcome} ${recorded.length} requests at once. ${recorded.map((r) => r.summary).join(" ")}`.slice(0, 4000);
    const plan = await repos.plans.create(tx, ctx.businessId, {
      origin: "option",
      summaryMd: summary,
      inboxItemId: item.id,
      status: "executing",
      actions: recorded.map((r) => ({ type: "reply_only" as const, params: { acknowledgement: r.summary, approval_id: r.approval.id, outcome }, agentId: r.approval.agentId, policyOutcome: "allow" as const })),
    });
    const decided = await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption: input.chosenOption, freeText: note, decidedByKind: "user", decidedBy: ctx.userId, planId: plan.id });
    for (const [i, action] of plan.actions.entries()) {
      await repos.plans.startAction(tx, ctx.businessId, action.id);
      await repos.plans.finishAction(tx, ctx.businessId, action.id, { status: "done", result: { approvalId: recorded[i]!.approval.id, outcome, taskId: recorded[i]!.task?.id ?? null } });
    }
    await emit(tx, ctx, { type: "decision.made", payload: { decisionId: decided.decision.id, inboxItemId: item.id, chosenOption: input.chosenOption, freeText: note, decidedBy: "user", planId: plan.id, planActionCount: plan.actions.length, hardGateActions: 0 } });
    await audit(tx, ctx, { action: "inbox.decide", target: { kind: "inbox_item", id: item.id }, details: { chosenOption: input.chosenOption, approvalId: first.id, approvalIds: recorded.map((r) => r.approval.id), outcome, planId: plan.id } });
    return { recorded, decided, plan: await repos.plans.get(tx, ctx.businessId, plan.id), actionIds: plan.actions.map((a) => a.id) };
  });
  const answers = [];
  for (const r of written.recorded) answers.push(await deliverApprovalAnswer(ctx, r));
  const answer = answers[0]!;
  return asSeenBy(ctx, item, {
    item: written.decided.item,
    decision: written.decided.decision,
    plan: written.plan,
    evaluations: [],
    requiresConfirmation: false,
    executed: written.actionIds,
    deferred: [],
    denied: [],
    dispatch: null,
    followUp: answers.find((a) => a.note)?.note ?? null,
    approval: answers.length === 1 ? answer : { ...answer, summary: written.plan.summaryMd ?? answer.summary, signalled: answers.flatMap((a) => a.signalled) },
  });
}


/** What a step that runs nothing in-process reports. */
const NOTHING_RUN = { executed: [] as string[], deferred: [] as string[], denied: [] as string[], needsOrchestrator: false, channels: [] as ChannelToggle[], models: { retests: [], superseded: [] } as ModelRetests };

/**
 * After the decision committed: hand what the orchestrator runs to `planExecution`, start the channel engines and model
 * retests the plan switched, write the follow-up from the actions' real statuses and the dispatch result, then start any
 * plan an earlier dispatch left behind now that Temporal answers (audit api-services-15).
 */
async function afterCommit(ctx: BusinessContext, item: InboxItem | null, plan: PlanWithActions, summary: string, exec: { needsOrchestrator: boolean; channels: ChannelToggle[]; models: ModelRetests }): Promise<{ dispatch: DispatchResult | null; followUp: InboxItem | null; plan: PlanWithActions | null }> {
  const dispatch = exec.needsOrchestrator ? await dispatchPlan(ctx.temporal, ctx.businessId, plan.id) : null;
  if (dispatch?.queued) await repos.plans.setWorkflowId(ctx.db, ctx.businessId, plan.id, dispatch.workflowId);
  await syncChannelEngines(ctx, exec.channels);
  await startModelRetests(ctx.temporal, ctx.businessId, exec.models);
  const followUp = await ctx.rls((tx) => writeFollowUp(tx, ctx, item, plan, summary, dispatch));
  if (!dispatch || dispatch.queued) await redispatchPlans(ctx).catch((err: unknown) => ctx.log.warn({ err: (err as Error).message }, "plan redispatch failed"));
  return { dispatch, followUp, plan: dispatch?.queued ? { ...plan, workflowId: dispatch.workflowId } : null };
}

/**
 * Confirm a plan that policy flagged (BUILD §11.3 "Here is what will happen"). Exactly once (audit api-services-05):
 * the plan is claimed by one conditional update, so of two presses at once (two tabs, two members) one runs it and the
 * other comes back `alreadyConfirmed` with nothing executed, audited or written a second time, and a finished plan is
 * never put back to executing.
 */
export async function confirmPlan(ctx: BusinessContext, planId: string) {
  const planCtx = await planContextFor(ctx);
  const written = await ctx.rls(async (tx) => {
    const plan = await repos.plans.get(tx, ctx.businessId, planId);
    if (plan.status !== "pending_confirmation") {
      if (plan.confirmedAt) return { plan, exec: NOTHING_RUN, item: null, alreadyConfirmed: true };
      throw new ValidationError(`Plan is ${plan.status}, not awaiting confirmation`, { planId });
    }
    // The confirmer needs write on every section the plan changes, whoever staged it (audit RUI-01).
    assertPlanSectionAccess(ctx.membership, plan.actions.filter((a) => a.status === "pending").map((a) => ({ type: a.type, params: a.params, denied: a.policyOutcome === "deny" })));
    // An action that asked the founder first (a spend above the threshold, a message) is an owner's or admin's to
    // confirm, or the person Team › Responsibilities names for it; any member with Inbox write is not enough (SEC-7).
    await assertMayConfirmAsks(tx, ctx.businessId, { userId: ctx.userId, role: ctx.role }, plan.actions);
    const claimed = await repos.plans.claimConfirmation(tx, ctx.businessId, planId);
    if (!claimed) return { plan: await repos.plans.get(tx, ctx.businessId, planId), exec: NOTHING_RUN, item: null, alreadyConfirmed: true };
    const confirmed = await repos.plans.get(tx, ctx.businessId, planId);
    const exec = await executePlanActions(tx, ctx.businessId, confirmed, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency, availability: ctx });
    await audit(tx, ctx, { action: "plan.confirm", target: { kind: "plan", id: planId }, details: { executed: exec.executed.length, deferred: exec.deferred.length } });
    const item = plan.inboxItemId ? await repos.inbox.get(tx, ctx.businessId, plan.inboxItemId) : null;
    return { plan: await repos.plans.get(tx, ctx.businessId, planId), exec, item, alreadyConfirmed: false };
  });
  if (written.alreadyConfirmed) return asSeenBy(ctx, null, { plan: written.plan, exec: written.exec, followUp: null, dispatch: null, alreadyConfirmed: true });
  const after = await afterCommit(ctx, written.item, written.plan, written.plan.summaryMd, written.exec);
  // Other members' open Inbox shows the plan confirmed and the follow-up at once (audit RUI-09).
  if (written.item) await ctx.rls((tx) => emit(tx, ctx, { type: "inbox.item_updated", payload: { inboxItemId: written.item!.id, change: "plan_confirmed", planId, followUpItemId: after.followUp?.id ?? null } }));
  return asSeenBy(ctx, null, { plan: after.plan ?? written.plan, exec: written.exec, followUp: after.followUp, dispatch: after.dispatch, alreadyConfirmed: false });
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

/** Each action's line in the follow-up: what really happened to it (audit VRUI-X1). */
function statusWords(status: string, dispatched: boolean): string {
  switch (status) {
    case "done":
      return "done";
    case "pending":
      return dispatched ? "handed to the team" : "waiting to start";
    case "running":
      return "running";
    case "awaiting_approval":
      return "waiting for your approval";
    case "denied":
      return "not run (outside policy)";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return status.replace(/_/g, " ");
  }
}

async function writeFollowUp(tx: DbTx, ctx: BusinessContext, item: InboxItem | null, plan: PlanWithActions, summary: string, dispatch: DispatchResult | null): Promise<InboxItem | null> {
  if (!item) return null;
  const from = item.fromAgentId ?? (await repos.agents.chiefOfStaff(tx, ctx.businessId))?.id ?? null;
  if (!from) return null;
  const dispatched = dispatch?.queued !== false;
  const lines = plan.actions.map((a) => `- ${describeAction(a.type, a.params as Record<string, unknown>)} — ${statusWords(a.status, dispatched)}${a.policyOutcome === "ask" ? " (confirmed by you)" : ""}`);
  const done = plan.actions.filter((a) => a.status === "done").length;
  const pending = plan.actions.filter((a) => a.status === "pending").length;
  // Worded from what the dispatch did, never assumed (audit api-services-15): a plan Temporal did not take is not "handed to the team".
  const tally =
    done === 0 && pending === 0
      ? "Nothing further to run."
      : dispatched
        ? `${done} done now, ${pending} handed to the team.`
        : `${done} done now. ${pending} waiting to start: the team's worker could not be reached, so ${pending === 1 ? "it starts" : "they start"} on your next decision or Continue.`;
  const subject = item.subject.replace(/^(?:Decided: )+/, "");
  // A question subject keeps its own mark: "Decided: Where should the first customer come from?" (never "?.").
  const body = [`Decided: ${endSentence(subject)}`, "", summary, "", ...lines, "", tally].join("\n");
  return repos.inbox.createItem(
    tx,
    ctx.businessId,
    { type: "update", from_agent_id: from, subject: `Decided: ${subject}`.slice(0, 80), body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: item.entityIds },
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
