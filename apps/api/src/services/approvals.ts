/**
 * The founder's answer to an approval (audit FR-01 / O-02; contract 3). An approval opened for a gated call (by the
 * gateway's "ask", a session's recorded hold, a plan action or a channel launch) is answered in the Inbox
 * (`inbox.decide` on its decision item) or from Team › approvals (`team.approvals.resolve`). Either way:
 *
 *   record   inside the caller's transaction: the row is resolved once (a second answer is refused), `approval.resolved`
 *            goes through the outbox and the audit log. When the session that asked has ended (its wait ran out, or the
 *            worker restarted), the task acts on the answer here: Approve makes a blocked task ready, so the next cycle
 *            runs it and its gated call goes on under the approval (the gateway and the replay use it once); Reject
 *            keeps it blocked with the founder's reason, and the Chief of Staff says so in the Inbox.
 *   deliver  after commit: the `decision` signal goes to `session:<sessionId>` while that session waits (always computed
 *            from the session id), and to `approval:<id>`, the wait a plan action or a channel engine runs in. An
 *            approved task whose session ended starts a cycle when the business is idle; never while the team is
 *            stopped (contract 4), on vacation, or while other Inbox items still block Continue.
 *
 * Answering never moves money by itself: the approval lets one call run exactly as it was asked, within the amount it
 * named, and only when the agent makes it again; hard gates are never approvals of this kind.
 */
import { APPROVAL_OPTIONS, approvalAction, approvalArgsText, approvalSection, approvalTaskTitle, repos, type Approval, type DbTx, type InboxItem, type Task } from "@foundmill/db";
import { ForbiddenError, hasSectionAccess, ValidationError, type SectionMembership, type TaskStatus } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { continueStateFor, cycleStatus } from "./cycle";
import { maskFinance } from "./inbox-redaction";
import { SIGNALS, WORKFLOWS, workflowIds, type TemporalResult } from "./temporal";

export type ApprovalOutcome = "approved" | "rejected";

/** What became of an answer: where the waiting work was told, and what the task does next. */
export interface ApprovalAnswer {
  approvalId: string;
  outcome: ApprovalOutcome;
  /** One line for the person who answered ("You approved … Legal Lead carries on."). */
  summary: string;
  /** Every `decision` signal sent, with whether Temporal took it. */
  signalled: TemporalResult[];
  /** The session that asked was still waiting when the answer was stored. */
  sessionWaiting: boolean;
  task: { id: string; title: string; status: TaskStatus } | null;
  /** A cycle started for the approved task (idle business), or why none did; null when none was needed. */
  cycle: { started: boolean; workflowId: string | null; reason: string | null } | null;
  /** The Chief of Staff's note about a task left blocked by a rejection. */
  note: InboxItem | null;
}

/** Stored inside the transaction; `deliverApprovalAnswer` finishes the job after commit. */
export interface RecordedAnswer {
  approval: Approval;
  outcome: ApprovalOutcome;
  note: string | null;
  sessionWaiting: boolean;
  task: { id: string; title: string; status: TaskStatus } | null;
  /** Approved, the session ended and the task is ready again: a cycle may start for it. */
  wantsCycle: boolean;
  /** The team is stopped (contract 4): the answer is stored and nothing starts. */
  stopped: boolean;
  summary: string;
  followUp: InboxItem | null;
}

/**
 * Who may answer an approval: owners and admins, or a member with write on the section the call changes (finance for a
 * Stripe call, development for GitHub, …); a call that belongs to no section needs Inbox write.
 */
export function assertApprovalAccess(membership: SectionMembership, approval: Pick<Approval, "connectorKey" | "tool">): void {
  const section = approvalSection(approval) ?? "inbox";
  if (hasSectionAccess(membership, section, "write")) return;
  throw new ForbiddenError(`You do not have write access to ${section}, and this request would let an agent change it. Someone with that access can answer it.`);
}

const quoted = (title: string) => `“${title.length > 80 ? `${title.slice(0, 77)}...` : title}”`;

/** A task no longer waiting on the answer: running again in another session, or finished another way. */
const MOVED_ON: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["running", "review", "merging", "done", "stopped"]);

