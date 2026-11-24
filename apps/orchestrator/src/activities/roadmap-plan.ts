/**
 * `planRoadmap` (lead, 2026-10-24: "I should never have to build a task graph"): before the Chief of Staff plans a
 * cycle, roadmap items in Now that no task links to are planned into tasks by the Planner, at most
 * `LIMITS.cyclePlanRoadmapItems` per cycle, only once the founder has signed off (stage building or selling), the team
 * is not stopped and no budget gate is closed. The tasks are written exactly as the api's `planTaskGraph` writes them
 * (same system prompt, `repos.tasks.writePlannedGraph`), audited as `cycle.plan_roadmap`, and the workflow reloads the
 * brief so the plan sees them. One failed Planner call never fails the cycle: it is logged, named in the summary and
 * tried again next cycle. Idempotent: an item that has tasks by the time it is reached (a retried activity, the
 * founder's own "Plan something sooner" meanwhile) is skipped, under the same per-business planning lock the api takes.
 */
import { isSiteProject } from "./site-workspace";
import { buildPlannerRequest, dropPlatformDuties, PLANNER_SYSTEM_PROMPT, plannerConnected, plannerDestination, plannerSpecSections, plannerWorkerTypes } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { repos, roadmapItemDepartmentId } from "@foundmill/db";
import { TaskGraphOutput } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import type { BriefRoadmapItem, BusinessBrief, RoadmapPlanResult } from "./types";

/** The audit action of every roadmap item a cycle planned (system actor). */
export const ROADMAP_PLAN_AUDIT_ACTION = "cycle.plan_roadmap";

/** Why a cycle plans nothing from the roadmap (the gates `planCycle` applies before drafting a plan), or null when it may. */
export function roadmapPlanHold(brief: Pick<BusinessBrief, "agentsStopped" | "productStage" | "budgetRemainingMinor" | "modelBudgetRemainingMinor">): string | null {
  if (brief.agentsStopped) return "the team is stopped";
  // A brief from before the stage existed reads as selling (as `planCycle` reads it).
  const stage = brief.productStage ?? "selling";
  if (stage !== "building" && stage !== "selling") return "the specification and roadmap are not signed off yet";
  if (brief.budgetRemainingMinor !== null && brief.budgetRemainingMinor <= 0) return "this month's credits are used up";
  if (brief.modelBudgetRemainingMinor != null && brief.modelBudgetRemainingMinor <= 0) return "the monthly model budget is used up";
  return null;
}

/** The Now items a cycle plans, in the brief's order (Now first, then position): at most the per-cycle limit. */
export function roadmapItemsToPlan(brief: Pick<BusinessBrief, "untaskedRoadmap">): BriefRoadmapItem[] {
  return (brief.untaskedRoadmap ?? []).filter((r) => r.horizon === "now").slice(0, LIMITS.cyclePlanRoadmapItems);
}

/** The cycle summary's line about the roadmap planning, or null when nothing was planned or failed. */
export function roadmapPlanNote(planned: RoadmapPlanResult | null | undefined): string | null {
  if (!planned) return null;
  const parts = planned.planned.map((p) => `Planned ${p.taskIds.length} task${p.taskIds.length === 1 ? "" : "s"} for ${p.title}.`);
  for (const f of planned.failed) parts.push(`Could not plan ${f.title} (${f.reason}); the team tries again next round of work.`);
  return parts.length ? parts.join(" ") : null;
}

export function createRoadmapPlanActivities(deps: OrchestratorDeps) {
  return {
    async planRoadmap(input: { businessId: string; cycleNumber: number; brief: BusinessBrief }): Promise<RoadmapPlanResult> {
      const { businessId, brief } = input;
      const hold = roadmapPlanHold(brief);
      const items = roadmapItemsToPlan(brief);
      if (hold || items.length === 0) return { planned: [], failed: [], skipped: hold ?? "no roadmap item in Now is without tasks", costMinor: 0 };
      const result: RoadmapPlanResult = { planned: [], failed: [], skipped: null, costMinor: 0 };
      // What the Planner reads (WP-05 T5): the specification's text, the team it plans for and whether code can land.
      const sections = plannerSpecSections(await repos.product.listBlocks(deps.db, businessId));
      const destination = plannerDestination(await repos.integrations.codeRepository(deps.db, businessId), { sites: await isSiteProject(deps.db, deps.env, businessId) });
      const workerTypes = plannerWorkerTypes((await repos.agents.list(deps.db, businessId, { limit: 500 })).items);
      const connected = plannerConnected(await repos.integrations.list(deps.db, businessId));
      for (const r of items) {
        try {
          const item = await repos.product.getRoadmapItem(deps.db, businessId, r.id);
          // Planned meanwhile (a retried activity, the founder's "Plan something sooner"): no second plan, nothing spent.
          if ((await repos.tasks.list(deps.db, businessId, { roadmapItemId: item.id, limit: 1 })).items.length > 0) continue;
          const goal = item.descriptionMd || item.title;
          const answer = await deps.models.complete({
            route: "planner",
            schema: TaskGraphOutput,
            system: PLANNER_SYSTEM_PROMPT,
            messages: [{ role: "user", content: buildPlannerRequest({ goal, roadmapItem: item, sections, destination, workerTypes, connected }) }],
            scope: `cycle:${businessId}`,
            attribution: { businessId, kind: "planner" },
          });
          const costMinor = answer.cost.costMinorInt;
          result.costMinor += costMinor;
          const created = await deps.db.transaction(async (tx) => {
            // One writer per business at a time (the api's planner takes the same lock), so an item planned on another
            // instance meanwhile is seen, not written twice.
            await repos.tasks.lockPlanning(tx, businessId);
            if ((await repos.tasks.list(tx, businessId, { roadmapItemId: item.id, limit: 1 })).items.length > 0) return null;
            // What the platform does around every code task (CI, the pull request, bringing the branch up to date, the
            // merge) is never a task: no agent has a tool for it, and a task planned for it only blocks.
            const { kept, dropped } = dropPlatformDuties(answer.json.tasks);
            const tasks = await repos.tasks.writePlannedGraph(tx, businessId, { tasks: kept, roadmapItemId: item.id, departmentId: roadmapItemDepartmentId(item) });
            await repos.audit.append(tx, businessId, {
              actorKind: "system",
              action: ROADMAP_PLAN_AUDIT_ACTION,
              target: { kind: "roadmap_item", id: item.id },
              details: { cycleNumber: input.cycleNumber, title: item.title, tasks: tasks.length, taskIds: tasks.map((t) => t.id), costMinor, model: answer.modelKey, ...(dropped.length ? { platformDuties: dropped.map((d) => ({ title: d.task.title.slice(0, 200), reason: d.reason })) } : {}) },
            });
            return tasks;
          });
          if (created) result.planned.push({ roadmapItemId: item.id, title: item.title, taskIds: created.map((t) => t.id), costMinor });
        } catch (err) {
          deps.log.warn({ businessId, cycleNumber: input.cycleNumber, roadmapItemId: r.id, err: (err as Error).message }, "cycle: a roadmap item could not be planned; it is tried again next cycle");
          result.failed.push({ roadmapItemId: r.id, title: r.title, reason: err instanceof AppError ? err.message : "the Planner did not answer" });
        }
      }
      return result;
    },
  };
}

export type RoadmapPlanActivities = ReturnType<typeof createRoadmapPlanActivities>;
