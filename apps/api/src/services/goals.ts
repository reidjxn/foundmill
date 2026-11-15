/**
 * The business's goal (founder, 2026-11-07: "Your goal"). The Chief of Staff (whoever the business's assistant agent is,
 * by its stored name) proposes one number the team aims every round of work at; any member who can write to the Inbox
 * approves it in one tap or asks for a change in their own words, which yields a revised proposal.
 *
 * - `ensureGoal` is what Home calls once per visit (idempotent; it never writes for a reader who cannot write): it marks
 *   a reached goal achieved ("Goal reached: …"), then proposes when nothing is proposed and
 *     - no goal was ever approved, both sign-offs are approved and a round of work finished after the roadmap's approval
 *       (the first goal: `defaultGoalFor`, no model call);
 *     - the last goal was reached (the next one, `nextGoalAfter`);
 *     - the active goal's date passed (the same aim with a new date; the old goal stays active until the founder
 *       approves the new one). Never blocks Continue (0071).
 * - `approveGoal` / `requestGoalChange` are the one implementation of the two options, from the Inbox note
 *   (`decideGoalItem`, which `decideInboxItem` hands a note tied to a goal) or from `goal.approve` / `goal.requestChange`.
 *   A change asks the `goalProposal` route for the kind, the target and the date (mock mode: the deterministic reader),
 *   falls back to `parseGoalWords`, and replaces nothing when neither reads a change.
 *
 * Every word the founder reads comes from packages/shared goals.ts.
 */
import { prompts } from "@foundmill/agents";
import { achieveGoalIfReached, bothSignedOff, counterFor, goalCounters, loadProductStage, repos, type ComposerItem, type DbTx, type Goal, type InboxItem } from "@foundmill/db";
import { GoalProposalOutput } from "@foundmill/models";
import {
  ConflictError,
  GOAL_MAX_DAYS,
  GOAL_OPTION_IDS,
  GOAL_SAY_A_NUMBER,
  ValidationError,
  WRITE_ROLES,
  addDaysToDay,
  dayKeyIn,
  defaultGoalFor,
  effectivePermission,
  goalDateWords,
  goalFromAnswer,
  goalOptions,
  goalPaceSentence,
  goalProposalBody,
  goalProposalSubject,
  goalSentence,
  minorToMajor,
  nextGoalAfter,
  parseGoalWords,
  retryGoalAfterMiss,
  type GoalMetricKind,
  type GoalProposalReason,
  type GoalShape,
  type GoalStatus,
} from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { answerNote, type AnsweredNote } from "./answer-note";
import type { DecideItemResult } from "./decide";

// ---------------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------------

export interface GoalView {
  id: string;
  revision: number;
  status: GoalStatus;
  sentence: string;
  kind: GoalMetricKind;
  /** A count, or minor units for revenue_month; null for custom. */
  target: number | null;
  currency: string | null;
  dueOn: string;
  reason: GoalProposalReason;
  startValue: number | null;
  approvedAt: Date | null;
  achievedAt: Date | null;
  inboxItemId: string | null;
  /** The Chief of Staff who proposed it, by its stored name. */
  proposedBy: { id: string; name: string } | null;
  /** Where the number stands now and the progress line (null for custom: no number to track). */
  progress: { current: number; pace: string } | null;
}

export interface GoalViews {
  active: GoalView | null;
  proposed: GoalView | null;
  /** Whether this reader may approve or change a proposal (Inbox write). */
  canDecide: boolean;
}

/** May approve, change, or cause a proposal: a writing role with Inbox write (never an example viewer). */
export function canWriteGoals(ctx: Pick<BusinessContext, "role" | "membership">): boolean {
  if ((ctx.membership as { source?: string }).source === "example") return false;
  return (WRITE_ROLES as readonly string[]).includes(ctx.role) && effectivePermission(ctx.membership, "inbox") === "write";
}