export async function recordApprovalAnswer(tx: DbTx, ctx: BusinessContext, approval: Approval, outcome: ApprovalOutcome, note: string | null): Promise<RecordedAnswer> {
  const resolved = await repos.approvals.resolve(tx, ctx.businessId, approval.id, { outcome, byKind: "user", byId: ctx.userId });
  const [agent, session, stop] = await Promise.all([
    approval.agentId ? repos.agents.get(tx, ctx.businessId, approval.agentId).catch(() => null) : Promise.resolve(null),
    approval.sessionId ? repos.agents.getSession(tx, ctx.businessId, approval.sessionId).catch(() => null) : Promise.resolve(null),
    repos.businesses.stopState(tx, ctx.businessId),
  ]);
  if (approval.agentId) {
    await emit(tx, ctx, { type: "approval.resolved", payload: { approvalId: approval.id, planActionId: approval.planActionId, agentId: approval.agentId, outcome, resolvedBy: { kind: "user", id: ctx.userId }, note, latencyMs: Math.max(0, Date.now() - approval.createdAt.getTime()) } });
  }
  const sessionWaiting = session !== null && session.endedAt === null;
  const action = approvalAction(approval);
  const who = agent?.name ?? "the agent";
  const asked = `${agent ? `${agent.name}'s` : "the"} request to run ${action}`;

  let task = approval.taskId ? await repos.tasks.get(tx, ctx.businessId, approval.taskId).catch(() => null) : null;
  let wantsCycle = false;
  let followUp: InboxItem | null = null;
  let next: string;
  if (sessionWaiting) {
    next = outcome === "approved" ? `${who} carries on.` : `Nothing runs; ${who} is told not to retry it.`;
  } else if (task && MOVED_ON.has(task.status)) {
    // Another session already runs the task (started by hand), or it finished another way: it is left as it is. An
    // approved call goes on under this approval when that session makes it; a rejected one asks again.
    next = outcome === "approved" ? "It runs once, exactly as asked." : "Nothing runs.";
  } else if (task && outcome === "approved") {
    // The session's wait ran out before the answer: the task runs again, and its gated call goes on under this approval.
    if (task.status === "blocked") task = await repos.tasks.setStatus(tx, ctx.businessId, task.id, "ready", { force: true });
    wantsCycle = task.status === "ready";
    next = stop.stopped ? `${quoted(task.title)} runs again once the agents are resumed.` : `${quoted(task.title)} runs again on the next cycle.`;
  } else if (task && outcome === "rejected") {
    task = await repos.tasks.setStatus(tx, ctx.businessId, task.id, "blocked", { force: true });
    followUp = await rejectionNote(tx, ctx, approval, task, agent, action, note);
    next = `${quoted(task.title)} stays blocked until you start it again.`;
  } else {
    next = outcome === "approved" ? "It runs once, exactly as asked." : "Nothing runs.";
  }
  const summary = `You ${outcome} ${asked}${note ? ` (${note.trim().slice(0, 200)})` : ""}. ${next}`;
  await audit(tx, ctx, { action: "approval.resolve", target: { kind: "approval", id: approval.id }, details: { outcome, taskId: task?.id ?? null, sessionWaiting, planActionId: approval.planActionId } });
  return { approval: resolved, outcome, note, sessionWaiting, task: task ? { id: task.id, title: task.title, status: task.status } : null, wantsCycle, stopped: stop.stopped, summary, followUp };
}

/** A task left blocked by a rejection: `task.blocked` through the outbox, and the Chief of Staff's note about it. */
async function rejectionNote(tx: DbTx, ctx: BusinessContext, approval: Approval, task: Pick<Task, "id" | "title" | "kind">, agent: { id: string; name: string } | null, action: string, note: string | null): Promise<InboxItem | null> {
  const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
  const assignee = agent?.id ?? chief?.id ?? null;
  const reason = note?.trim() ? note.trim().slice(0, 500) : null;
  const eventId = assignee
    ? await emit(tx, ctx, {
        type: "task.blocked",
        payload: { taskId: task.id, kind: task.kind, title: task.title.slice(0, 200), assigneeAgentId: assignee, sessionId: approval.sessionId, reason: "approval_rejected", detail: `The founder rejected the request to run ${action}${reason ? `: ${reason}` : ""}.`.slice(0, 2000), approvalId: approval.id, occurrence: 1 },
      })
    : null;
  if (!chief) return null;
  const body = [
    `You rejected ${agent ? `**${agent.name}**'s` : "the"} request to run **${action}**${reason ? `, saying: “${reason}”` : ""}.`,
    `${quoted(task.title)} stays blocked: the next cycles leave it alone, and nothing runs in its place. Start it again from the Plan when it should try another way.`,
  ].join("\n\n");
  const item = await repos.inbox.createItem(tx, ctx.businessId, { type: "update", from_agent_id: chief.id, subject: `${task.title} stays blocked`.slice(0, 80), body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: eventId ? [eventId] : [], entity_ids: [] });
  if (eventId) await repos.events.markNarrated(tx, ctx.businessId, [eventId]);
  await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: eventId ? [eventId] : [], cost: null } });
  return item;
}

