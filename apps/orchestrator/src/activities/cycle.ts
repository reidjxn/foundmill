/**
 * businessCycle activities (BUILD §9.4, §12.4, ARCHITECTURE §10): Chief of Staff planning through the `chiefOfStaff`
 * route, dispatch bookkeeping (sessions, task status, `task.started`), cycle events and the composer hand-off.
 */
import { LIMITS } from "@foundmill/config";
import { buildSystemPrompt, getPrompt, getTemplate, getTemplateByAgentType } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { CyclePlanOutput } from "@foundmill/models";
import { PLANNABLE_TASK_STATUSES, uuid, type TaskKind } from "@foundmill/shared";
import { ApplicationFailure } from "@temporalio/common";
import { ComposerRequestError, ComposerUnavailableError } from "../composer-client";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { foldDuplicates } from "./brief";
import { openAgentSession, type DispatchRefusal } from "./dispatch";
import type { BriefAgent, BriefTask, BusinessBrief, CyclePlan, CycleStart, CycleTrigger } from "./types";

const DISPATCHABLE = new Set<string>(PLANNABLE_TASK_STATUSES);

/** Subject of the note a cycle posts when nothing could start. */
export const IDLE_CYCLE_SUBJECT = "Nothing is ready to start";

/** Idempotency key of a cycle's `cycle.started` / `cycle.completed`: one of each per cycle id, however often an activity retries. */
export const cycleEventKey = (kind: "started" | "completed", cycleId: string): string => `cycle.${kind}:${cycleId}`;

/** Tasks the planner is shown: the most important and oldest; identical tasks fold into one and the rest are summarized. */
export const PLAN_PAYLOAD_TASKS = 60;

/** An agent the cycle may give work: not paused, injured or failing (failing agents rest first, `recoverAgents`), and under its wage cap. */
export function agentUsable(a: BriefAgent): boolean {
  if (a.status === "paused" || a.status === "injured" || a.status === "failing") return false;
  return a.wageRemainingMinor === undefined || a.wageRemainingMinor === null || a.wageRemainingMinor > 0;
}

/**
 * Why a dispatchable-looking task is left out before planning, or null: a failed or blocked task waiting for its retry
 * (doubling waits, then the founder's Start; audit BF-14), or a task whose session holds an undecided approval.
 */
export function retryDeferral(task: BriefTask): string | null {
  if (task.awaitingApproval) return "waiting for your approval in the Inbox";
  if ((task.status !== "failed" && task.status !== "blocked") || !task.retry || task.retry.due) return null;
  const what = task.status === "failed" ? "failed" : "blocked";
  if (task.retry.exhausted) return `${what} ${task.retry.failures} times in a row; start it from the Plan once the cause is fixed`;
  const next = task.retry.nextAttemptAt ? new Date(task.retry.nextAttemptAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : null;
  return `retrying after ${task.retry.failures} ${what} session${task.retry.failures === 1 ? "" : "s"}${next ? `; next try after ${next} UTC` : ""}`;
}

/**
 * The Chief of Staff's answer when nothing can start (audit OL-10): no model is called, so no empty cycle is paid for, and
 * the note says what is actually in the way instead of "everything is blocked". Roadmap items without tasks point to
 * Development › Plan, where a task graph turns them into work.
 */
export function idleSummary(brief: BusinessBrief, waiting: readonly BriefTask[]): string {
  const roadmap = brief.untaskedRoadmap ?? [];
  const byDeps = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && t.blocked).length;
  const approvals = waiting.filter((t) => t.awaitingApproval).length;
  const retrying = waiting.length - approvals;
  const parts: string[] = [];
  if (roadmap.length > 0) {
    const names = roadmap.slice(0, 3).map((r) => r.title);
    parts.push(`${roadmap.length} roadmap item${roadmap.length === 1 ? " has" : "s have"} no tasks yet (${names.join(", ")}${roadmap.length > names.length ? ", …" : ""}). Open Development › Plan and choose Build a task graph to turn ${roadmap.length === 1 ? "it" : "them"} into work`);
  }
  if (approvals > 0) parts.push(`${approvals} task${approvals === 1 ? " waits" : "s wait"} for your approval in the Inbox`);
  if (retrying > 0) parts.push(`${retrying} task${retrying === 1 ? " is" : "s are"} waiting to be retried or need${retrying === 1 ? "s" : ""} you to start ${retrying === 1 ? "it" : "them"} from the Plan`);
  if (byDeps > 0) parts.push(`${byDeps} task${byDeps === 1 ? " waits" : "s wait"} on earlier tasks`);
  const reason = parts.length > 0 ? `${parts.join("; ")}.` : "The board is clear.";
  return `Nothing is ready to start for ${brief.businessName}, so no cycle was planned. ${reason}`;
}

