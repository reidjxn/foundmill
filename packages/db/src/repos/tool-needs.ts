/**
 * The tool scout's memory (0154 `tool_needs`; founder, Nov 22, 2026). Service connection only for writes; a member's
 * own reads go through RLS.
 *
 * - `plan` records needs known at take charge that wait for a later stage (a regulated money product's identity checks
 *   wait for the first real users).
 * - `raise` is the one way a need reaches the board: once per project per category. It answers `raised: false` with
 *   why when the project already has a tool for it, when the scout is already on it, when the founder already has the
 *   recommendation or accepted one, and when the founder said "Not now" and the time to ask again has not come.
 *   Otherwise it creates one `tool_need` task for the Chief of Staff.
 * - `raiseStage` raises what a stage calls for: the archetype's needs for it and the planned rows waiting for it.
 * - `recommend` stores the pick, the alternatives and the sources with the note that shows them.
 * - `decide` stores the founder's answer.
 */
import { TOOL_CATEGORIES, TOOL_CATEGORY_LABELS, TOOL_NEED_ASK_AGAIN_DAYS, TOOL_NEED_STAGES, TOOL_ROUTES, type ToolCategory, type ToolNeedStage } from "@foundmill/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { tasks, toolNeeds, type Task, type ToolNeed, type ToolPick } from "../schema";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";
import { agentsRepo } from "./agents";
import { integrationsRepo } from "./integrations";
import { tasksRepo } from "./tasks";

const Category = z.enum(TOOL_CATEGORIES);
const Stage = z.enum(TOOL_NEED_STAGES);
const Reason = z.string().trim().min(1).max(2000);

export const RaiseToolNeedInput = z.object({
  category: Category,
  stage: Stage.nullable().default(null),
  reason: Reason,
  raisedByAgentId: Id.nullable().default(null),
  /** Connector keys that cover the category (`connectorKeysFor` in @foundmill/connectors): one connected means the project has a tool. */
  coveredBy: z.array(z.string()).default([]),
  now: z.date().optional(),
});
export type RaiseToolNeedInput = z.input<typeof RaiseToolNeedInput>;

export const ToolPickInput = z.object({
  name: z.string().trim().min(1).max(80),
  catalogKey: z.string().trim().min(1).max(64).optional(),
  route: z.enum(TOOL_ROUTES),
  why: z.string().trim().min(1).max(600),
  whyNow: z.string().trim().min(1).max(400),
  cost: z.string().trim().min(1).max(200),
  founderSteps: z.string().trim().min(1).max(600),
});

export const RecommendToolInput = z.object({
  pick: ToolPickInput,
  alternatives: z.array(z.object({ name: z.string().trim().min(1).max(80), line: z.string().trim().min(1).max(300) })).max(5),
  sources: z.array(z.object({ url: z.url({ protocol: /^https?$/ }), title: z.string().trim().min(1).max(300) })).max(20),
  inboxItemId: Id,
});
export type RecommendToolInput = z.input<typeof RecommendToolInput>;

/** Why a need was not raised. */
export type ToolNeedHeld = "has_tool" | "already_open" | "recommended" | "accepted" | "not_now";
export type RaiseToolNeedResult = { raised: true; need: ToolNeed; task: Task } | { raised: false; why: ToolNeedHeld; need: ToolNeed | null };

const TASK_OVER: readonly string[] = ["done", "failed", "stopped"];

/** The scout's task for a need. The catalog and what the project already has come from `read_tool_need`. */
export function toolNeedTask(category: ToolCategory, reason: string): { title: string; goalMd: string; acceptance: string[] } {
  const label = TOOL_CATEGORY_LABELS[category];
  return {
    title: `Find the right tool for ${label}`.slice(0, 200),
    goalMd: [
      `The project needs a tool for ${label}. Why, and why now: ${reason}`,
      `Follow your tool scout skill. Start with read_tool_need for "${category}": it gives the options Foundmill knows, what the project already has, and anything decided before. Compare two or three real options for this project, then give the founder one recommendation with recommend_tool.`,
      "Signing up with a vendor, accepting its terms, paying and entering a live key are the founder's steps, always.",
    ].join("\n\n"),
    acceptance: ["Two or three real options compared for this project, each with a source", "One recommendation sent to the founder with recommend_tool, its cost labeled Estimate", "Nothing was signed up for, accepted, paid or connected by the team"],
  };
}

