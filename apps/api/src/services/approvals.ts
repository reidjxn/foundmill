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
import { APPROVAL_OPTIONS, ASK_FOR_DETAILS_NOTE, approvalAction, approvalArgsText, approvalSection, approvalTaskTitle, approvalWhatExactly, founderReasons, integrationConnected, isReleaseApproval, repos, type Approval, type ApprovalWhat, type ApprovalWhatContext, type DbTx, type InboxItem, type Task } from "@foundmill/db";
import { ForbiddenError, agentMention, hasSectionAccess, ValidationError, type SectionMembership, type TaskStatus } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { continueStateFor, cycleStatus } from "./cycle";
import { maskFinance } from "./inbox-redaction";
import { approvalIsForViewer, assertCanResolveApproval, canResolveApproval } from "./approval-handler";
import { assertMayResolveApproval } from "./approver";
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

export async function recordApprovalAnswer(tx: DbTx, ctx: BusinessContext, approval: Approval, outcome: ApprovalOutcome, givenNote: string | null): Promise<RecordedAnswer> {
  // A rejection of a request that said nothing about what it would run carries the ask for the details, so the agent
  // reads why and asks again properly (first-time founder report, Nov 8, 2026).
  const note = givenNote ?? (outcome === "rejected" && !isReleaseApproval(approval) && approvalWhatExactly(approval).empty ? ASK_FOR_DETAILS_NOTE : null);
  // Owners and admins, or the member Team › Responsibilities names for this kind of decision (SEC-7).
  // The handler Responsibilities named when the approval opened answers it (owners and admins can step in).
  assertCanResolveApproval(approval, { userId: ctx.userId, role: ctx.role });
  await assertMayResolveApproval(tx, ctx.businessId, { userId: ctx.userId, role: ctx.role }, approval, ctx.connectors);
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
  const action = approvalAction(approval, null, ctx.business.name);
  const who = agent?.name ?? "the agent";
  // A release is worded as the moment it is for the founder (decision 2026-11-01), never as the call behind it.
  const release = isReleaseApproval(approval);
  const asked = release ? `${agent ? `${agent.name}'s` : "the"} change going live` : `${agent ? `${agent.name}'s` : "the"} request to run ${action}`;

  let task = approval.taskId ? await repos.tasks.get(tx, ctx.businessId, approval.taskId).catch(() => null) : null;
  let wantsCycle = false;
  let followUp: InboxItem | null = null;
  let next: string;
  if (release) {
    // The merge review (apps/orchestrator mergeReview) waits for the repository's tests and reports the outcome on the approval.
    next = outcome === "approved" ? "It goes live once the final quality checks pass; if one fails, the work goes back to the agent." : "Nothing goes live; the work waits.";
  } else if (sessionWaiting) {
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
    // The agent as markup with its stored name: each reader sees it under their own preference (One name everywhere).
    `You rejected the request${agent && agentMention(agent) ? ` from ${agentMention(agent)}` : ""} to run **${action}**${reason ? `, saying: “${reason}”` : ""}.`,
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
  // A plan action or a channel launch waits in its own approvalWait (`approval:<id>`), not in a session; so does the
  // merge review of a task whose session already ended (the review outlives the session that did the work). Told
  // whenever no session waits for the answer: a wait that is not there is a harmless miss, reported as not queued.
  if (approval.planActionId || !approval.sessionId || !recorded.sessionWaiting) signalled.push(await ctx.temporal.signal(workflowIds.approval(approval.id), SIGNALS.decision, decision));
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
      // A batched note (several requests, one decision) stays open while a sibling is still unanswered.
      const siblingsOpen = (await repos.approvals.listForInboxItem(tx, ctx.businessId, item.id)).some((a) => a.id !== approval.id && a.outcome === null);
      if (item.state !== "answered" && item.state !== "archived" && !siblingsOpen) await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption: input.outcome === "approved" ? APPROVAL_OPTIONS.approve : APPROVAL_OPTIONS.reject, freeText: input.note?.trim() || null, decidedByKind: "user", decidedBy: ctx.userId });
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
export async function pendingApprovals(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "business" | "membership" | "userId" | "role">) {
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
        action: approvalAction(a, null, ctx.business.name),
        section,
        canAnswer: hasSectionAccess(ctx.membership, section ?? "inbox", "write") && canResolveApproval(a, { userId: ctx.userId, role: ctx.role }),
        // Who the Responsibilities matrix named (the founder when nobody), and whether it waits for the person asking.
        handler: a.handlerKind && a.handlerId ? { kind: a.handlerKind, id: a.handlerId } : { kind: "founder" as const, id: null },
        forMe: approvalIsForViewer(a, { userId: ctx.userId, role: ctx.role }),
        canResolve: canResolveApproval(a, { userId: ctx.userId, role: ctx.role }),
      };
    }),
  );
}