/** After commit: tell whatever waits on the approval, and start a cycle for an approved task whose session ended. */
export async function deliverApprovalAnswer(ctx: BusinessContext, recorded: RecordedAnswer): Promise<ApprovalAnswer> {
  const { approval, outcome } = recorded;
  const decision = { approvalId: approval.id, planActionId: approval.planActionId, outcome, by: ctx.userId, byKind: "user" as const, note: recorded.note };
  const signalled: TemporalResult[] = [];
  const toSession = recorded.sessionWaiting && approval.sessionId ? await ctx.temporal.signal(workflowIds.session(approval.sessionId), SIGNALS.decision, decision) : null;
  if (toSession) signalled.push(toSession);
  // A plan action or a channel launch waits in its own approvalWait (`approval:<id>`), not in a session.
  if (approval.planActionId || !approval.sessionId) signalled.push(await ctx.temporal.signal(workflowIds.approval(approval.id), SIGNALS.decision, decision));
  const cycle = recorded.wantsCycle ? await cycleForApprovedTask(ctx, recorded.stopped) : null;
  // The answer is stored either way; do not claim the session carries on when it could not be told.
  const summary = toSession && !toSession.queued ? `${recorded.summary} The team could not be told right now: the answer is saved and the task goes on at the next cycle.` : recorded.summary;
  return { approvalId: approval.id, outcome, summary, signalled, sessionWaiting: recorded.sessionWaiting, task: recorded.task, cycle, note: recorded.followUp };
}

/**
 * Starts the next cycle so an approved task runs now, when nothing else stands in the way: the team is not stopped, no
 * cycle is running (it would not pick the task up; the next one does), no vacation, and no other Inbox item still
 * blocks Continue (the founder answers those first). Never an in-process step: without the orchestrator the task simply
 * waits for Continue.
 */
async function cycleForApprovedTask(ctx: BusinessContext, stopped: boolean): Promise<{ started: boolean; workflowId: string | null; reason: string | null }> {
  if (stopped) return { started: false, workflowId: null, reason: "agents are stopped; the task runs once they are resumed" };
  const status = await cycleStatus(ctx);
  if (status.running) return { started: false, workflowId: status.workflowId, reason: "a cycle is running; the next one picks the task up" };
  const state = await continueStateFor(ctx, status);
  if (state.kind === "holiday") return { started: false, workflowId: null, reason: "the Chief of Staff runs the cycles while you are on vacation" };
  if (state.kind === "blocked") return { started: false, workflowId: null, reason: `${state.count} other Inbox item${state.count === 1 ? "" : "s"} wait for you before the next cycle` };
  const cycleNumber = status.nextCycleNumber;
  const workflowId = workflowIds.cycle(ctx.businessId, cycleNumber);
  const workflow = await ctx.temporal.start(WORKFLOWS.businessCycle, { workflowId, args: [{ businessId: ctx.businessId, cycleNumber, trigger: "wake" }] });
  if (!workflow.queued) return { started: false, workflowId, reason: workflow.reason ?? "the orchestrator is unreachable; Continue runs it" };
  await ctx.rls((tx) => audit(tx, ctx, { action: "business.continue", target: { kind: "cycle", id: workflowId }, details: { cycleNumber, mode: "temporal", workflowId, trigger: "approval" } }));
  return { started: true, workflowId, reason: null };
}

/** `team.approvals.resolve`: the same answer from Team › approvals; the approval's Inbox item records it too. */
export async function resolveApproval(ctx: BusinessContext, input: { approvalId: string; outcome: ApprovalOutcome; note?: string | null }): Promise<Approval & { answer: ApprovalAnswer }> {
  const approval = await ctx.rls((tx) => repos.approvals.get(tx, ctx.businessId, input.approvalId));
  if (approval.outcome !== null) throw new ValidationError(`This request was already ${approval.outcome}`, { approvalId: approval.id });
  assertApprovalAccess(ctx.membership, approval);
  const recorded = await ctx.rls(async (tx) => {
    const r = await recordApprovalAnswer(tx, ctx, approval, input.outcome, input.note?.trim() || null);
    if (approval.inboxItemId) {
      const item = await repos.inbox.get(tx, ctx.businessId, approval.inboxItemId);
      if (item.state !== "answered" && item.state !== "archived") await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption: input.outcome === "approved" ? APPROVAL_OPTIONS.approve : APPROVAL_OPTIONS.reject, freeText: input.note?.trim() || null, decidedByKind: "user", decidedBy: ctx.userId });
    }
    await audit(tx, ctx, { action: "team.approvals.resolve", target: { kind: "approval", id: approval.id }, details: { outcome: input.outcome } });
    return r;
  });
  return { ...recorded.approval, answer: await deliverApprovalAnswer(ctx, recorded) };
}

