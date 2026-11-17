/**
 * The Planner's task graph (BUILD §11.6): from a roadmap item or a goal, the Planner (Opus) writes tasks with goals,
 * acceptance criteria, test expectations, file-scope hints and dependencies, written as `planned` tasks and edges.
 * `dev.tasks.plan` (routers/dev.ts) calls it from the Plan screen; the sign-off service calls it when the founder's
 * second approval starts the first build (founder, 2026-10-18), so the first graph is never built by hand.
 *
 * One plan per request (audit RA-13): a request that lands within `PLAN_REPEAT_WINDOW_MS` of a written plan for the
 * same item, goal and department returns that plan (`reused: true`) instead of a second graph; the write holds a
 * per-business planning lock so a plan written on another instance meanwhile is seen, not written twice.
 */
import { sitesEnabled } from "@foundmill/shared/sites";
import { buildPlannerRequest, dropPlatformDuties, PLANNER_SYSTEM_PROMPT, plannerDestination, plannerSpecSections, plannerWorkerTypes } from "@foundmill/agents";
import { repos, roadmapItemDepartmentId, type DbTx, type Task } from "@foundmill/db";
import { TaskGraphOutput } from "@foundmill/models";
import { ValidationError } from "@foundmill/shared";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Id, audit, type BusinessContext } from "../trpc";

export const PlanInput = z.object({ roadmapItemId: Id.optional(), goal: z.string().max(4000).optional(), departmentId: Id.optional() });
export type PlanInput = z.infer<typeof PlanInput>;
export type PlanResult = { tasks: Task[]; graph: Awaited<ReturnType<typeof repos.tasks.graph>>; costMinor: number; costLabel: "Estimate"; reused: boolean };

/** A plan written this recently for the same request is that request repeated (a double click, a retried call). */
export const PLAN_REPEAT_WINDOW_MS = 60_000;

/** What makes two plan requests the same request: the roadmap item, the goal (whitespace-insensitive) and the department. */
export function planKey(input: PlanInput): string {
  const goal = (input.goal ?? "").trim().replace(/\s+/g, " ");
  return createHash("sha256").update(JSON.stringify([input.roadmapItemId ?? null, goal, input.departmentId ?? null])).digest("hex").slice(0, 32);
}

/** The plan written for this request in the repeat window, while its tasks are still there; null otherwise. */
async function repeatedPlan(ctx: BusinessContext, tx: DbTx, key: string): Promise<PlanResult | null> {
  const entry = await repos.audit.latestMatching(tx, ctx.businessId, "dev.tasks.plan", { planKey: key }, new Date(Date.now() - PLAN_REPEAT_WINDOW_MS));
  const ids = (entry?.details as { taskIds?: unknown } | undefined)?.taskIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const byId = new Map((await repos.tasks.byIds(tx, ctx.businessId, ids.map(String))).filter((t) => t.archivedAt === null).map((t) => [t.id, t]));
  const tasks = ids.map((id) => byId.get(String(id))).filter((t): t is Task => t !== undefined);
  if (tasks.length !== ids.length) return null;
  return { tasks, graph: await repos.tasks.graph(tx, ctx.businessId), costMinor: 0, costLabel: "Estimate", reused: true };
}

/**
 * Plan `input` into tasks and write them (one Planner call, audited as `dev.tasks.plan` with `planKey`). `key`
 * defaults to the request's own key; the router passes it so its in-flight map and this agree. The business cycle
 * plans Now roadmap items the same way on its own (apps/orchestrator `planRoadmap`): same system prompt, same write.
 */
export async function planTaskGraph(ctx: BusinessContext, input: PlanInput, key: string = planKey(input)): Promise<PlanResult> {
  // Before the planner is paid for: the department must be this business's own (400), as the tasks' repo insists (audit RA-07).
  if (input.departmentId) await ctx.rls((tx) => repos.departments.assertOwned(tx, ctx.businessId, [input.departmentId], "departmentId"));
  const repeated = await ctx.rls((tx) => repeatedPlan(ctx, tx, key));
  if (repeated) return repeated;
  const roadmapItem = input.roadmapItemId ? await ctx.rls((tx) => repos.product.getRoadmapItem(tx, ctx.businessId, input.roadmapItemId!)) : null;
  const goal = input.goal ?? roadmapItem?.descriptionMd ?? roadmapItem?.title;
  if (!goal) throw new ValidationError("Give a goal or a roadmap item to plan");
  // What the Planner reads (WP-05 T5): the specification's text, the team it plans for and whether code can land.
  const { blocks, repository, agents } = await ctx.rls(async (tx) => ({
    blocks: await repos.product.listBlocks(tx, ctx.businessId),
    repository: await repos.integrations.codeRepository(tx, ctx.businessId),
    agents: (await repos.agents.list(tx, ctx.businessId, { limit: 500 })).items,
  }));
  const result = await ctx.models.complete({
    route: "planner",
    schema: TaskGraphOutput,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPlannerRequest({ goal, roadmapItem, sections: plannerSpecSections(blocks), destination: plannerDestination(repository, { sites: sitesEnabled(ctx.env) && !ctx.business.isDemo }), workerTypes: plannerWorkerTypes(agents) }) }],
    attribution: { businessId: ctx.businessId, kind: "planner" },
  });
  return ctx.rls(async (tx) => {
    // One writer per business at a time, so a request planned on another instance meanwhile is seen, not written twice.
    await repos.tasks.lockPlanning(tx, ctx.businessId);
    const written = await repeatedPlan(ctx, tx, key);
    if (written) return written;
    // What the platform does around every code task (CI, the pull request, bringing the branch up to date, the merge)
    // is never a task: no agent has a tool for it, and a task planned for it only blocks.
    const { kept, dropped } = dropPlatformDuties(result.json.tasks);
    const created = await repos.tasks.writePlannedGraph(tx, ctx.businessId, { tasks: kept, roadmapItemId: roadmapItem?.id ?? null, departmentId: input.departmentId ?? roadmapItemDepartmentId(roadmapItem) });
    await audit(tx, ctx, { action: "dev.tasks.plan", target: { kind: "roadmap_item", id: roadmapItem?.id ?? "" }, details: { tasks: created.length, costMinor: result.cost.costMinorInt, planKey: key, taskIds: created.map((t) => t.id), ...(dropped.length ? { platformDuties: dropped.map((d) => ({ title: d.task.title.slice(0, 200), reason: d.reason })) } : {}) } });
    // The founder meets these tasks on the Plan at once: their titles in the founder's words follow (0070), without holding the answer.
    if (created.length > 0) ctx.composer.requestFounderTitles(ctx.businessId, created.map((t) => t.id));
    return { tasks: created, graph: await repos.tasks.graph(tx, ctx.businessId), costMinor: result.cost.costMinorInt, costLabel: "Estimate" as const, reused: false };
  });
}