/**
 * The approval an Inbox item asks about, as the reading pane shows it (the agent and the task as links, the call, what
 * it would send and the amount), or null for any other item. A reader walled from Finance sees no amount, and one who
 * cannot read the section the call changes sees no arguments; `canAnswer` says whether Approve and Reject are theirs.
 */
/** The merge audit rows that carry a release's outcome against its approval (apps/orchestrator/src/activities/merge.ts). */
const MERGE_AUDIT_ACTIONS = ["merge.merged", "merge.not_merged", "merge.waiting", "merge.handed_back"];

/**
 * What happened after the founder approved (audit FR-01): the Decided panel shows the outcome, never only the answer.
 * A release's steps are on record against the approval (`merge.*` audit rows with its id): went live, waiting for the
 * repository's tests, did not go through (and why), or handed back to its agent. Any other call "ran" once the gateway
 * used the approval (`usedAt`), else it waits for the agent's next session. Null until the approval is approved.
 */
export async function approvalExecution(tx: DbTx, businessId: string, approval: Pick<Approval, "id" | "outcome" | "usedAt" | "connectorKey" | "tool">): Promise<{ state: "ran" | "waiting" | "failed" | "handed_back"; detail: string | null; at: string | null } | null> {
  if (approval.outcome !== "approved") return null;
  if (isReleaseApproval(approval)) {
    const rows = (await repos.audit.list(tx, businessId, { action: MERGE_AUDIT_ACTIONS, limit: 500 })).items.filter((a) => (a.details as { approvalId?: unknown } | null)?.approvalId === approval.id);
    const latest = rows[0];
    if (latest) {
      const at = new Date(latest.createdAt).toISOString();
      const d = latest.details as { step?: string; why?: string; reason?: string; retryable?: boolean };
      if (latest.action === "merge.merged") return { state: "ran", detail: "It is live.", at };
      if (latest.action === "merge.waiting") return { state: "waiting", detail: "Waiting for the final quality checks.", at };
      if (latest.action === "merge.handed_back") return { state: "handed_back", detail: handBackWords(d.why), at };
      if (d.step === "decision") return null;
      return { state: "failed", detail: d.step === "checks_timeout" ? "The final quality checks did not finish in time; the team tries again in its next round of work." : d.retryable ? "The repository refused it for the moment; the team tries again in its next round of work." : "The repository refused it; the team tries again in its next round of work.", at };
    }
    return { state: "waiting", detail: "Waiting for the final quality checks.", at: null };
  }
  if (approval.usedAt) return { state: "ran", detail: "It ran once, as asked.", at: new Date(approval.usedAt).toISOString() };
  return { state: "waiting", detail: "It runs when the agent next works on the task.", at: null };
}

/** Why a release went back to its agent, for the founder. */
function handBackWords(why: string | undefined): string {
  switch (why) {
    case "conflicts":
      return "It clashes with newer work on the live product; the agent is bringing it up to date and will ask again.";
    case "behind":
      return "The live product moved on since; the agent is bringing the change up to date and will ask again.";
    case "checks_failed":
      return "A final quality check failed on it; the agent is fixing that and will ask again.";
    default:
      return "It went back to the agent, who will ask again when it is ready.";
  }
}

/**
 * What exactly the call would run, with what the arguments only name loaded (a campaign and its drafts), for the reading
 * pane's "What exactly" block (first-time founder report, Nov 8, 2026). Walled from the section the call changes, the
 * founder's walls hide it as they hide the arguments; walled from Finance, every figure is masked.
 */
async function approvalWhatFor(tx: DbTx, businessId: string, approval: Approval, walls: { argsWalled: boolean; financeWalled: boolean }): Promise<ApprovalWhat | null> {
  if (walls.argsWalled) return null;
  const context: ApprovalWhatContext = {};
  const args = (approval.args ?? {}) as Record<string, unknown>;
  const campaignId = typeof args.campaignId === "string" ? args.campaignId : typeof args.campaign_id === "string" ? args.campaign_id : null;
  if (approval.tool === "launch_campaign" && campaignId) {
    const campaign = await repos.campaigns.get(tx, businessId, campaignId).catch(() => null);
    if (campaign) {
      context.campaign = { name: campaign.name, goal: campaign.goal, budgetMinor: campaign.budgetMinor === null ? null : Number(campaign.budgetMinor), currency: campaign.currency };
      const assets = await repos.campaigns.listAssets(tx, businessId, { campaignId }).catch(() => []);
      context.assets = assets.filter((a) => a.approvalState !== "rejected").map((a) => ({ kind: a.kind, title: a.title, body: a.body }));
    }
  }
  const what = approvalWhatExactly(approval, context);
  if (!walls.financeWalled) return what;
  return { ...what, headline: what.headline ? maskFinance(what.headline) : null, rows: what.rows.map((r) => ({ ...r, value: maskFinance(r.value) })) };
}