/**
 * Team › approvals: the open approvals with who asks, for which task, and what. The walls of `approvalView` hold here
 * too: a reader walled from Finance sees no amount (nor the arguments of a call that spends), and one who cannot read
 * the section the call changes sees no arguments.
 */
export async function pendingApprovals(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "membership">) {
  const rows = await repos.approvals.pending(tx, ctx.businessId);
  const agents = new Map((await repos.agents.list(tx, ctx.businessId, { limit: 500 })).items.map((a) => [a.id, a.name]));
  const financeWalled = !hasSectionAccess(ctx.membership, "finance", "read");
  return Promise.all(
    rows.map(async (a) => {
      const section = approvalSection(a);
      const spends = (a.amountMinor ?? 0) > 0;
      const argsHidden = (section !== null && !hasSectionAccess(ctx.membership, section, "read")) || (financeWalled && spends);
      return {
        ...a,
        args: argsHidden ? {} : a.args,
        argsHidden,
        amountMinor: financeWalled ? null : a.amountMinor,
        currency: financeWalled ? null : a.currency,
        amountHidden: financeWalled && spends,
        reasons: financeWalled ? a.reasons.map(maskFinance) : a.reasons,
        agentName: a.agentId ? (agents.get(a.agentId) ?? null) : null,
        taskTitle: await approvalTaskTitle(tx, ctx.businessId, a),
        action: approvalAction(a),
        section,
        canAnswer: hasSectionAccess(ctx.membership, section ?? "inbox", "write"),
      };
    }),
  );
}

/**
 * The approval an Inbox item asks about, as the reading pane shows it (the agent and the task as links, the call, what
 * it would send and the amount), or null for any other item. A reader walled from Finance sees no amount, and one who
 * cannot read the section the call changes sees no arguments; `canAnswer` says whether Approve and Reject are theirs.
 */
export async function approvalView(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "membership">, itemId: string) {
  const approval = await repos.approvals.forInboxItem(tx, ctx.businessId, itemId);
  if (!approval) return null;
  const [agent, task, session] = await Promise.all([
    approval.agentId ? repos.agents.get(tx, ctx.businessId, approval.agentId).catch(() => null) : Promise.resolve(null),
    approval.taskId ? repos.tasks.get(tx, ctx.businessId, approval.taskId).catch(() => null) : Promise.resolve(null),
    approval.sessionId ? repos.agents.getSession(tx, ctx.businessId, approval.sessionId).catch(() => null) : Promise.resolve(null),
  ]);
  const section = approvalSection(approval);
  const financeWalled = !hasSectionAccess(ctx.membership, "finance", "read");
  const argsWalled = section !== null && !hasSectionAccess(ctx.membership, section, "read");
  const args = argsWalled ? null : approvalArgsText(approval);
  const spends = (approval.amountMinor ?? 0) > 0 && approval.currency !== null;
  return {
    id: approval.id,
    outcome: approval.outcome,
    resolvedAt: approval.resolvedAt,
    connectorKey: approval.connectorKey,
    tool: approval.tool,
    action: approvalAction(approval),
    args: args && financeWalled ? maskFinance(args) : args,
    argsHidden: argsWalled,
    amount: spends && !financeWalled ? { amountMinor: approval.amountMinor!, currency: approval.currency! } : null,
    amountHidden: spends && financeWalled,
    // "spend above the per-decision cap (£500.00)" is a figure too.
    reasons: financeWalled ? approval.reasons.map(maskFinance) : approval.reasons,
    agent: agent ? { id: agent.id, name: agent.name } : null,
    task: task ? { id: task.id, title: task.title, status: task.status } : null,
    sessionWaiting: session !== null && session.endedAt === null,
    section,
    canAnswer: hasSectionAccess(ctx.membership, section ?? "inbox", "write"),
  };
}