const todayOf = (ctx: Pick<BusinessContext, "business">, now: Date = new Date()): string => dayKeyIn(now, ctx.business.timeZone);
const shapeOf = (g: Goal): GoalShape => ({ kind: g.metricKind, target: g.targetValue, currency: g.currency, dueOn: g.dueOn, text: g.metricKind === "custom" ? customTextOf(g.sentence) : null });
/** A custom goal's words without the " by <date>" the sentence adds. */
const customTextOf = (sentence: string): string => sentence.replace(/\s+by\s+[A-Z][a-z]{2} \d{1,2}(?:, \d{4})?$/, "");

async function viewOf(tx: DbTx, ctx: BusinessContext, g: Goal | null, current: Awaited<ReturnType<typeof goalCounters>>, names: Map<string, string>): Promise<GoalView | null> {
  if (!g) return null;
  const today = todayOf(ctx);
  const value = counterFor(g.metricKind, current);
  const agentName = g.proposedByAgentId ? (names.get(g.proposedByAgentId) ?? (await repos.agents.get(tx, ctx.businessId, g.proposedByAgentId).catch(() => null))?.name ?? null) : null;
  return {
    id: g.id,
    revision: g.revision,
    status: g.status,
    sentence: g.sentence,
    kind: g.metricKind,
    target: g.targetValue,
    currency: g.currency,
    dueOn: g.dueOn,
    reason: g.reason,
    startValue: g.startValue,
    approvedAt: g.approvedAt,
    achievedAt: g.achievedAt,
    inboxItemId: g.inboxItemId,
    proposedBy: g.proposedByAgentId && agentName ? { id: g.proposedByAgentId, name: agentName } : null,
    progress:
      value === null
        ? null
        : {
            current: value,
            pace: goalPaceSentence({ kind: g.metricKind, current: value, target: g.targetValue, startValue: g.startValue, startedOn: g.approvedAt ? dayKeyIn(g.approvedAt, ctx.business.timeZone) : null, dueOn: g.dueOn, today, currency: g.currency, achievedOn: g.achievedAt ? dayKeyIn(g.achievedAt, ctx.business.timeZone) : null }),
          },
  };
}

/** A revenue goal as a reader walled off Finance sees it: its date, never its money (the Inbox masks the note the same way). */
function walledFromFinance(view: GoalView | null, ctx: BusinessContext): GoalView | null {
  if (!view || view.kind !== "revenue_month" || effectivePermission(ctx.membership, "finance") !== "none") return view;
  return { ...view, sentence: `Reach a revenue goal by ${goalDateWords(view.dueOn, todayOf(ctx))}`, target: null, startValue: null, progress: null };
}

/**
 * A stored goal row as this reader may see it (the answers of `goal.approve` and `goal.requestChange`): a revenue goal
 * read by someone walled off Finance keeps its date and loses its money, as `goalView` shows it (the stream's `goal.*`
 * walls hide the same numbers).
 */
export function goalAsSeenBy<G extends Goal | null>(goal: G, ctx: Pick<BusinessContext, "membership" | "business">): G {
  if (!goal || goal.metricKind !== "revenue_month" || effectivePermission(ctx.membership, "finance") !== "none") return goal;
  return { ...goal, sentence: `Reach a revenue goal by ${goalDateWords(goal.dueOn, todayOf(ctx))}`, targetValue: null, startValue: null, achievedValue: null };
}

