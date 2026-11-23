/**
 * businessCycle activities (BUILD §9.4, §12.4, ARCHITECTURE §10): Chief of Staff planning through the `chiefOfStaff`
 * route, dispatch bookkeeping (sessions, task status, `task.started`), cycle events and the composer hand-off.
 */
import { ApplicationFailure } from "@temporalio/common";
import { LIMITS } from "@foundmill/config";
import { agentUsable, buildSystemPrompt, getPrompt, modelBillingFacts, modelBillingMessage, pickAssignee as pickAgent, platformDutyReason } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { repos, resolveAgentPrompt } from "@foundmill/db";
import { CyclePlanOutput } from "@foundmill/models";
import { PARKED_DETAIL_MAX, PARKED_TASKS_MAX, PLANNABLE_TASK_STATUSES, parkedTasksSentence, uuid, type ModelBilling, type ParkedTask } from "@foundmill/shared";
import { ComposerRequestError, ComposerUnavailableError } from "../composer-client";
import { CYCLE_NOT_FINISHED_SUBJECT, CYCLE_NOT_STARTED_SUBJECT, CYCLE_PLAN_FAILURE, type PlanFailureDetails } from "../cycle-contract";
import type { OrchestratorDeps } from "../deps";
import type { BusinessModelClient } from "../models";
import { requestJourneyDailyRefresh } from "../journey-refresh";
import { agentActor, emitEvent, systemActor } from "../events";
import { foldDuplicates, loadDispatchFacts } from "./brief";
import { openAgentSession, postNote, type DispatchRefusal } from "./dispatch";
import { roadmapPlanNote } from "./roadmap-plan";
import type { BriefAgent, BriefTask, BusinessBrief, CyclePlan, CycleStart, CycleTrigger, FollowUpStartsInput, RoadmapPlanResult } from "./types";

export { agentUsable };

const DISPATCHABLE = new Set<string>(PLANNABLE_TASK_STATUSES);
/** Audit action written per task the cycle stops as the platform's own work (`stopPlatformDuties`). */
export const PLATFORM_DUTY_STOPPED_AUDIT_ACTION = "cycle.platform_duty_stopped";
/** Audit action written per task the cycle stops because no agent has a tool for it (`stopToollessTasks`). */
/** Days a note that only informs stays open untouched before a Continue moves it to Archive. */
export const SETTLED_NOTE_DAYS = 7;
export const SETTLED_NOTES_ARCHIVED_AUDIT_ACTION = "cycle.settled_notes_archived";
export const TOOL_MISSING_STOPPED_AUDIT_ACTION = "cycle.tool_missing_stopped";

/**
 * An agent's own block reason saying the team has no tool for the task ("No tool is available to create or list
 * business skills", "none can create or register a business source", "I can't do this import with the tools I have").
 * Such a task fails the same way on every Continue (the Foundmill business, Nov 2 and 3, 2026: five cents a time, a
 * blocked line each) because the capability is not in the product; only the founder can do it, from Settings.
 */