function pickAssignee(task: BriefTask, brief: BusinessBrief, requested: string | null): BriefAgent | null {
  const byId = new Map(brief.agents.map((a) => [a.id, a]));
  const usable = (a: BriefAgent | undefined | null) => (a && agentUsable(a) ? a : null);
  const fromRequest = requested ? usable(byId.get(requested)) : null;
  if (fromRequest) return fromRequest;
  const fromTask = task.assigneeAgentId ? usable(byId.get(task.assigneeAgentId)) : null;
  if (fromTask) return fromTask;
  const inDept = brief.agents.filter((a) => (task.departmentId ? a.departmentIds.includes(task.departmentId) : true) && a.layer === "worker");
  const fits = (a: BriefAgent) => {
    const t = getTemplateByAgentType(a.agentType);
    return t ? t.taskKinds.includes(task.kind as TaskKind) : false;
  };
  return usable(inDept.find(fits)) ?? usable(brief.agents.find((a) => a.layer === "worker" && fits(a))) ?? usable(inDept[0]) ?? null;
}

export function createCycleActivities(deps: OrchestratorDeps) {
  return {
    /** Chief of Staff plan for one cycle (BUILD §12.4). Ids in the model's answer are validated against the brief. */
    async planCycle(input: { businessId: string; cycleNumber: number; trigger: CycleTrigger; brief: BusinessBrief }): Promise<CyclePlan> {
      const { brief } = input;
      const chiefAgent = brief.agents.find((a) => a.id === brief.chiefOfStaffId) ?? null;
      // A stopped team plans nothing, and no model is called (or charged) for it.
      if (brief.agentsStopped) return { summary: "The team is stopped, so nothing was planned. An owner or admin resumes the agents with Resume agents in the top bar.", timeBoxHours: 0.25, starts: [], deferred: [], approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
      // Every concurrent-agent slot of the plan tier is in use (`brief.maxAgents` is the room left): nothing new can start,
      // so no plan is drafted (and nothing spent on one); the open work is listed as deferred.
      if (brief.maxAgents <= 0) return { summary: "Every agent the plan runs at once is already at work; nothing new starts this cycle.", timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked).map((t) => ({ taskId: t.id, reason: "plan limit: every concurrent agent slot is in use" })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
      const chief = getTemplate("chief_of_staff");
      const system = buildSystemPrompt({ businessName: brief.businessName, appName: APP_NAME, template: chief, brief: brief.text, glossary: brief.glossary });
      const budgetText = brief.budgetRemainingMinor === null ? "the founder's own key (no credits)" : `${(brief.budgetRemainingMinor / 100).toFixed(2)} ${brief.creditsCurrency} of credits (Estimate)`;
      const prompt = getPrompt("chief_of_staff_planner").render({ business_name: brief.businessName, max_agents: brief.maxAgents, budget: budgetText, capacity: brief.capacity });
      const waiting = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked && retryDeferral(t) !== null);
      const candidates = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked && retryDeferral(t) === null);
      // Nothing can start: say why instead of paying for a plan that starts nothing (audit OL-10, BF-14).
      if (candidates.length === 0) {
        return { summary: idleSummary(brief, waiting), timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: waiting.map((t) => ({ taskId: t.id, reason: retryDeferral(t)! })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0, idle: true };
      }
      // The planner sees the most important and oldest tasks, identical ones folded; the payload never grows with the backlog.
      const shown = foldDuplicates(candidates).slice(0, PLAN_PAYLOAD_TASKS).map(({ task }) => task);
      const payload = {
        business_mode: brief.businessMode,
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
        open_tasks: shown.map((t) => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, department_id: t.departmentId ?? "general", assignee_agent_id: t.assigneeAgentId ?? undefined, priority: Math.max(1, Math.min(5, 3 - Math.sign(t.priority))), blocked_by: t.dependsOn })),
      };
      const result = await deps.models.complete({
        route: "chiefOfStaff",
        schema: CyclePlanOutput,
        system: [system],
        messages: [{ role: "user", content: `${prompt}\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` }],
        modelOverride: chiefAgent?.modelKey,
        cacheSystem: true,
        scope: `cycle:${input.businessId}`,
        attribution: { businessId: input.businessId, agentId: chiefAgent?.id, kind: "cycle_plan" },
      });
      const plan = result.json;
      const byId = new Map(shown.map((t) => [t.id, t]));
      const starts: CycleStart[] = [];
      const deferred: { taskId: string; reason: string }[] = plan.deferred.filter((d) => byId.has(d.task_id)).map((d) => ({ taskId: d.task_id, reason: d.reason }));
      const seen = new Set<string>();
      for (const dept of plan.departments) {
        for (const s of dept.tasks_to_start) {
          const task = byId.get(s.task_id);
          if (!task || seen.has(task.id)) continue;
          seen.add(task.id);
          const agent = pickAssignee(task, brief, s.agent_id);
          if (!agent) {
            deferred.push({ taskId: task.id, reason: "no available agent for this task" });
            continue;
          }
          starts.push({ taskId: task.id, agentId: agent.id, departmentId: task.departmentId ?? (brief.departments.find((d) => d.id === dept.department_id)?.id ?? null), priority: s.priority, reason: s.reason, kind: task.kind, fileScope: task.fileScope, budgetMinor: task.budgetMinor });
        }
      }
      // The planner may leave dispatchable work out; nothing silently disappears — it is listed as deferred.
      for (const t of candidates) if (!seen.has(t.id) && !deferred.some((d) => d.taskId === t.id)) deferred.push({ taskId: t.id, reason: "not selected for this cycle" });
      for (const t of waiting) deferred.push({ taskId: t.id, reason: retryDeferral(t)! });
      starts.sort((a, b) => a.priority - b.priority);
      return {
        summary: plan.summary,
        timeBoxHours: Math.max(0.25, Math.min(plan.time_box_hours || LIMITS.cycleTimeBoxAgentHours, 24)),
        starts,
        deferred,
        approvalsNeeded: plan.approvals_needed,
        modelKey: result.modelKey,
        warning: result.warning ?? null,
        costMinor: result.cost.costMinorInt,
      };
    },

    /**
     * Record the start of a cycle (`cycle.started`). The workflow names the cycle (`cycleId`, stable across its retries and
     * known to its failure path), so a retried attempt finds the event it already wrote instead of writing a second
     * one (audit O-33).
     */
    async startCycle(input: { businessId: string; cycleNumber: number; workflowId: string; trigger: CycleTrigger; plan: CyclePlan; brief: BusinessBrief; cycleId?: string }): Promise<{ cycleId: string; eventId: string }> {
      const cycleId = input.cycleId ?? uuid();
      const budget = input.brief.budgetRemainingMinor === null ? null : { amountMinor: input.brief.budgetRemainingMinor, currency: input.brief.creditsCurrency };
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

    /** Record the end of a cycle (`cycle.completed`). */
    async completeCycle(input: { businessId: string; cycleId: string; cycleNumber: number; workflowId: string; outcome: "completed" | "time_box" | "waiting" | "stopped" | "failed"; tasksDispatched: number; tasksCompleted: number; tasksBlocked: number; agentHours: number; costMinor: number; currency: string; inboxItemIds: string[]; durationMs: number }): Promise<{ eventId: string }> {
      return deps.db.transaction(async (tx) => {
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
            },
          },
          { idempotencyKey: cycleEventKey("completed", input.cycleId) },
        );
        await repos.audit.append(tx, input.businessId, { actorKind: "system", action: "cycle.complete", target: { kind: "cycle", id: input.cycleId }, details: { outcome: input.outcome, tasksDispatched: input.tasksDispatched, tasksCompleted: input.tasksCompleted, tasksBlocked: input.tasksBlocked } });
        return { eventId: ev.id };
      });
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
              subject: `Cycle ${input.cycleNumber} did not finish`,
              body_md: `The cycle stopped because of an error: ${reason}. Nothing was lost; open work is still on the board. Press Continue to try again, and check Settings › Integrations or credits if it keeps happening.`,
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
            payload: { cycleId: input.cycleId, cycleNumber: input.cycleNumber, workflowId: input.workflowId, outcome: "failed", tasksDispatched: input.tasksDispatched, tasksCompleted: input.tasksCompleted, tasksBlocked: input.tasksBlocked, agentHours: 0, cost: { amountMinor: Math.round(input.costMinor), currency: input.currency }, inboxItemIds: item ? [item.id] : [], durationMs: Math.max(0, Math.round(input.durationMs)) },
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
     * Hand the cycle's events to the composer (one inbox item). When the composer is unreachable in development or
     * test, a plain update from the Chief of Staff is written instead so the founder still sees the cycle end. In
     * staging and production an outage or a timeout is retried (narrate is idempotent per event set, so a retry gets the
     * note a slow attempt wrote); a 4xx answer is not, since the same request gets the same answer (audit CML-05).
     */
    async narrateCycle(input: { businessId: string; eventIds: string[]; summary: string; fallbackSubject?: string }): Promise<{ inboxItemIds: string[]; viaComposer: boolean }> {
      try {
        const out = await deps.composer.narrate({ businessId: input.businessId, eventIds: input.eventIds });
        return { inboxItemIds: out.inboxItemId ? [out.inboxItemId] : [], viaComposer: true };
      } catch (err) {
        if (!(err instanceof ComposerUnavailableError) && !(err instanceof ComposerRequestError)) throw err;
        if (deps.env.APP_ENV === "production" || deps.env.APP_ENV === "staging") {
          if (err instanceof ComposerRequestError) throw ApplicationFailure.create({ message: err.message, type: "ComposerRequestError", nonRetryable: true, details: [{ code: err.code, status: err.status }] });
          throw err;
        }
        deps.log.warn({ err: err.message }, "composer unavailable; writing a plain cycle update");
        const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
        if (!chief) return { inboxItemIds: [], viaComposer: false };
        const body = `${input.summary.trim()}\n\nThis update was written without the Inbox Composer (service unavailable); links and exhibits will appear once it is back.`;
        const item = await repos.inbox.createItem(deps.db, input.businessId, {
          type: "update",
          from_agent_id: chief.id,
          subject: (input.fallbackSubject ?? "Cycle finished").slice(0, 80),
          body_md: body,
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: null,
          blocks_continue: false,
          source_event_ids: input.eventIds,
          entity_ids: [],
        });
        if (input.eventIds.length) await repos.events.markNarrated(deps.db, input.businessId, input.eventIds);
        return { inboxItemIds: [item.id], viaComposer: false };
      }
    },
  };
}

export type CycleActivities = ReturnType<typeof createCycleActivities>;