export async function approvalView(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "business" | "membership" | "userId" | "role">, itemId: string) {
  const linked = await repos.approvals.listForInboxItem(tx, ctx.businessId, itemId);
  // The note's request: the oldest of a batch (its subject counts them), the one for an ordinary note.
  const approval = linked[0];
  if (!approval) return null;
  const [agent, task, session, execution] = await Promise.all([
    approval.agentId ? repos.agents.get(tx, ctx.businessId, approval.agentId).catch(() => null) : Promise.resolve(null),
    approval.taskId ? repos.tasks.get(tx, ctx.businessId, approval.taskId).catch(() => null) : Promise.resolve(null),
    approval.sessionId ? repos.agents.getSession(tx, ctx.businessId, approval.sessionId).catch(() => null) : Promise.resolve(null),
    approvalExecution(tx, ctx.businessId, approval),
  ]);
  const section = approvalSection(approval);
  const financeWalled = !hasSectionAccess(ctx.membership, "finance", "read");
  const argsWalled = section !== null && !hasSectionAccess(ctx.membership, section, "read");
  const args = argsWalled ? null : approvalArgsText(approval);
  const spends = (approval.amountMinor ?? 0) > 0 && approval.currency !== null;
  const walls = { argsWalled, financeWalled };
  const what = await approvalWhatFor(tx, ctx.businessId, approval, walls);
  // A GitHub call: whether there is anywhere for it to run (null for every other call).
  const githubConnected = approval.connectorKey === "github" ? integrationConnected(await repos.integrations.getByKey(tx, ctx.businessId, "github")) : null;
  // A batched note: every request it covers, each with what it would run, so the pane can show one expander per channel.
  const agents = linked.length > 1 ? new Map((await repos.agents.list(tx, ctx.businessId, { limit: 500 })).items.map((a) => [a.id, a])) : null;
  const batch =
    linked.length > 1
      ? await Promise.all(
          linked.map(async (a) => {
            const by = a.agentId ? agents?.get(a.agentId) : null;
            const money = (a.amountMinor ?? 0) > 0 && a.currency !== null;
            return {
              id: a.id,
              outcome: a.outcome,
              agent: by ? { id: by.id, name: by.name, role: by.role || null, personaKey: by.personaKey ?? null, layer: by.layer ?? null } : null,
              action: approvalAction(a, null, ctx.business.name),
              amount: money && !financeWalled ? { amountMinor: a.amountMinor!, currency: a.currency! } : null,
              what: await approvalWhatFor(tx, ctx.businessId, a, walls),
            };
          }),
        )
      : [];
  return {
    id: approval.id,
    outcome: approval.outcome,
    resolvedAt: approval.resolvedAt,
    connectorKey: approval.connectorKey,
    tool: approval.tool,
    action: approvalAction(approval, null, ctx.business.name),
    args: args && financeWalled ? maskFinance(args) : args,
    argsHidden: argsWalled,
    amount: spends && !financeWalled ? { amountMinor: approval.amountMinor!, currency: approval.currency! } : null,
    amountHidden: spends && financeWalled,
    // "spend above the per-decision cap (£500.00)" is a figure too.
    reasons: financeWalled ? approval.reasons.map(maskFinance) : approval.reasons,
    /** Why the founder is asked, in their words (the rules' own sentences stay in `reasons` for the Details). */
    why: founderReasons(approval.reasons),
    // With what the web needs to name the agent under the reader's preference (One name everywhere).
    agent: agent ? { id: agent.id, name: agent.name, role: agent.role || null, personaKey: agent.personaKey ?? null, layer: agent.layer ?? null } : null,
    // The task in the founder's words (0070) where it has them; the technical title is the Plan's business.
    task: task ? { id: task.id, title: task.founderTitle ?? task.title, status: task.status } : null,
    sessionWaiting: session !== null && session.endedAt === null,
    /** A release: the founder is asked to put a finished change live. */
    release: isReleaseApproval(approval),
    execution,
    section,
    canAnswer: hasSectionAccess(ctx.membership, section ?? "inbox", "write") && canResolveApproval(approval, { userId: ctx.userId, role: ctx.role }),
    /** What exactly would run (first-time founder report, Nov 8, 2026); null when the reader's walls hide the call's arguments. */
    what,
    /** A GitHub call with no repository connected has nowhere to run: the pane says so and points to Settings › Integrations. */
    githubConnected,
    /** Every request a batched note covers (empty for an ordinary note): one answer decides them all. */
    batch,
  };
}