export function lacksTool(detail: string): boolean {
  return /\b(no|without|lack(s|ing)?|missing)\b[^.]{0,60}\btools?\b|\btools? (I|we) (don'?t|do not) have\b|\bnot (among|in) my tools?\b|\bnone of my tools\b|\bno such tool\b|\bmy (only )?tools are\b|\bcan'?t [^.]{0,40}\bwith (the|my) tools\b|\b(no way|none( of (them|my tools))?) (to |can )?(create|register|list|import|write|add)\b/i.test(detail);
}

/** Why a task the planner left out starts anyway (lead, 2026-10-24: the planner orders, it never gates). */
export const SLOT_FREE_REASON = "ready, and an agent slot was free";
/** Why a task left out when every slot was taken waits (the planner's own reason wins when it gave one). */
export const SLOTS_TAKEN_REASON = "every agent slot of this round of work is taken";
/** Why a task starts mid-cycle (`followUpStarts`): what it waited on finished while the cycle ran. */
export const FOLLOW_UP_REASON = "its earlier work finished during this round of work";
/** Follow-up starts sort after every start of the plan (the planner's priorities are 1–5). */
export const FOLLOW_UP_PRIORITY = 6;

/** Subject of the note a cycle posts when nothing could start. */
export const IDLE_CYCLE_SUBJECT = "Nothing is ready to start";

/** Idempotency key of a cycle's `cycle.started` / `cycle.completed`: one of each per cycle id, however often an activity retries. */
export const cycleEventKey = (kind: "started" | "completed", cycleId: string): string => `cycle.${kind}:${cycleId}`;

/** Tasks the planner is shown: the most important and oldest; identical tasks fold into one and the rest are summarized. */
export const PLAN_PAYLOAD_TASKS = 60;

/**
 * A model failure in planning as the activity's failure: a billing refusal, a refused or missing key and any other
 * refused request are final at once (non-retryable `CYCLE_PLAN_FAILURE`, readable message); anything else (a rate limit,
 * an outage, an unreadable answer) is returned unchanged so Temporal retries it as before.
 */
export function planFailure(err: unknown, billedTo: ModelBilling = "byok"): unknown {
  const billing = modelBillingFacts(err);
  if (billing) return ApplicationFailure.create({ type: CYCLE_PLAN_FAILURE, message: modelBillingMessage(billing, "This round's plan"), nonRetryable: true, details: [{ kind: "billing", billedTo: billing.billedTo, reason: billing.reason } satisfies PlanFailureDetails] });
  const e = err as { name?: unknown; code?: unknown; apiErrorType?: unknown } | null;
  if (e?.name !== "ModelRequestError") return err;
  // A missing key is only ever the business's own: the platform client cannot be built without one.
  if (e.apiErrorType === "missing_api_key") return ApplicationFailure.create({ type: CYCLE_PLAN_FAILURE, message: "This round's plan could not run: this business works on its own Anthropic key and none is stored. Add one in Settings › Keys, then press Continue.", nonRetryable: true, details: [{ kind: "credential", billedTo: "byok" } satisfies PlanFailureDetails] });
  if (e.code === "auth") {
    // Whose key was refused decides who can mend it (Nov 9, 2026): a business on credits has no key to check, so it is
    // told the platform's account refused, as the billing sentence does, and the operator is alerted (notePlanFailure).
    const message = billedTo === "byok" ? "This round's plan could not run: Anthropic refused the key. Check the key in Settings › Keys, then press Continue." : `This round's plan could not run: the model account that runs ${APP_NAME} refused its key. Our team has been alerted, and nothing was charged to your credits. Try again later.`;
    return ApplicationFailure.create({ type: CYCLE_PLAN_FAILURE, message, nonRetryable: true, details: [{ kind: "credential", billedTo } satisfies PlanFailureDetails] });
  }
  return ApplicationFailure.create({ type: CYCLE_PLAN_FAILURE, message: "This round's plan could not run: the model service refused the request. Press Continue to try again; if it happens again, the team has the details.", nonRetryable: true, details: [{ kind: "request" } satisfies PlanFailureDetails] });
}

/** Whose key a business's planning call runs on: the routed client says; a plain client is the platform's. */
async function billedToOf(models: OrchestratorDeps["models"], businessId: string): Promise<ModelBilling> {
  const routed = models as Partial<BusinessModelClient>;
  if (typeof routed.routeFor !== "function") return "credits";
  try {
    return (await routed.routeFor(businessId)).billedTo;
  } catch {
    // The route cannot be read only when the business's own key is missing.
    return "byok";
  }
}

/**
 * Why a dispatchable-looking task is left out before planning, or null: a failed or blocked task waiting for its retry
 * (doubling waits, then the founder's Start; audit BF-14), or a task whose session holds an undecided approval.
 */
export function retryDeferral(task: BriefTask, trigger: CycleTrigger | null = null): string | null {
  if (task.awaitingApproval) return "waiting for your approval in the Inbox";
  if ((task.status !== "failed" && task.status !== "blocked") || !task.retry || task.retry.due) return null;
  // The founder's Continue is the restart the retry rule waits for: every failed or blocked task runs again, whatever
  // its wait or its count (five tasks past their retries sat through a Continue that planned nothing; Foundmill
  // business, Oct 28, 2026). Autopilot, the schedule and wakes keep the doubling waits and the limit.
  if (trigger === "continue") return null;
  const what = task.status === "failed" ? "failed" : "blocked";
  if (task.retry.exhausted) return `${what} ${task.retry.failures === 1 ? "once" : `${task.retry.failures} times in a row`}; start it from the Plan once the cause is fixed`;
  const next = task.retry.nextAttemptAt ? new Date(task.retry.nextAttemptAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : null;
  return `retrying after ${task.retry.failures} ${what} session${task.retry.failures === 1 ? "" : "s"}${next ? `; next try after ${next} UTC` : ""}`;
}

/**
 * The Chief of Staff's answer when nothing can start (audit OL-10): no model is called, so no empty cycle is paid for, and
 * the note says what is actually in the way instead of "everything is blocked". Roadmap items without tasks are planned
 * by the team itself in the next rounds of work (lead, 2026-10-24); the founder never builds a task graph.
 */
export function idleSummary(brief: BusinessBrief, waiting: readonly BriefTask[]): string {
  const byDeps = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && t.blocked).length;
  const approvals = waiting.filter((t) => t.awaitingApproval).length;
  const held = waiting.filter((t) => channelDeferral(brief, t) !== null).length;
  const retrying = waiting.length - approvals - held;
  const parts: string[] = [];
  // Before the founder's sign-off nothing is planned beyond groundwork (founder, 2026-10-18).
  if (brief.productStage === "awaiting_signoff") parts.push("The specification and roadmap are waiting for your sign-off in the Inbox; building starts when both are approved");
  const roadmap = untaskedRoadmapLine(brief);
  if (roadmap) parts.push(roadmap);
  if (approvals > 0) parts.push(`${approvals} task${approvals === 1 ? " waits" : "s wait"} for your approval in the Inbox`);
  if (retrying > 0) parts.push(`${retrying} task${retrying === 1 ? " is" : "s are"} waiting to be retried or need${retrying === 1 ? "s" : ""} you to start ${retrying === 1 ? "it" : "them"} from the Plan`);
  if (byDeps > 0) parts.push(`${byDeps} task${byDeps === 1 ? " waits" : "s wait"} on earlier tasks`);
  if (held > 0) parts.push(`${held} channel task${held === 1 ? " waits" : "s wait"} until you start distribution from Customers › Board`);
  const reason = parts.length > 0 ? `${parts.join("; ")}.` : "The board is clear.";
  return `Nothing is ready to start for ${brief.businessName}, so no round of work was planned. ${reason}`;
}

/** "N roadmap items have no tasks yet (…); the team plans them in the next rounds of work", or null before the sign-off or with none. */
export function untaskedRoadmapLine(brief: Pick<BusinessBrief, "untaskedRoadmap" | "productStage">): string | null {
  const roadmap = brief.untaskedRoadmap ?? [];
  if (roadmap.length === 0 || brief.productStage === "awaiting_signoff") return null;
  const names = roadmap.slice(0, 3).map((r) => r.title);
  return `${roadmap.length} roadmap item${roadmap.length === 1 ? " has" : "s have"} no tasks yet (${names.join(", ")}${roadmap.length > names.length ? ", …" : ""}); the team plans ${roadmap.length === 1 ? "it" : "them"} in the next rounds of work`;
}

/** The plan's summary with what this cycle planned from the roadmap in front of it (nothing added when nothing was tried). */
export function withRoadmapNote(summary: string, planned: RoadmapPlanResult | null | undefined): string {
  const note = roadmapPlanNote(planned);
  return note ? `${note}\n\n${summary}` : summary;
}

/**
 * The cycle's summary as the founder reads it, led by what really starts. The planner's prose can describe work it never
 * scheduled ("Four agents start…" with no task behind them: Foundmill cycle 12, Oct 24, 2026), so when nothing starts the
 * summary is built from the deferrals alone, and otherwise it opens with the tasks that start and who runs them.
 */
export function factualSummary(brief: BusinessBrief, planned: string, starts: readonly Pick<CycleStart, "taskId" | "agentId">[], deferred: readonly { taskId: string; reason: string }[]): string {
  const title = new Map(brief.openTasks.map((t) => [t.id, t.title] as const));
  const agent = new Map(brief.agents.map((a) => [a.id, a.name] as const));
  if (starts.length > 0) {
    const started = starts.map((s) => `${title.get(s.taskId) ?? "a task"} (${agent.get(s.agentId) ?? "an agent"})`);
    return `Starting: ${started.join(", ")}.\n\n${planned}`;
  }
  const parts: string[] = [];
  if (deferred.length > 0) {
    const shown = deferred.slice(0, 5).map((d) => `${title.get(d.taskId) ?? "a task"}: ${d.reason}`);
    parts.push(`Every task that could start was held back (${shown.join("; ")}${deferred.length > shown.length ? "; …" : ""})`);
  }
  const roadmap = untaskedRoadmapLine(brief);
  if (roadmap) parts.push(roadmap);
  return `Nothing started in this round of work.${parts.length ? ` ${parts.join(". ")}.` : ""}`;
}

/**
 * Why a task waits on the founder instead of being dispatched (0030), or null: its gated call's approval is still open
 * in the Inbox (approving makes it dispatchable again), or the founder rejected it since its last session (it runs
 * again only when started by hand).
 */
export function approvalDeferral(task: BriefTask): string | null {
  const hold = task.approvalHold;
  if (!hold) return null;
  return hold.outcome === "rejected" ? "the founder rejected its request; it runs again once started by hand" : "waiting for the founder's approval in the Inbox";
}

/** Why a channel task waits before the founder has started distribution (the mock planner uses the same words). */
export const CHANNEL_WAITS_REASON = "distribution starts when you start it from Customers › Board";

/**
 * Channel work is held back in code, not left to the model (founder, 2026-10-18): until the business sells, every
 * channel task is deferred with the same reason. A brief from before the stage existed holds nothing back.
 */
export function channelDeferral(brief: Pick<BusinessBrief, "productStage">, task: Pick<BriefTask, "kind">): string | null {
  return task.kind === "channel" && brief.productStage !== undefined && brief.productStage !== "selling" ? CHANNEL_WAITS_REASON : null;
}

/** Why a dispatchable-looking task sits this cycle out (a retry not yet due, an approval, distribution not started), or null. */
const deferralOf = (task: BriefTask, brief: Pick<BusinessBrief, "productStage"> = {}, trigger: CycleTrigger | null = null): string | null => channelDeferral(brief, task) ?? approvalDeferral(task) ?? retryDeferral(task, trigger);

/**
 * The agent a start runs on: the shared rule (`pickAssignee`, packages/agents; `dev.tasks.start` uses the same), avoiding
 * an agent already chosen for another start this cycle when another usable agent fits.
 */
export function pickAssignee(task: BriefTask, agents: readonly BriefAgent[], requested: string | null, chosen: ReadonlySet<string>): BriefAgent | null {
  return pickAgent(task, agents, { requested, exclude: chosen });
}

/** A start of `task` on `agent`, as the plan and the follow-ups record it. */
function startOf(task: BriefTask, agent: BriefAgent, priority: number, reason: string, departmentId: string | null = task.departmentId): CycleStart {
  return { taskId: task.id, agentId: agent.id, departmentId, priority, reason, kind: task.kind, fileScope: task.fileScope, budgetMinor: task.budgetMinor };
}

export function createCycleActivities(deps: OrchestratorDeps) {
  /** The cycle's update from the Chief of Staff: the summary as written (and a notice under it). Marks its events narrated. */
  async function plainCycleUpdate(input: { businessId: string; summary: string; fallbackSubject?: string }, eventIds: string[], notice: string | null): Promise<string[]> {
    const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
    if (!chief) return [];
    const item = await repos.inbox.createItem(deps.db, input.businessId, {
      type: "update",
      from_agent_id: chief.id,
      subject: (input.fallbackSubject ?? "Round of work finished").slice(0, 80),
      body_md: notice ? `${input.summary.trim()}\n\n${notice}` : input.summary.trim(),
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: false,
      source_event_ids: eventIds,
      entity_ids: [],
    });
    if (eventIds.length) await repos.events.markNarrated(deps.db, input.businessId, eventIds);
    return [item.id];
  }

  /** The Chief of Staff's plan for one cycle, before the roadmap note is put in front of its summary (`planCycle`). */
  /**
   * Open tasks that are the platform's own work (packages/agents `platformDutyReason`: running CI, opening the pull
   * request, bringing a branch up to date, review before the founder, the merge) are stopped and archived before the
   * plan is drafted, and the tasks that waited on them wait no longer (the edge is removed: the platform does that step
   * for every task). New plans never hold such a task (`dropPlatformDuties`); the ones planned before that rule kept
   * dispatching every cycle, each ending blocked within a minute while real tasks waited behind them (the Foundmill
   * business, cycles 35 to 37, Nov 2, 2026). Audited per task; a failure to stop one never fails the plan.
   */
  async function stopPlatformDuties(businessId: string, cycleNumber: number, openTasks: readonly BriefTask[]): Promise<Set<string>> {
    const stopped = new Set<string>();
    for (const task of openTasks) {
      if (!DISPATCHABLE.has(task.status)) continue;
      const reason = platformDutyReason(task);
      if (!reason) continue;
      try {
        await deps.db.transaction(async (tx) => {
          const edges = await repos.tasks.listEdges(tx, businessId, [task.id]);
          for (const e of edges) if (e.fromTask === task.id) await repos.tasks.removeEdge(tx, businessId, e.fromTask, e.toTask);
          await repos.tasks.setStatus(tx, businessId, task.id, "stopped", { force: true });
          await repos.tasks.archive(tx, businessId, task.id);
          await repos.audit.append(tx, businessId, { actorKind: "system", action: PLATFORM_DUTY_STOPPED_AUDIT_ACTION, target: { kind: "task", id: task.id }, details: { cycleNumber, title: task.title.slice(0, 200), reason, dependentsFreed: edges.filter((e) => e.fromTask === task.id).length } });
        });
        stopped.add(task.id);
      } catch (err) {
        deps.log.warn({ businessId, cycleNumber, taskId: task.id, err: (err as Error).message }, "cycle: a platform-duty task could not be stopped; it is tried again next cycle");
      }
    }
    if (stopped.size > 0) deps.log.info({ businessId, cycleNumber, stopped: stopped.size }, "cycle: platform-duty tasks stopped");
    return stopped;
  }

  /**
   * Every Continue closes the notes that only informed and are no longer current (founder, Nov 7, 2026): an update,
   * report or question-less warning about work that has since finished, stopped or failed, or one nobody touched for
   * `SETTLED_NOTE_DAYS`. They move to the Inbox's Archive, still readable; decisions and hard stops are never closed
   * here. On record per cycle; a failure never fails the plan.
   */
  async function closeSettledNotes(businessId: string, cycleNumber: number): Promise<void> {
    try {
      const closed = await repos.inbox.archiveSettled(deps.db, businessId, { olderThan: new Date(Date.now() - SETTLED_NOTE_DAYS * 24 * 60 * 60 * 1000) });
      if (closed.length === 0) return;
      await repos.audit.append(deps.db, businessId, { actorKind: "system", action: SETTLED_NOTES_ARCHIVED_AUDIT_ACTION, target: { kind: "cycle", id: String(cycleNumber) }, details: { cycleNumber, archived: closed.length, itemIds: closed.slice(0, 100) } });
      deps.log.info({ businessId, cycleNumber, archived: closed.length }, "cycle: settled Inbox notes archived");
    } catch (err) {
      deps.log.warn({ businessId, cycleNumber, err: (err as Error).message }, "cycle: settled Inbox notes could not be archived; tried again next cycle");
    }
  }

  /**
   * A blocked task whose agent said the team has no tool for it (`lacksTool` on its latest `task.blocked` detail) is
   * stopped and archived after that one attempt and its dependents freed (founder, Nov 3, 2026: "Yes, do both"). A
   * missing tool is the platform's gap, not the founder's chore (founder, Nov 7, 2026, phase 1 of the first-time
   * founder report): it goes on record for the platform (`cycle.tool_missing_stopped`, and a warning in the log), never
   * as a to-do, a decision or a Needs you item. Until Nov 7 it posted "Only you can do this: …", which handed the founder
   * work such as "Audit current environment values on all services". Since Nov 15 (founder, WP-05 D1) it is said once:
   * the stopped tasks' founder titles and the agent's words come back as `parked`, and the round's note ends with one
   * plain sentence about them. Audited per task; a failure to stop one never fails the plan.
   */
  async function stopToollessTasks(businessId: string, cycleNumber: number, openTasks: readonly BriefTask[]): Promise<{ stopped: Set<string>; parked: ParkedTask[] }> {
    const stopped = new Set<string>();
    const parked: ParkedTask[] = [];
    const blocked = openTasks.filter((t) => t.status === "blocked");
    if (blocked.length === 0) return { stopped, parked };
    const events = await repos.events.list(deps.db, businessId, { type: "task.blocked", limit: 300 });
    for (const task of blocked) {
      const latest = events.items.find((e) => (e.payload as { taskId?: unknown }).taskId === task.id);
      const p = (latest?.payload ?? {}) as { reason?: unknown; detail?: unknown };
      const detail = typeof p.detail === "string" ? p.detail : null;
      if (detail === null || p.reason === "needs_update" || !lacksTool(detail)) continue;
      try {
        const row = await repos.tasks.get(deps.db, businessId, task.id);
        const title = (row.founderTitle ?? row.title).slice(0, 120);
        const agent = row.assigneeAgentId ? await repos.agents.get(deps.db, businessId, row.assigneeAgentId).catch(() => null) : null;
        await deps.db.transaction(async (tx) => {
          const edges = await repos.tasks.listEdges(tx, businessId, [task.id]);
          for (const e of edges) if (e.fromTask === task.id) await repos.tasks.removeEdge(tx, businessId, e.fromTask, e.toTask);
          await repos.tasks.setStatus(tx, businessId, task.id, "stopped", { force: true });
          await repos.tasks.archive(tx, businessId, task.id);
          await repos.audit.append(tx, businessId, { actorKind: "system", action: TOOL_MISSING_STOPPED_AUDIT_ACTION, target: { kind: "task", id: task.id }, details: { cycleNumber, title: row.title.slice(0, 200), detail: detail.slice(0, 500), dependentsFreed: edges.filter((e) => e.fromTask === task.id).length } });
        });
        // Reported to the platform, not the founder: the log line is what Foundmill's own monitoring reads.
        deps.log.warn({ businessId, cycleNumber, taskId: task.id, agent: agent?.name ?? null, title, platformGap: "tool_missing" }, "cycle: a task stopped because no agent has a tool for it (platform gap)");
        stopped.add(task.id);
        if (parked.length < PARKED_TASKS_MAX) parked.push({ title, detail: detail.slice(0, PARKED_DETAIL_MAX) });
      } catch (err) {
        deps.log.warn({ businessId, cycleNumber, taskId: task.id, err: (err as Error).message }, "cycle: a task no agent has a tool for could not be stopped; it is tried again next cycle");
      }
    }
    if (stopped.size > 0) deps.log.info({ businessId, cycleNumber, stopped: stopped.size }, "cycle: tasks no agent has a tool for stopped");
    return { stopped, parked };
  }

  async function draftPlan(input: { businessId: string; cycleNumber: number; trigger: CycleTrigger; brief: BusinessBrief }): Promise<CyclePlan> {
    const { brief } = input;
    const chiefAgent = brief.agents.find((a) => a.id === brief.chiefOfStaffId) ?? null;
    // A stopped team plans nothing, and no model is called (or charged) for it.
    if (brief.agentsStopped) return { summary: "The team is stopped, so nothing was planned. An owner or admin resumes the agents with Resume agents in the top bar.", timeBoxHours: 0.25, starts: [], deferred: [], approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
    // Every concurrent-agent slot of the plan tier is in use (`brief.maxAgents` is the room left): nothing new can start,
    // so no plan is drafted (and nothing spent on one); the open work is listed as deferred.
    if (brief.maxAgents <= 0) return { summary: "Every agent the plan runs at once is already at work; nothing new starts in this round of work.", timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked).map((t) => ({ taskId: t.id, reason: "plan limit: every concurrent agent slot is in use" })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
    // This month's credits are used up (a business on credits): no plan is drafted on the platform's key either.
    if (brief.budgetRemainingMinor !== null && brief.budgetRemainingMinor <= 0) return { summary: "This month's credits are used up, so nothing new starts in this round of work. Top up or add your own Anthropic key to keep the team working.", timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked).map((t) => ({ taskId: t.id, reason: "credits used up for this month" })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
    // The business's monthly model budget is used up (0059, whoever pays the model): dispatch would refuse every start, and a
    // plan costs money too.
    if (brief.modelBudgetRemainingMinor != null && brief.modelBudgetRemainingMinor <= 0) return { summary: "The monthly model budget is used up, so nothing new starts in this round of work. An owner or admin can raise or remove the budget; otherwise the team starts again next month.", timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked).map((t) => ({ taskId: t.id, reason: "monthly model budget used up" })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
    // The Chief of Staff as it is now: its live instructions and skills (WP-06 T1); the template when it has none.
    const chief = await resolveAgentPrompt(deps.db, input.businessId, { templateKey: "chief_of_staff" });
    const system = buildSystemPrompt({ businessName: brief.businessName, appName: APP_NAME, template: { instructions: chief.instructions, description: chief.description }, skills: chief.skills, brief: brief.text, glossary: brief.glossary });
    const budgetText = brief.budgetRemainingMinor === null ? "the founder's own key (no credits)" : `${(brief.budgetRemainingMinor / 100).toFixed(2)} ${brief.creditsCurrency} of credits (Estimate)`;
    const productStage = brief.productStage ?? "selling";
    const prompt = getPrompt("chief_of_staff_planner").render({ business_name: brief.businessName, max_agents: brief.maxAgents, budget: budgetText, capacity: brief.capacity, product_stage: productStage });
    const waiting = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked && deferralOf(t, brief, input.trigger) !== null);
    const candidates = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked && deferralOf(t, brief, input.trigger) === null);
    // Nothing can start: say why instead of paying for a plan that starts nothing (audit OL-10, BF-14).
    if (candidates.length === 0) {
      return { summary: idleSummary(brief, waiting), timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: waiting.map((t) => ({ taskId: t.id, reason: deferralOf(t, brief, input.trigger)! })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0, idle: true };
    }
    // The planner sees the most important and oldest tasks, identical ones folded; the payload never grows with the backlog.
    const shown = foldDuplicates(candidates).slice(0, PLAN_PAYLOAD_TASKS).map(({ task }) => task);
    // Only blockers still open block: a finished or archived one would contradict the task's own unblocked state and the
    // planner deferred such a task as "conflicting dependency data" (Foundmill business, cycle 12, Oct 24, 2026).
    const openIds = new Set(brief.openTasks.map((t) => t.id));
    const payload = {
      business_mode: brief.businessMode,
      product_stage: productStage,
      trigger: input.trigger,
      cycle_number: input.cycleNumber,
      max_agents: brief.maxAgents,
      budget_remaining_minor: brief.budgetRemainingMinor,
      capacity: brief.capacity,
      approvals_waiting: brief.pendingApprovals,
      departments: brief.departments.map((d) => ({ id: d.id, name: d.name, lead_agent_id: d.leadAgentId })),
      agents: brief.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, agent_type: a.agentType, layer: a.layer, department_id: a.departmentIds[0] ?? null, status: a.status })),
      open_task_total: brief.openTaskTotal ?? brief.openTasks.length,
      roadmap_without_tasks: (brief.untaskedRoadmap ?? []).slice(0, 10).map((r) => ({ id: r.id, title: r.title, horizon: r.horizon })),
      open_tasks: shown.map((t) => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, department_id: t.departmentId ?? "general", assignee_agent_id: t.assigneeAgentId ?? undefined, priority: Math.max(1, Math.min(5, 3 - Math.sign(t.priority))), blocked_by: t.dependsOn.filter((id) => openIds.has(id)) })),
    };
    const result = await deps.models
      .complete({
        route: "chiefOfStaff",
        schema: CyclePlanOutput,
        system: [system],
        messages: [{ role: "user", content: `${prompt}\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` }],
        modelOverride: chiefAgent?.modelKey,
        cacheSystem: true,
        scope: `cycle:${input.businessId}`,
        attribution: { businessId: input.businessId, agentId: chiefAgent?.id, kind: "cycle_plan" },
      })
      .catch(async (err: unknown) => {
        throw planFailure(err, await billedToOf(deps.models, input.businessId));
      });
    const plan = result.json;
    const byId = new Map(shown.map((t) => [t.id, t]));
    // The planner's own deferrals: kept only for a task no slot is left for; otherwise noted on the start's reason.
    const plannerDeferred = new Map(plan.deferred.filter((d) => byId.has(d.task_id)).map((d) => [d.task_id, d.reason] as const));
    const starts: CycleStart[] = [];
    const deferred: { taskId: string; reason: string }[] = [];
    const seen = new Set<string>();
    const chosen = new Set<string>();
    // The model's picks first, in its priority order.
    for (const dept of plan.departments) {
      for (const s of dept.tasks_to_start) {
        const task = byId.get(s.task_id);
        if (!task || seen.has(task.id)) continue;
        seen.add(task.id);
        const agent = pickAssignee(task, brief.agents, s.agent_id, chosen);
        if (!agent) {
          deferred.push({ taskId: task.id, reason: "no available agent for this task" });
          continue;
        }
        chosen.add(agent.id);
        starts.push(startOf(task, agent, s.priority, s.reason, task.departmentId ?? (brief.departments.find((d) => d.id === dept.department_id)?.id ?? null)));
      }
    }
    // The planner orders, it never gates (lead, 2026-10-24; Foundmill cycle 12 planned nothing with four tasks ready):
    // every candidate it left out starts while a slot is free, most important and then oldest first.
    for (const task of candidates) {
      if (seen.has(task.id)) continue;
      if (starts.length >= brief.maxAgents) break;
      seen.add(task.id);
      const agent = pickAssignee(task, brief.agents, null, chosen);
      if (!agent) {
        deferred.push({ taskId: task.id, reason: "no available agent for this task" });
        continue;
      }
      chosen.add(agent.id);
      const noted = plannerDeferred.get(task.id);
      starts.push(startOf(task, agent, 5, noted ? `${SLOT_FREE_REASON}; the plan noted: ${noted}` : SLOT_FREE_REASON));
    }
    // Nothing silently disappears: what no slot was left for is listed as deferred, with the planner's reason when it gave one.
    for (const t of candidates) if (!seen.has(t.id)) deferred.push({ taskId: t.id, reason: plannerDeferred.get(t.id) ?? SLOTS_TAKEN_REASON });
    for (const t of waiting) deferred.push({ taskId: t.id, reason: deferralOf(t, brief, input.trigger)! });
    starts.sort((a, b) => a.priority - b.priority);
    return {
      summary: factualSummary(brief, plan.summary, starts, deferred),
      timeBoxHours: Math.max(0.25, Math.min(plan.time_box_hours || LIMITS.cycleTimeBoxAgentHours, 24)),
      starts,
      deferred,
      approvalsNeeded: plan.approvals_needed,
      modelKey: result.modelKey,
      warning: result.warning ?? null,
      costMinor: result.cost.costMinorInt,
    };
  }

  return {
    /**
     * Chief of Staff plan for one cycle (BUILD §12.4). Ids in the model's answer are validated against the brief. The
     * planner orders the work and never gates it (lead, 2026-10-24): every dispatchable task it left out starts while
     * an agent slot is free. `roadmapPlanned` (what `planRoadmap` did before this plan) opens the summary.
     */
    async planCycle(input: { businessId: string; cycleNumber: number; trigger: CycleTrigger; brief: BusinessBrief; roadmapPlanned?: RoadmapPlanResult | null }): Promise<CyclePlan> {
      // Tasks planned before the rule for the platform's own steps (Nov 2, 2026) leave the loop here, never the plan,
      // and so does a task no agent has a tool for (Nov 3, 2026; on record for the platform, not the founder's Inbox).
      const duties = await stopPlatformDuties(input.businessId, input.cycleNumber, input.brief.openTasks);
      const toolless = await stopToollessTasks(input.businessId, input.cycleNumber, input.brief.openTasks.filter((t) => !duties.has(t.id)));
      await closeSettledNotes(input.businessId, input.cycleNumber);
      const stopped = new Set([...duties, ...toolless.stopped]);
      const brief = stopped.size > 0 ? { ...input.brief, openTasks: input.brief.openTasks.filter((t) => !stopped.has(t.id)) } : input.brief;
      const plan = await draftPlan({ ...input, brief });
      const summary = withRoadmapNote(plan.summary, input.roadmapPlanned);
      if (toolless.parked.length === 0) return { ...plan, summary };
      // Said once (WP-05 T18): an idle plan's own note says it; any other plan hands it to the round's note.
      return plan.idle ? { ...plan, summary: withParked(summary, toolless.parked) } : { ...plan, summary, parked: toolless.parked };
    },

    /**
     * Tasks that became dispatchable while the cycle ran (lead, 2026-10-24, decision 8): a session finished, so the tasks
     * that waited on it (and anything else dispatchable the cycle has not started, skipped or finished: `exclude`) can
     * start within the same time box. No model is called: one read of the dispatch facts, the cycle's own deferral
     * rules (product stage, approval holds, retry backoff), the shared assignee rule avoiding the agents still busy.
     */
    async followUpStarts(input: FollowUpStartsInput): Promise<CycleStart[]> {
      const facts = await loadDispatchFacts(deps, input.businessId);
      if (facts.agentsStopped) return [];
      const exclude = new Set(input.exclude);
      const chosen = new Set(input.busyAgentIds ?? []);
      const limit = input.limit ?? Number.POSITIVE_INFINITY;
      const starts: CycleStart[] = [];
      for (const t of facts.openTasks) {
        if (starts.length >= limit) break;
        if (exclude.has(t.id) || t.blocked || !DISPATCHABLE.has(t.status) || deferralOf(t, facts, input.trigger ?? null) !== null) continue;
        const agent = pickAssignee(t, facts.agents, null, chosen);
        if (!agent) continue;
        chosen.add(agent.id);
        starts.push(startOf(t, agent, FOLLOW_UP_PRIORITY, FOLLOW_UP_REASON));
      }
      if (starts.length) deps.log.info({ businessId: input.businessId, cycleId: input.cycleId, taskIds: starts.map((s) => s.taskId) }, "cycle: follow-up starts");
      return starts;
    },

    /**
     * Record the start of a cycle (`cycle.started`). The workflow names the cycle (`cycleId`, stable across its retries and
     * known to its failure path), so a retried attempt finds the event it already wrote instead of writing a second
     * one (audit O-33).
     */
    async startCycle(input: { businessId: string; cycleNumber: number; workflowId: string; trigger: CycleTrigger; plan: CyclePlan; brief: BusinessBrief; cycleId?: string }): Promise<{ cycleId: string; eventId: string }> {
      const cycleId = input.cycleId ?? uuid();
      const budget = input.brief.budgetRemainingMinor === null ? null : { amountMinor: input.brief.budgetRemainingMinor, currency: input.brief.creditsCurrency };
      // Every open task the founder is about to meet (the Plan, the cards, a decision) gets its title in their words
      // (0070) before the cycle's work starts; the composer's absence costs nothing but the titles until next time.
      await deps.composer.founderTitles({ businessId: input.businessId }).then(
        (r) => r.written > 0 && deps.log.info({ businessId: input.businessId, cycleNumber: input.cycleNumber, written: r.written, skipped: r.skipped }, "founder titles written"),
        (err: unknown) => deps.log.debug({ businessId: input.businessId, err: (err as Error).message }, "founder titles not written this cycle"),
      );
      return deps.db.transaction(async (tx) => {
        const before = await repos.events.byIdempotencyKey(tx, input.businessId, cycleEventKey("started", cycleId));
        if (before) return { cycleId, eventId: before.id };
        const ev = await emitEvent(
          tx,
          {
            businessId: input.businessId,
            type: "cycle.started",
            actor: systemActor,
            payload: { cycleId, cycleNumber: input.cycleNumber, workflowId: input.workflowId, trigger: input.trigger, timeBoxAgentHours: input.plan.timeBoxHours, plannedTaskIds: input.plan.starts.map((s) => s.taskId), budget },
          },
          { idempotencyKey: cycleEventKey("started", cycleId) },
        );
        await repos.audit.append(tx, input.businessId, { actorKind: "system", action: "cycle.start", target: { kind: "cycle", id: cycleId }, details: { cycleNumber: input.cycleNumber, trigger: input.trigger, planned: input.plan.starts.length, deferred: input.plan.deferred.length, model: input.plan.modelKey, warning: input.plan.warning } });
        return { cycleId, eventId: ev.id };
      });
    },

    /**
     * Open an agent_sessions row for a task (workflow id `session:<id>` from the start), mark the task running and emit
     * `task.started`, or refuse (`dispatch.ts`): the team is stopped, the agent is paused or at its wage cap, or the task
     * already has a session. A refusal returns `sessionId: null`; `agents_stopped` ends the cycle's dispatching.
     */
    async openSession(input: { businessId: string; agentId: string; taskId: string; sessionId?: string }): Promise<{ sessionId: string | null; refused: DispatchRefusal | null; detail: string | null }> {
      const opened = await openAgentSession(deps, input);
      if (opened.refused) deps.log.info({ businessId: input.businessId, taskId: input.taskId, agentId: input.agentId, refused: opened.refused }, "session not opened");
      return { sessionId: opened.sessionId, refused: opened.refused, detail: opened.detail };
    },

    /**
     * The cycle could not be planned (audit BILL-06): one warning in the Inbox from the Chief of Staff with the reason
     * (`message`, from `planFailure` or the generic line), an audit row, and, when Anthropic refused to bill the platform's
     * key, the operator's alert (`alert: "model_billing"`). businessCycle then ends the cycle `failed`.
     */
    async notePlanFailure(input: { businessId: string; cycleNumber: number; message: string; details: PlanFailureDetails | null }): Promise<{ inboxItemIds: string[] }> {
      const kind = input.details?.kind ?? "error";
      if (kind === "billing" && input.details?.billedTo !== "byok") deps.log.error({ alert: "model_billing", businessId: input.businessId, cycleNumber: input.cycleNumber, reason: input.details?.reason }, "cycle not planned: Anthropic refused to bill the platform key");
      else if (kind === "credential" && input.details?.billedTo === "credits") deps.log.error({ alert: "model_credential", businessId: input.businessId, cycleNumber: input.cycleNumber }, "cycle not planned: Anthropic refused the platform key");
      else deps.log.warn({ businessId: input.businessId, cycleNumber: input.cycleNumber, kind }, "cycle not planned");
      const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
      const inboxItemIds: string[] = [];
      if (chief) {
        const item = await repos.inbox.createItem(deps.db, input.businessId, {
          type: "warning",
          from_agent_id: chief.id,
          subject: CYCLE_NOT_STARTED_SUBJECT,
          body_md: `${input.message.trim()}\n\nNo new work started in this round; work already under way carries on.`,
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: null,
          blocks_continue: false,
          source_event_ids: [],
          entity_ids: [],
        });
        await emitEvent(deps.db, {
          businessId: input.businessId,
          type: "inbox.item_created",
          actor: agentActor(chief.id),
          payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: null },
        });
        inboxItemIds.push(item.id);
      }
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "cycle.plan_failed", target: { kind: "business", id: input.businessId }, details: { cycleNumber: input.cycleNumber, kind, billedTo: input.details?.billedTo ?? null, reason: input.details?.reason ?? null, inboxItemIds } });
      return { inboxItemIds };
    },

    /** Record the end of a cycle (`cycle.completed`). */
    async completeCycle(input: { businessId: string; cycleId: string; cycleNumber: number; workflowId: string; outcome: "completed" | "time_box" | "waiting" | "stopped" | "failed"; tasksDispatched: number; tasksCompleted: number; tasksBlocked: number; agentHours: number; costMinor: number; currency: string; inboxItemIds: string[]; durationMs: number; failure?: { kind: "billing" | "credential" | "request" | "error"; message: string } | null }): Promise<{ eventId: string }> {
      const out = await deps.db.transaction(async (tx) => {
        const before = await repos.events.byIdempotencyKey(tx, input.businessId, cycleEventKey("completed", input.cycleId));
        if (before) return { eventId: before.id };
        const ev = await emitEvent(
          tx,
          {
            businessId: input.businessId,
            type: "cycle.completed",
            actor: systemActor,
            payload: {
              cycleId: input.cycleId,
              cycleNumber: input.cycleNumber,
              workflowId: input.workflowId,
              outcome: input.outcome,
              tasksDispatched: input.tasksDispatched,
              tasksCompleted: input.tasksCompleted,
              tasksBlocked: input.tasksBlocked,
              agentHours: input.agentHours,
              cost: { amountMinor: Math.round(input.costMinor), currency: input.currency },
              inboxItemIds: input.inboxItemIds,
              durationMs: Math.max(0, Math.round(input.durationMs)),
              failure: input.failure ? { kind: input.failure.kind, message: input.failure.message.replace(/\s+/g, " ").trim().slice(0, 500) } : null,
            },
          },
          { idempotencyKey: cycleEventKey("completed", input.cycleId) },
        );
        await repos.audit.append(tx, input.businessId, { actorKind: "system", action: "cycle.complete", target: { kind: "cycle", id: input.cycleId }, details: { outcome: input.outcome, tasksDispatched: input.tasksDispatched, tasksCompleted: input.tasksCompleted, tasksBlocked: input.tasksBlocked } });
        return { eventId: ev.id };
      });
      // The cycle's sessions, tasks and spend reach the Ribbon and the status strip soon after (debounced).
      requestJourneyDailyRefresh(deps);
      return out;
    },

    /**
     * The cycle workflow failed (a planning call that kept failing, a database outage during dispatch): close the cycle
     * as `failed` so Continue is not stuck on "processing", and tell the founder why in one Inbox note (audit O-07). A
     * cycle that never reached `cycle.started` is closed the same way; the event carries its workflow id, which also
     * clears the api's "queued" marker. Idempotent: one `cycle.completed` per cycle, however often it is retried.
     */
    async failCycle(input: { businessId: string; cycleId: string; cycleNumber: number; workflowId: string; reason: string; tasksDispatched: number; tasksCompleted: number; tasksBlocked: number; costMinor: number; currency: string; durationMs: number }): Promise<{ eventId: string; inboxItemId: string | null }> {
      const key = cycleEventKey("completed", input.cycleId);
      const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 300) || "an unexpected error";
      return deps.db.transaction(async (tx) => {
        const before = await repos.events.byIdempotencyKey(tx, input.businessId, key);
        if (before) return { eventId: before.id, inboxItemId: null };
        const chief = await repos.agents.chiefOfStaff(tx, input.businessId);
        const item = chief
          ? await repos.inbox.createItem(tx, input.businessId, {
              type: "warning",
              from_agent_id: chief.id,
              subject: CYCLE_NOT_FINISHED_SUBJECT,
              body_md: `The round of work stopped because of an error: ${reason}. Nothing was lost; open work is still on the board. Press Continue to try again, and check Settings › Integrations or credits if it keeps happening.`,
              status_strip: [],
              exhibit: { kind: "none", spec_ref: null },
              decision: null,
              blocks_continue: false,
              source_event_ids: [],
              entity_ids: [],
            })
          : null;
        const ev = await emitEvent(
          tx,
          {
            businessId: input.businessId,
            type: "cycle.completed",
            actor: systemActor,
            payload: { cycleId: input.cycleId, cycleNumber: input.cycleNumber, workflowId: input.workflowId, outcome: "failed", tasksDispatched: input.tasksDispatched, tasksCompleted: input.tasksCompleted, tasksBlocked: input.tasksBlocked, agentHours: 0, cost: { amountMinor: Math.round(input.costMinor), currency: input.currency }, inboxItemIds: item ? [item.id] : [], durationMs: Math.max(0, Math.round(input.durationMs)), failure: { kind: "error", message: reason } },
          },
          { idempotencyKey: key },
        );
        await repos.audit.append(tx, input.businessId, { actorKind: "system", action: "cycle.failed", target: { kind: "cycle", id: input.cycleId }, details: { cycleNumber: input.cycleNumber, workflowId: input.workflowId, error: reason } });
        return { eventId: ev.id, inboxItemId: item?.id ?? null };
      });
    },

    /**
     * Nothing could start, so the cycle ran no planner and no narration (audit OL-10): one plain note from the Chief of
     * Staff says why and where to go next. A note still unread from an earlier press is not repeated.
     */
    async noteIdleCycle(input: { businessId: string; cycleNumber: number; summary: string }): Promise<{ inboxItemId: string | null }> {
      const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
      if (!chief) return { inboxItemId: null };
      const subject = IDLE_CYCLE_SUBJECT;
      const earlier = await repos.inbox.list(deps.db, input.businessId, { fromAgentId: chief.id, type: "update", state: "unread", limit: 10 });
      const repeat = earlier.items.find((i) => i.subject === subject && i.bodyMd.trim() === input.summary.trim());
      if (repeat) return { inboxItemId: repeat.id };
      const item = await repos.inbox.createItem(deps.db, input.businessId, { type: "update", from_agent_id: chief.id, subject, body_md: input.summary, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
      await emitEvent(deps.db, { businessId: input.businessId, type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
      return { inboxItemId: item.id };
    },

    /**
     * Hand the cycle's events to the composer. One note takes at most `LIMITS.narrateMaxEvents` events, so a cycle with
     * more is narrated in several calls. A cycle that finished no session has no event to narrate (the composer refuses
     * an empty list): its update is the Chief of Staff's own summary. A 4xx answer is the composer turning down what was
     * sent, a bug and not an outage: it is logged as one and never retried (the same request gets the same answer,
     * audit CML-05), and the founder gets the plain summary as the cycle's update, with no outage notice. When the
     * composer is unreachable in development or test, the plain update says it was written without the composer; in
     * staging and production an outage or a timeout is retried (narrate is idempotent per event set, so a retry gets
     * the notes the attempts before it wrote).
     */
    async narrateCycle(input: NarrateCycleInput): Promise<{ inboxItemIds: string[]; viaComposer: boolean }> {
      const ids = [...new Set(input.eventIds)];
      // The tasks the round parked are said once (WP-05 T18): by the composer with the first batch, or in the plain note.
      const parked = (input.parked ?? []).slice(0, PARKED_TASKS_MAX);
      const plain = { ...input, summary: withParked(input.summary, parked) };
      if (ids.length === 0) return { inboxItemIds: await plainCycleUpdate(plain, [], null), viaComposer: false };
      const inboxItemIds: string[] = [];
      let narrated = 0;
      try {
        for (; narrated < ids.length; narrated += LIMITS.narrateMaxEvents) {
          const out = await deps.composer.narrate({ businessId: input.businessId, eventIds: ids.slice(narrated, narrated + LIMITS.narrateMaxEvents), ...(narrated === 0 && parked.length > 0 ? { parked } : {}) });
          if (out.inboxItemId && !inboxItemIds.includes(out.inboxItemId)) inboxItemIds.push(out.inboxItemId);
        }
        return { inboxItemIds, viaComposer: true };
      } catch (err) {
        if (!(err instanceof ComposerUnavailableError) && !(err instanceof ComposerRequestError)) throw err;
        const rest = ids.slice(narrated);
        // A batch the composer already narrated carried the parked tasks; the plain note for the rest does not repeat them.
        const fallback = narrated > 0 ? input : plain;
        if (err instanceof ComposerRequestError) {
          deps.log.error({ err: err.message, code: err.code, status: err.status, details: err.details, events: rest.length }, "composer refused the cycle narration; writing the plain cycle update");
          return { inboxItemIds: [...inboxItemIds, ...(await plainCycleUpdate(fallback, rest, null))], viaComposer: inboxItemIds.length > 0 };
        }
        if (deps.env.APP_ENV === "production" || deps.env.APP_ENV === "staging") throw err;
        deps.log.warn({ err: err.message }, "composer unavailable; writing a plain cycle update");
        const notice = "This update was written without the Inbox Composer (service unavailable); links and exhibits will appear once it is back.";
        return { inboxItemIds: [...inboxItemIds, ...(await plainCycleUpdate(fallback, rest, notice))], viaComposer: inboxItemIds.length > 0 };
      }
    },
  };
}

interface NarrateCycleInput {
  businessId: string;
  eventIds: string[];
  summary: string;
  fallbackSubject?: string;
  /** The plan's `parked` tasks (WP-05 T18), said once in this round's note. */
  parked?: ParkedTask[];
}

/** A summary with the one sentence about the parked tasks after it (WP-05 T18); unchanged when nothing was parked. */
function withParked(summary: string, parked: readonly ParkedTask[]): string {
  const said = parkedTasksSentence(parked.map((p) => p.title));
  return said ? `${summary.trim()}\n\n${said}` : summary;
}

export type CycleActivities = ReturnType<typeof createCycleActivities>;
