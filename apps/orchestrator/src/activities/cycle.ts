/**
 * businessCycle activities (BUILD §9.4, §12.4, ARCHITECTURE §10): Chief of Staff planning through the `chiefOfStaff`
 * route, dispatch bookkeeping (sessions, task status, `task.started`), cycle events and the composer hand-off.
 */
import { LIMITS } from "@foundmill/config";
import { buildSystemPrompt, getPrompt, getTemplate, getTemplateByAgentType } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { CyclePlanOutput } from "@foundmill/models";
import { uuid, type TaskKind } from "@foundmill/shared";
import { ComposerUnavailableError } from "../composer-client";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { BriefAgent, BriefTask, BusinessBrief, CyclePlan, CycleStart, CycleTrigger } from "./types";

const DISPATCHABLE = new Set(["planned", "ready", "paused", "blocked", "failed"]);

function pickAssignee(task: BriefTask, brief: BusinessBrief, requested: string | null): BriefAgent | null {
  const byId = new Map(brief.agents.map((a) => [a.id, a]));
  const usable = (a: BriefAgent | undefined | null) => (a && a.status !== "paused" && a.status !== "injured" && a.status !== "failing" ? a : null);
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
      const chief = getTemplate("chief_of_staff");
      const chiefAgent = brief.agents.find((a) => a.id === brief.chiefOfStaffId) ?? null;
      // Every concurrent-agent slot of the plan tier is in use (`brief.maxAgents` is the room left): nothing new can start,
      // so no plan is drafted (and nothing spent on one); the open work is listed as deferred.
      if (brief.maxAgents <= 0) return { summary: "Every agent the plan runs at once is already at work; nothing new starts this cycle.", timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked).map((t) => ({ taskId: t.id, reason: "plan limit: every concurrent agent slot is in use" })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
      // This month's credits are used up (a business on credits): no plan is drafted on the platform's key either.
      if (brief.budgetRemainingMinor !== null && brief.budgetRemainingMinor <= 0) return { summary: "This month's credits are used up, so nothing new starts this cycle. Top up or add your own Anthropic key to keep the team working.", timeBoxHours: LIMITS.cycleTimeBoxAgentHours, starts: [], deferred: brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked).map((t) => ({ taskId: t.id, reason: "credits used up for this month" })), approvalsNeeded: [], modelKey: chiefAgent?.modelKey ?? "opus", warning: null, costMinor: 0 };
      const system = buildSystemPrompt({ businessName: brief.businessName, appName: APP_NAME, template: chief, brief: brief.text, glossary: brief.glossary });
      const budgetText = brief.budgetRemainingMinor === null ? "the founder's own key (no credits)" : `${(brief.budgetRemainingMinor / 100).toFixed(2)} ${brief.creditsCurrency} of credits (Estimate)`;
      const prompt = getPrompt("chief_of_staff_planner").render({ business_name: brief.businessName, max_agents: brief.maxAgents, budget: budgetText, capacity: brief.capacity });
      const candidates = brief.openTasks.filter((t) => DISPATCHABLE.has(t.status) && !t.blocked);
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
        open_tasks: candidates.map((t) => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, department_id: t.departmentId ?? "general", assignee_agent_id: t.assigneeAgentId ?? undefined, priority: Math.max(1, Math.min(5, 3 - Math.sign(t.priority))), blocked_by: t.dependsOn })),
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
      const byId = new Map(candidates.map((t) => [t.id, t]));
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

    /** Record the start of a cycle (`cycle.started`). */
    async startCycle(input: { businessId: string; cycleNumber: number; workflowId: string; trigger: CycleTrigger; plan: CyclePlan; brief: BusinessBrief }): Promise<{ cycleId: string; eventId: string }> {
      const cycleId = uuid();
      const budget = input.brief.budgetRemainingMinor === null ? null : { amountMinor: input.brief.budgetRemainingMinor, currency: input.brief.creditsCurrency };
      const ev = await emitEvent(deps.db, {
        businessId: input.businessId,
        type: "cycle.started",
        actor: systemActor,
        payload: { cycleId, cycleNumber: input.cycleNumber, workflowId: input.workflowId, trigger: input.trigger, timeBoxAgentHours: input.plan.timeBoxHours, plannedTaskIds: input.plan.starts.map((s) => s.taskId), budget },
      });
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "cycle.start", target: { kind: "cycle", id: cycleId }, details: { cycleNumber: input.cycleNumber, trigger: input.trigger, planned: input.plan.starts.length, deferred: input.plan.deferred.length, model: input.plan.modelKey, warning: input.plan.warning } });
      return { cycleId, eventId: ev.id };
    },

    /** Open an agent_sessions row for a task, mark the task running and emit `task.started`. */
    async openSession(input: { businessId: string; agentId: string; taskId: string; workflowId: string; modelKey?: string }): Promise<{ sessionId: string }> {
      const { db } = deps;
      const [agent, task] = await Promise.all([repos.agents.get(db, input.businessId, input.agentId), repos.tasks.get(db, input.businessId, input.taskId)]);
      const session = await repos.agents.createSession(db, input.businessId, { agentId: agent.id, versionId: agent.currentVersionId, taskId: task.id, workflowId: input.workflowId, modelKey: agent.modelKey, startedAt: deps.clock.now() });
      if (task.assigneeAgentId !== agent.id) await repos.tasks.reassign(db, input.businessId, task.id, agent.id);
      if (task.status !== "running") await repos.tasks.setStatus(db, input.businessId, task.id, "running", { force: true });
      await emitEvent(db, {
        businessId: input.businessId,
        type: "task.started",
        actor: { kind: "agent", id: agent.id },
        payload: { taskId: task.id, title: task.title, kind: task.kind, assigneeAgentId: agent.id, sessionId: session.id, roadmapItemId: task.roadmapItemId, workflowId: input.workflowId, branch: `agent/${task.id}` },
      });
      return { sessionId: session.id };
    },

    /** Record the end of a cycle (`cycle.completed`). */
    async completeCycle(input: { businessId: string; cycleId: string; cycleNumber: number; workflowId: string; outcome: "completed" | "time_box" | "waiting" | "stopped" | "failed"; tasksDispatched: number; tasksCompleted: number; tasksBlocked: number; agentHours: number; costMinor: number; currency: string; inboxItemIds: string[]; durationMs: number }): Promise<{ eventId: string }> {
      const ev = await emitEvent(deps.db, {
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
      });
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "cycle.complete", target: { kind: "cycle", id: input.cycleId }, details: { outcome: input.outcome, tasksDispatched: input.tasksDispatched, tasksCompleted: input.tasksCompleted, tasksBlocked: input.tasksBlocked } });
      return { eventId: ev.id };
    },

    /**
     * Hand the cycle's events to the composer (one inbox item). When the composer is unreachable in development or
     * test, a plain update from the Chief of Staff is written instead so the founder still sees the cycle end.
     */
    async narrateCycle(input: { businessId: string; eventIds: string[]; summary: string; fallbackSubject?: string }): Promise<{ inboxItemIds: string[]; viaComposer: boolean }> {
      try {
        const out = await deps.composer.narrate({ businessId: input.businessId, eventIds: input.eventIds });
        return { inboxItemIds: out.inboxItemId ? [out.inboxItemId] : [], viaComposer: true };
      } catch (err) {
        if (!(err instanceof ComposerUnavailableError)) throw err;
        if (deps.env.APP_ENV === "production" || deps.env.APP_ENV === "staging") throw err;
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