export const toolNeedsRepo = {
  async get(db: Executor, businessId: string, category: ToolCategory): Promise<ToolNeed | null> {
    return maybeOne(await db.select().from(toolNeeds).where(and(eq(toolNeeds.businessId, businessId), eq(toolNeeds.category, category))).limit(1));
  },

  async list(db: Executor, businessId: string): Promise<ToolNeed[]> {
    return db.select().from(toolNeeds).where(eq(toolNeeds.businessId, businessId)).orderBy(asc(toolNeeds.createdAt), asc(toolNeeds.id));
  },

  /** Needs known now that wait for a later stage. A category the project already has a row for is left as it is. */
  async plan(db: Executor, businessId: string, needs: readonly { category: ToolCategory; stage: ToolNeedStage; reason: string }[]): Promise<void> {
    if (needs.length === 0) return;
    await db.insert(toolNeeds).values(needs.map((n) => ({ businessId, category: n.category, stage: n.stage, reason: n.reason, status: "planned" as const }))).onConflictDoNothing();
  },

  async raise(db: Executor, businessId: string, input: RaiseToolNeedInput): Promise<RaiseToolNeedResult> {
    const v = parseInput(RaiseToolNeedInput, input, "tool need");
    const now = v.now ?? new Date();
    return db.transaction(async (tx) => {
      // One raise at a time per project: two agents that miss the same tool in the same minute make one task.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tool_need:${businessId}`}))`);
      const existing = await toolNeedsRepo.get(tx, businessId, v.category);
      const held = (why: ToolNeedHeld): RaiseToolNeedResult => ({ raised: false, why, need: existing });
      const statuses = await integrationsRepo.connectionStatuses(tx, businessId, v.coveredBy);
      if (statuses.some((s) => s.status === "connected" || s.status === "degraded")) return held("has_tool");
      if (existing?.status === "accepted") return held("accepted");
      if (existing?.status === "recommended") return held("recommended");
      if (existing?.status === "not_now" && existing.askAgainAt && existing.askAgainAt > now) return held("not_now");
      if (existing?.status === "open" && existing.taskId) {
        const [task] = await tx.select({ status: tasks.status }).from(tasks).where(and(eq(tasks.businessId, businessId), eq(tasks.id, existing.taskId))).limit(1);
        if (task && !TASK_OVER.includes(task.status)) return held("already_open");
      }
      const chief = await agentsRepo.chiefOfStaff(tx, businessId);
      const task = await tasksRepo.create(tx, businessId, { kind: "tool_need", ...toolNeedTask(v.category, v.reason), assigneeAgentId: chief?.id ?? null, departmentId: chief?.departmentIds[0] ?? null, status: "ready" });
      const opened = { status: "open" as const, stage: v.stage ?? existing?.stage ?? null, reason: v.reason, raisedByAgentId: v.raisedByAgentId, taskId: task.id, inboxItemId: null, askAgainAt: null, decidedAt: null };
      const [need] = await tx
        .insert(toolNeeds)
        .values({ businessId, category: v.category, ...opened })
        .onConflictDoUpdate({ target: [toolNeeds.businessId, toolNeeds.category], set: opened })
        .returning();
      return { raised: true, need: need!, task };
    });
  },

  /** What a stage calls for: `seeds` (the archetype's needs for it) and the planned rows waiting for it. */
  async raiseStage(db: Executor, businessId: string, stage: ToolNeedStage, seeds: readonly { category: ToolCategory; why: string }[], coveredBy: (category: ToolCategory) => string[], now?: Date): Promise<RaiseToolNeedResult[]> {
    const planned = await db.select().from(toolNeeds).where(and(eq(toolNeeds.businessId, businessId), eq(toolNeeds.stage, stage), eq(toolNeeds.status, "planned")));
    const wanted = [...seeds.map((s) => ({ category: s.category, reason: s.why })), ...planned.filter((p) => !seeds.some((s) => s.category === p.category)).map((p) => ({ category: p.category, reason: p.reason }))];
    const out: RaiseToolNeedResult[] = [];
    for (const w of wanted) out.push(await toolNeedsRepo.raise(db, businessId, { category: w.category, stage, reason: w.reason, coveredBy: coveredBy(w.category), ...(now ? { now } : {}) }));
    return out;
  },

  async recommend(db: Executor, businessId: string, category: ToolCategory, input: RecommendToolInput): Promise<ToolNeed> {
    const v = parseInput(RecommendToolInput, input, "tool recommendation");
    const pick: ToolPick = { name: v.pick.name, ...(v.pick.catalogKey ? { catalogKey: v.pick.catalogKey } : {}), route: v.pick.route, why: v.pick.why, whyNow: v.pick.whyNow, cost: v.pick.cost, founderSteps: v.pick.founderSteps };
    const set = { status: "recommended" as const, pick, alternatives: v.alternatives, sources: v.sources, inboxItemId: v.inboxItemId, askAgainAt: null, decidedAt: null };
    const [need] = await db
      .insert(toolNeeds)
      .values({ businessId, category, reason: v.pick.whyNow, ...set })
      .onConflictDoUpdate({ target: [toolNeeds.businessId, toolNeeds.category], set })
      .returning();
    return need!;
  },

  /** The founder's answer to the recommendation. "Not now" keeps the question away until `askAgainAt` (default: `TOOL_NEED_ASK_AGAIN_DAYS`). */
  async decide(db: Executor, businessId: string, category: ToolCategory, answer: "accepted" | "not_now", options: { now?: Date; askAgainAt?: Date } = {}): Promise<ToolNeed | null> {
    const now = options.now ?? new Date();
    const askAgainAt = answer === "not_now" ? (options.askAgainAt ?? new Date(now.getTime() + TOOL_NEED_ASK_AGAIN_DAYS * 86_400_000)) : null;
    return maybeOne(await db.update(toolNeeds).set({ status: answer, decidedAt: now, askAgainAt }).where(and(eq(toolNeeds.businessId, businessId), eq(toolNeeds.category, category))).returning());
  },
};