/** The active goal and the open proposal as the screens read them. */
export async function goalView(tx: DbTx, ctx: BusinessContext): Promise<GoalViews> {
  const [current, counters] = await Promise.all([repos.goals.current(tx, ctx.businessId), goalCounters(tx, ctx.businessId)]);
  const names = new Map<string, string>();
  const [active, proposed] = [await viewOf(tx, ctx, current.active, counters, names), await viewOf(tx, ctx, current.proposed, counters, names)];
  return { active: walledFromFinance(active, ctx), proposed: walledFromFinance(proposed, ctx), canDecide: canWriteGoals(ctx) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------------------------------------------------

/** The Chief of Staff's decision note for a proposal (never holding Continue). */
function proposalNote(fromAgentId: string, shape: GoalShape, reason: GoalProposalReason, sentence: string, today: string, extra: { changeWords?: string | null; previous?: Parameters<typeof goalProposalBody>[0]["previous"] } = {}): ComposerItem {
  return {
    type: "decision",
    from_agent_id: fromAgentId,
    subject: goalProposalSubject(shape, reason, today),
    body_md: goalProposalBody({ reason, sentence, today, changeWords: extra.changeWords ?? null, previous: extra.previous ?? null }),
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: { options: goalOptions(shape, reason), free_text: true, expires_at: null },
    blocks_continue: false,
    source_event_ids: [],
    entity_ids: [],
  };
}

interface ProposeArgs {
  shape: GoalShape;
  reason: GoalProposalReason;
  startValue: number | null;
  replacesGoalId: string | null;
  source: "default" | "model" | "parser";
  changeWords?: string | null;
  previous?: Parameters<typeof goalProposalBody>[0]["previous"];
}

/** Write a proposal, its note and the events in the caller's transaction (null when there is no Chief of Staff, or one is open). */
async function writeProposal(tx: DbTx, ctx: BusinessContext, args: ProposeArgs): Promise<{ goal: Goal; item: InboxItem } | null> {
  const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
  if (!chief) return null;
  const today = todayOf(ctx);
  const sentence = goalSentence(args.shape, { today, startValue: args.startValue });
  const proposed = await repos.goals.propose(tx, ctx.businessId, {
    sentence,
    kind: args.shape.kind,
    target: args.shape.target,
    currency: args.shape.currency,
    dueOn: args.shape.dueOn,
    startValue: args.startValue,
    reason: args.reason,
    agentId: chief.id,
    replacesGoalId: args.replacesGoalId,
    item: proposalNote(chief.id, args.shape, args.reason, sentence, today, { changeWords: args.changeWords ?? null, previous: args.previous ?? null }),
  });
  if (!proposed.created || !proposed.item) return null;
  const { goal, item } = proposed;
  await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: "decision", fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
  await emit(tx, ctx, { type: "goal.proposed", actor: { kind: "agent", id: chief.id }, payload: { goalId: goal.id, revision: goal.revision, metricKind: goal.metricKind, targetValue: goal.targetValue, currency: goal.currency, dueOn: goal.dueOn, reason: args.reason, proposedByAgentId: chief.id, inboxItemId: item.id, replacesGoalId: args.replacesGoalId, source: args.source } });
  await audit(tx, ctx, { action: "goal.propose", target: { kind: "goal", id: goal.id }, details: { revision: goal.revision, reason: args.reason, kind: goal.metricKind, target: goal.targetValue, dueOn: goal.dueOn, source: args.source } });
  return { goal, item };
}

export interface EnsureGoalResult {
  views: GoalViews;
  /** A proposal written by this call. */
  proposed: boolean;
  /** The active goal this call marked reached. */
  achieved: boolean;
}

/**
 * Home's once-per-visit call. A reader who cannot write gets the views and nothing is written. Never throws for the
 * screen's sake on a missing Chief of Staff or a business still drafting: it just proposes nothing.
 */
export async function ensureGoal(ctx: BusinessContext, options: { now?: Date } = {}): Promise<EnsureGoalResult> {
  const now = options.now ?? new Date();
  if (!canWriteGoals(ctx)) return { views: await ctx.rls((tx) => goalView(tx, ctx)), proposed: false, achieved: false };

  // A reached goal first: marked achieved with the Chief of Staff's milestone note, then the next proposal below.
  const achieved = await ctx.rls(async (tx) => {
    await repos.goals.lock(tx, ctx.businessId);
    const reached = await achieveGoalIfReached(tx, ctx.businessId, { now });
    if (!reached) return false;
    await emitAchieved(tx, ctx, reached);
    return true;
  });

  const proposed = await ctx.rls(async (tx) => {
    await repos.goals.lock(tx, ctx.businessId);
    const current = await repos.goals.current(tx, ctx.businessId);
    if (current.proposed) return false;
    const today = todayOf(ctx, now);
    const counters = await goalCounters(tx, ctx.businessId, now);

    if (current.active) {
      // The date passed: the same aim with a new date (founder, 2026-11-07); the old goal stays active until approved.
      if (current.active.dueOn >= today) return false;
      const shape = retryGoalAfterMiss(shapeOf(current.active), today);
      const value = counterFor(shape.kind, counters);
      const written = await writeProposal(tx, ctx, { shape, reason: "missed", startValue: value, replacesGoalId: current.active.id, source: "default", previous: { sentence: current.active.sentence, dueOn: current.active.dueOn, current: value, target: current.active.targetValue, kind: current.active.metricKind, currency: current.active.currency } });
      return written !== null;
    }

    const [last] = await repos.goals.recent(tx, ctx.businessId, 1);
    if (last?.status === "achieved") {
      const shape = nextGoalAfter({ kind: last.metricKind, currency: last.currency }, { current: counterFor(last.metricKind, counters) ?? 0, today });
      const written = await writeProposal(tx, ctx, { shape, reason: "next", startValue: counterFor(shape.kind, counters), replacesGoalId: last.id, source: "default", previous: { sentence: last.sentence, dueOn: last.dueOn, current: last.achievedValue, target: last.targetValue, kind: last.metricKind, currency: last.currency } });
      return written !== null;
    }

    // The first goal: after both sign-offs and at least one round of work since the roadmap was approved.
    if (!(await readyForFirstGoal(tx, ctx.businessId))) return false;
    const shape = defaultGoalFor({ payingCustomers: counters.payingCustomers, today });
    const written = await writeProposal(tx, ctx, { shape, reason: "first", startValue: counters.payingCustomers, replacesGoalId: null, source: "default" });
    return written !== null;
  });

  return { views: await ctx.rls((tx) => goalView(tx, ctx)), proposed, achieved };
}

/** Both sign-offs approved (or a business from before they existed) and a `cycle.completed` after the roadmap's approval. */
export async function readyForFirstGoal(tx: DbTx, businessId: string): Promise<boolean> {
  const { stage, signoffs } = await loadProductStage(tx, businessId);
  if (stage !== "building" && stage !== "selling") return false;
  if ((signoffs.spec || signoffs.roadmap) && !bothSignedOff(signoffs)) return false;
  const cycle = await repos.events.latestOfType(tx, businessId, "cycle.completed");
  if (!cycle) return false;
  const approvedAt = signoffs.roadmap?.decidedAt ?? null;
  return !approvedAt || cycle.occurredAt.getTime() > approvedAt.getTime();
}

/** `goal.achieved` and the milestone note's `inbox.item_created`, in the transaction that marked it. */
export async function emitAchieved(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "userId">, reached: NonNullable<Awaited<ReturnType<typeof achieveGoalIfReached>>>): Promise<void> {
  const { goal, item, fromAgentId } = reached;
  if (item && fromAgentId) await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: fromAgentId }, payload: { inboxItemId: item.id, type: "milestone", fromAgentId, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
  await emit(tx, ctx, { type: "goal.achieved", ...(fromAgentId ? { actor: { kind: "agent" as const, id: fromAgentId } } : {}), payload: { goalId: goal.id, revision: goal.revision, metricKind: goal.metricKind, targetValue: goal.targetValue, currency: goal.currency, dueOn: goal.dueOn, achievedValue: goal.achievedValue, inboxItemId: item?.id ?? null } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------------------------------------------------

export interface GoalDecisionResult {
  goal: Goal;
  /** The note the proposal asked with, as answered now (null when it was answered already). */
  answered: AnsweredNote | null;
  /** The revised proposal a change request wrote. */
  revised: { goal: Goal; item: InboxItem } | null;
}

async function openProposal(tx: DbTx, ctx: BusinessContext, goalId: string): Promise<Goal> {
  const goal = await repos.goals.get(tx, ctx.businessId, goalId);
  if (!goal) throw new ValidationError("There is no such goal in this business.", { goalId });
  if (goal.status !== "proposed") throw new ConflictError(goal.status === "active" || goal.status === "achieved" ? "This goal was already approved." : "This goal was already changed: answer the revised one.", { code: "already_decided", goalId, status: goal.status });
  return goal;
}

/** Approve this goal: it becomes the active goal; the previous active goal is replaced; the note is answered. */
export async function approveGoal(ctx: BusinessContext, input: { goalId: string; via: "inbox" | "goal" }): Promise<GoalDecisionResult> {
  return ctx.rls(async (tx) => {
    await repos.goals.lock(tx, ctx.businessId);
    const goal = await openProposal(tx, ctx, input.goalId);
    const counters = await goalCounters(tx, ctx.businessId);
    const approved = await repos.goals.approve(tx, ctx.businessId, goal.id, { approvedBy: ctx.userId, startValue: counterFor(goal.metricKind, counters) });
    if (!approved) throw new ConflictError("This goal was decided a moment ago.", { code: "already_decided", goalId: goal.id });
    const answered = await answerNote(tx, ctx, goal.inboxItemId, GOAL_OPTION_IDS.approve, null, goal.proposedByAgentId, `Approved the goal: ${goal.sentence}.`, { params: { goal_option: GOAL_OPTION_IDS.approve, goal_id: goal.id }, result: { goalId: goal.id, status: "active" } });
    await emit(tx, ctx, { type: "goal.approved", payload: { goalId: goal.id, revision: goal.revision, metricKind: goal.metricKind, targetValue: goal.targetValue, currency: goal.currency, dueOn: goal.dueOn, approvedBy: { kind: "user", id: ctx.userId }, startValue: approved.goal.startValue, replacedGoalId: approved.replaced?.id ?? null, via: input.via } });
    await audit(tx, ctx, { action: "goal.approve", target: { kind: "goal", id: goal.id }, details: { revision: goal.revision, via: input.via, replacedGoalId: approved.replaced?.id ?? null } });
    return { goal: approved.goal, answered, revised: null };
  });
}

/**
 * The revised goal the founder's words describe: the `goalProposal` route first (the kind, the target, the date; every
 * answer checked), then the deterministic reader. Null when neither reads a change.
 */
export async function reviseGoalShape(ctx: BusinessContext, goal: Goal, words: string): Promise<{ shape: GoalShape; source: "model" | "parser" } | null> {
  const today = todayOf(ctx);
  const currency = goal.currency ?? ctx.business.currency;
  const base = shapeOf(goal);
  try {
    const request = prompts.goalProposalRequest({
      businessName: ctx.business.name,
      today,
      currency,
      latestDay: addDaysToDay(today, GOAL_MAX_DAYS),
      founderWords: words,
      current: { kind: goal.metricKind, target: goal.targetValue === null ? null : goal.metricKind === "revenue_month" ? minorToMajor(goal.targetValue, currency) : goal.targetValue, due_on: goal.dueOn, custom_words: base.text ?? null },
    });
    const result = await ctx.models.complete({ route: "goalProposal", schema: GoalProposalOutput, system: request.system, messages: request.messages, attribution: { businessId: ctx.businessId, kind: "goal_proposal", ...(goal.inboxItemId ? { inboxItemId: goal.inboxItemId } : {}) } });
    const shape = result.repaired ? null : goalFromAnswer(result.json, { base, today, currency });
    if (shape) return { shape, source: "model" };
  } catch (err) {
    ctx.log.warn({ businessId: ctx.businessId, goalId: goal.id, err: (err as Error).message }, "goal change: the model did not answer; the deterministic reader stands in");
  }
  const parsed = parseGoalWords(words, { base, today, currency });
  return parsed ? { shape: parsed, source: "parser" } : null;
}

/**
 * Change it: the founder's words close the proposal and the Chief of Staff's revised proposal is written in the same
 * transaction. Words the model and the reader cannot turn into a change replace nothing (`GOAL_SAY_A_NUMBER`).
 */
export async function requestGoalChange(ctx: BusinessContext, input: { goalId: string; notes: string; via: "inbox" | "goal" }): Promise<GoalDecisionResult> {
  const words = input.notes.trim().slice(0, 2000);
  if (!words) throw new ValidationError(`What should change? ${GOAL_SAY_A_NUMBER}`, { route: "conversation", goalId: input.goalId });
  const goal = await ctx.rls((tx) => openProposal(tx, ctx, input.goalId));
  const revision = await reviseGoalShape(ctx, goal, words);
  if (!revision) throw new ValidationError(GOAL_SAY_A_NUMBER, { code: "goal_unreadable", goalId: goal.id });

  return ctx.rls(async (tx) => {
    await repos.goals.lock(tx, ctx.businessId);
    await openProposal(tx, ctx, goal.id);
    const changed = await repos.goals.requestChange(tx, ctx.businessId, goal.id, { words });
    if (!changed) throw new ConflictError("This goal was decided a moment ago.", { code: "already_decided", goalId: goal.id });
    const counters = await goalCounters(tx, ctx.businessId);
    const revised = await writeProposal(tx, ctx, { shape: revision.shape, reason: "revised", startValue: counterFor(revision.shape.kind, counters), replacesGoalId: goal.id, source: revision.source, changeWords: words });
    if (!revised) throw new ConflictError("The Chief of Staff could not write the revised goal.", { code: "no_chief_of_staff", goalId: goal.id });
    const answered = await answerNote(tx, ctx, goal.inboxItemId, GOAL_OPTION_IDS.change, words, goal.proposedByAgentId, `Asked for a change to the goal: ${revised.goal.sentence}.`, { params: { goal_option: GOAL_OPTION_IDS.change, goal_id: goal.id }, result: { goalId: goal.id, revisedGoalId: revised.goal.id } });
    await emit(tx, ctx, { type: "goal.change_requested", payload: { goalId: goal.id, revision: goal.revision, requestedBy: { kind: "user", id: ctx.userId }, words, revisedGoalId: revised.goal.id, via: input.via } });
    await audit(tx, ctx, { action: "goal.request_change", target: { kind: "goal", id: goal.id }, details: { revision: goal.revision, revisedGoalId: revised.goal.id, source: revision.source, via: input.via, words: words.slice(0, 500) } });
    return { goal: changed, answered, revised };
  });
}

/**
 * A goal note answered from the Inbox (`decideInboxItem` recognised the item by its goal): Approve this goal, or Change
 * it with the founder's words (free text alone counts as Change it). No plan compiler; a change may call the goal route.
 */
export async function decideGoalItem(ctx: BusinessContext, item: InboxItem, goal: Goal, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  if (goal.status !== "proposed") throw new ValidationError(goal.status === "replaced" ? "This goal was already changed: answer the revised one." : "This goal was already approved.", { itemId: item.id, code: "already_decided" });
  const empty: Pick<DecideItemResult, "evaluations" | "requiresConfirmation" | "deferred" | "denied" | "dispatch"> = { evaluations: [], requiresConfirmation: false, deferred: [], denied: [], dispatch: null };
  let result: GoalDecisionResult;
  if (input.chosenOption === GOAL_OPTION_IDS.approve) result = await approveGoal(ctx, { goalId: goal.id, via: "inbox" });
  else if (input.chosenOption === GOAL_OPTION_IDS.change || (!input.chosenOption && input.freeText)) {
    if (!input.freeText) throw new ValidationError(`What should change? ${GOAL_SAY_A_NUMBER}`, { route: "conversation", itemId: item.id });
    result = await requestGoalChange(ctx, { goalId: goal.id, notes: input.freeText, via: "inbox" });
  } else throw new ValidationError("Choose Approve this goal or Change it.", { itemId: item.id });
  if (!result.answered) throw new ConflictError("This goal was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  return { ...empty, item: result.answered.item, decision: result.answered.decision, plan: result.answered.plan, executed: [result.answered.actionId], followUp: result.revised?.item ?? null };
}
