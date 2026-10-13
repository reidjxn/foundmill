/**
 * dev.tasks.plan/list/start/pause/resume/shout/reassign/upgradeModel/stop/openInClaudeCode, dev.sessions.stream/replay,
 * dev.prs.list (BUILD §11.6) and dev.simulate (BUILD §13.3, SEC-2). Every control is a Temporal signal to
 * `session:{sessionId}` that degrades to `{ queued: false, reason }`; the local task state is always updated so the
 * Training Ground reflects the intent.
 */
import { FLAGS, isSimulateEnv } from "@foundmill/config";
import { HOUSE_STYLE } from "@foundmill/agents";
import { TaskListFilter, codeRepositoryOf, periodOf, repos, type AgentSession, type DbTx, type Task } from "@foundmill/db";
import { SESSION_EVENT_KINDS, sessionStreamKey } from "@foundmill/events";
import { TaskGraphOutput } from "@foundmill/models";
import { AppError, NotFoundError, ValidationError, connectorMode, type TaskStatus } from "@foundmill/shared";
import { createHash } from "node:crypto";
import { z } from "zod";
import { replaySession } from "../services/replay";
import { assertAgentsRunning } from "../services/stop-guard";
import { SIGNALS, WORKFLOWS, workflowIds, type SignalName } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { Id, adminProcedure, audit, emit, router, sectionAdmin, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

const read = sectionRead("development");

/** Saved files are shown as text up to 1 MB; anything that is not UTF-8 (or holds NUL) is binary. */
export const SAVED_FILE_TEXT_LIMIT = 1024 * 1024;
export function decodeSavedFile(content: Uint8Array): { binary: boolean; truncated: boolean; text: string | null } {
  const head = content.subarray(0, SAVED_FILE_TEXT_LIMIT);
  if (head.includes(0)) return { binary: true, truncated: false, text: null };
  try {
    // A cut in the middle of a multi-byte character at the limit is not binary: decode leniently there.
    const text = new TextDecoder("utf-8", { fatal: content.byteLength <= SAVED_FILE_TEXT_LIMIT }).decode(head);
    return { binary: false, truncated: content.byteLength > SAVED_FILE_TEXT_LIMIT, text };
  } catch {
    return { binary: true, truncated: false, text: null };
  }
}
const write = sectionWrite("development");

/** Simulation names are connector catalogue keys (`payment.received`, `bank.sync`…); nothing else reaches the URL. */
export const SimulationName = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, "simulation names look like payment.received").max(60);

export const SimulateInput = z.object({
  eventName: SimulationName,
  connector: z.string().trim().min(1).max(60).optional(),
  seed: z.string().max(120).optional(),
  /** Event-specific overrides (amountMinor, email, sentiment, channelKey...). */
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Whether `dev.simulate` exists here: the flag and development/staging; production and test never (404). */
export const simulateAvailable = (appEnv: string, flag: boolean = FLAGS.devSimulatePanel): boolean => flag && isSimulateEnv(appEnv);

const SHOUT_PRESETS = ["Focus on tests", "Simplify", "Ask before schema changes", "Match the design system", "Hurry up"] as const;

/** Worktree branch per task (packages/sandbox `agentBranch`; mirrored here so the API does not depend on the sandbox package). */
export const agentBranch = (taskId: string) => `agent/${taskId}`;

function departmentOfRoadmapItem(item: { ownerRef: unknown } | null): string | null {
  const ref = item?.ownerRef as { kind?: string; id?: string } | null | undefined;
  return ref && ref.kind === "department" && typeof ref.id === "string" ? ref.id : null;
}

async function openSession(ctx: BusinessContext, taskId: string) {
  const sessions = await repos.agents.listSessions(ctx.db, ctx.businessId, { taskId, openOnly: true, limit: 1 });
  return sessions.items[0] ?? null;
}

async function signalTask(ctx: BusinessContext, task: Task, signal: SignalName, payload: Record<string, unknown>) {
  const session = await openSession(ctx, task.id);
  if (!session) return { queued: false, workflowId: "", reason: "no running session for this task" };
  // Always the computed id: rows written before 0023 may still say `session:pending`, a workflow that never existed.
  return ctx.temporal.signal(workflowIds.session(session.id), signal, payload);
}

/** Statuses a task may be started from by hand (Start on the Plan): never while running, in review or done. */
export const STARTABLE_TASK_STATUSES = ["planned", "ready", "paused", "blocked", "failed", "stopped"] as const satisfies readonly TaskStatus[];

/** Task start refused for the task's own state (409): already running or finished, an open dependency, its agent. */
export class TaskStartError extends AppError {
  constructor(message: string, details?: unknown) {
    super("task_start_refused", message, 409, details);
  }
}

export const PlanInput = z.object({ roadmapItemId: Id.optional(), goal: z.string().max(4000).optional(), departmentId: Id.optional() });
type PlanInput = z.infer<typeof PlanInput>;
type PlanResult = { tasks: Task[]; graph: Awaited<ReturnType<typeof repos.tasks.graph>>; costMinor: number; costLabel: "Estimate"; reused: boolean };

/** A plan written this recently for the same request is that request repeated (a double click, a retried call). */
export const PLAN_REPEAT_WINDOW_MS = 60_000;
/** Plans being built on this instance, by business and request: a concurrent identical request shares the one planner call. */
const plansInFlight = new Map<string, Promise<PlanResult>>();

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

async function buildPlan(ctx: BusinessContext, input: PlanInput, key: string): Promise<PlanResult> {
  const repeated = await ctx.rls((tx) => repeatedPlan(ctx, tx, key));
  if (repeated) return repeated;
  const roadmapItem = input.roadmapItemId ? await ctx.rls((tx) => repos.product.getRoadmapItem(tx, ctx.businessId, input.roadmapItemId!)) : null;
  const goal = input.goal ?? roadmapItem?.descriptionMd ?? roadmapItem?.title;
  if (!goal) throw new ValidationError("Give a goal or a roadmap item to plan");
  const blocks = await ctx.rls((tx) => repos.product.listBlocks(tx, ctx.businessId));
  const result = await ctx.models.complete({
    route: "planner",
    schema: TaskGraphOutput,
    system: `You are the Planner. Build a task graph with goals, acceptance criteria, test expectations, file-scope hints and dependencies. ${HOUSE_STYLE}`,
    messages: [{ role: "user", content: "```json\n" + JSON.stringify({ goal, roadmap_item: roadmapItem, spec_sections: blocks.map((b) => b.section) }) + "\n```" }],
    attribution: { businessId: ctx.businessId, kind: "planner" },
  });
  return ctx.rls(async (tx) => {
    // One writer per business at a time, so a request planned on another instance meanwhile is seen, not written twice.
    await repos.tasks.lockPlanning(tx, ctx.businessId);
    const written = await repeatedPlan(ctx, tx, key);
    if (written) return written;
    const idByPlanned = new Map<string, string>();
    const created: Task[] = [];
    for (const t of result.json.tasks) {
      const task = await repos.tasks.create(tx, ctx.businessId, {
        kind: t.kind,
        title: t.title.slice(0, 200),
        goalMd: t.goal,
        acceptance: t.acceptance_criteria,
        fileScope: t.file_scope_hints,
        roadmapItemId: roadmapItem?.id ?? null,
        departmentId: input.departmentId ?? departmentOfRoadmapItem(roadmapItem),
        status: "planned",
        priority: t.hard ? 10 : 0,
      });
      idByPlanned.set(t.id, task.id);
      created.push(task);
    }
    for (const t of result.json.tasks) for (const dep of t.depends_on) if (idByPlanned.has(dep)) await repos.tasks.addEdge(tx, ctx.businessId, idByPlanned.get(dep)!, idByPlanned.get(t.id)!);
    await audit(tx, ctx, { action: "dev.tasks.plan", target: { kind: "roadmap_item", id: roadmapItem?.id ?? "" }, details: { tasks: created.length, costMinor: result.cost.costMinorInt, planKey: key, taskIds: created.map((t) => t.id) } });
    return { tasks: created, graph: await repos.tasks.graph(tx, ctx.businessId), costMinor: result.cost.costMinorInt, costLabel: "Estimate" as const, reused: false };
  });
}

export const devRouter = router({
  tasks: router({
    /**
     * Planner (Opus) builds a task graph from a roadmap item or a goal; tasks + edges are written (BUILD §11.6). One plan
     * per request (audit RA-13): a second identical request while the first is planning shares its result, and one that
     * lands within PLAN_REPEAT_WINDOW_MS of a written plan returns that plan (`reused: true`) instead of a second graph.
     */
    plan: write.input(PlanInput).use(modelLimited("planner")).mutation(({ ctx, input }) => {
      const key = planKey(input);
      const flightKey = `${ctx.businessId}:${key}`;
      const inFlight = plansInFlight.get(flightKey);
      if (inFlight) return inFlight;
      const run = buildPlan(ctx, input, key).finally(() => plansInFlight.delete(flightKey));
      plansInFlight.set(flightKey, run);
      return run;
    }),

    list: read.input(TaskListFilter).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const [page, edges, counts] = await Promise.all([repos.tasks.list(tx, ctx.businessId, input ?? {}), repos.tasks.listEdges(tx, ctx.businessId), repos.tasks.countByStatus(tx, ctx.businessId)]);
        return { ...page, edges, counts };
      }),
    ),

    get: read.input(z.object({ taskId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const task = await repos.tasks.get(tx, ctx.businessId, input.taskId);
        const sessions = await repos.agents.listSessions(tx, ctx.businessId, { taskId: task.id, limit: 20 });
        return { task, sessions: sessions.items, branch: agentBranch(task.id) };
      }),
    ),

    /**
     * Start: an agentSession workflow is started for the task. Refused (CONFLICT) while the team is stopped, while the
     * task already runs (or has a session open), is in review or done, waits on an unfinished dependency, or when its
     * agent is paused, released or at its wage cap: a start never wakes a paused agent, so it cannot undo Stop all agents.
     * The task is claimed with one conditional update, so a double click starts one session.
     */
    start: write.input(z.object({ taskId: Id })).mutation(async ({ ctx, input }) => {
      await assertAgentsRunning(ctx, "the task");
      const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId));
      if (!task.assigneeAgentId) throw new ValidationError("Assign an agent before starting the task");
      if (!(STARTABLE_TASK_STATUSES as readonly TaskStatus[]).includes(task.status)) throw new TaskStartError(task.status === "running" ? "The task is already running." : `The task is ${task.status}; it cannot be started again.`, { status: task.status });
      const [assignee, open, dependencies] = await ctx.rls((tx) => Promise.all([repos.agents.get(tx, ctx.businessId, task.assigneeAgentId!), repos.agents.listSessions(tx, ctx.businessId, { taskId: task.id, openOnly: true, limit: 1 }), repos.tasks.openDependencies(tx, ctx.businessId, task.id)]));
      if (open.items.length > 0) throw new TaskStartError("The task already has a session running.", { sessionId: open.items[0]!.id });
      if (dependencies.length > 0) throw new TaskStartError(`Finish what it depends on first: ${dependencies.map((d) => `"${d.title}"`).join(", ")}.`, { dependencies: dependencies.map((d) => d.id) });
      if (assignee.archivedAt) throw new TaskStartError(`${assignee.name} has left the team. Reassign the task first.`);
      if (assignee.status === "paused") throw new TaskStartError(assignee.pausedReason === "wage_cap" ? `${assignee.name} reached its wage cap for the month and is paused. Raise the cap on its profile or reassign the task.` : `${assignee.name} is paused. Resume the agents or reassign the task first.`, { pausedReason: assignee.pausedReason });
      const spend = await repos.usage.agentSpend(ctx.db, ctx.businessId, assignee.id, periodOf(new Date()));
      if (spend.remainingMinor !== null && spend.remainingMinor <= 0) throw new TaskStartError(`${assignee.name} reached its wage cap for the month. Raise the cap on its profile or reassign the task.`);
      // Exactly one start wins the task; a second (double click, another tab) finds it running and is refused.
      const claimed = await ctx.rls((tx) => repos.tasks.claimForStart(tx, ctx.businessId, task.id, STARTABLE_TASK_STATUSES));
      if (!claimed) throw new TaskStartError("The task was just started.");
      // agent_sessions is service-written (orchestrator-owned); created on the service db, outside the RLS transaction.
      let session: AgentSession;
      try {
        session = await repos.agents.createSession(ctx.db, ctx.businessId, { agentId: assignee.id, taskId: task.id, modelKey: assignee.modelKey });
      } catch (err) {
        await ctx.rls((tx) => repos.tasks.setStatus(tx, ctx.businessId, task.id, task.status, { force: true }));
        throw err;
      }
      await ctx.rls(async (tx) => {
        // A computed status, never over a pause (a stop that lands meanwhile wins).
        await repos.agents.setHealthStatus(tx, ctx.businessId, assignee.id, "healthy");
        await emit(tx, ctx, { type: "task.started", payload: { taskId: task.id, kind: task.kind, title: task.title, assigneeAgentId: assignee.id, sessionId: session.id, roadmapItemId: task.roadmapItemId, workflowId: workflowIds.session(session.id), branch: task.kind === "code" ? agentBranch(task.id) : null } });
        await audit(tx, ctx, { action: "dev.tasks.start", target: { kind: "task", id: task.id }, details: { sessionId: session.id, from: task.status } });
      });
      const workflow = await ctx.temporal.start(WORKFLOWS.agentSession, { workflowId: workflowIds.session(session.id), args: [{ businessId: ctx.businessId, agentId: assignee.id, taskId: task.id, sessionId: session.id }] });
      return { session, workflow, stream: sessionStreamKey(session.id) };
    }),

    pause: write.input(z.object({ taskId: Id })).mutation(async ({ ctx, input }) => {
      const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId));
      const workflow = await signalTask(ctx, task, SIGNALS.pause, { by: ctx.userId });
      const updated = await ctx.rls(async (tx) => {
        const t = task.status === "running" ? await repos.tasks.setStatus(tx, ctx.businessId, task.id, "paused") : task;
        await audit(tx, ctx, { action: "dev.tasks.pause", target: { kind: "task", id: task.id }, details: { queued: workflow.queued } });
        return t;
      });
      return { task: updated, workflow };
    }),

    resume: write.input(z.object({ taskId: Id })).mutation(async ({ ctx, input }) => {
      await assertAgentsRunning(ctx, "the task");
      const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId));
      const workflow = await signalTask(ctx, task, SIGNALS.resume, { by: ctx.userId });
      const updated = await ctx.rls(async (tx) => {
        const t = task.status === "paused" ? await repos.tasks.setStatus(tx, ctx.businessId, task.id, "running") : task;
        await audit(tx, ctx, { action: "dev.tasks.resume", target: { kind: "task", id: task.id }, details: { queued: workflow.queued } });
        return t;
      });
      return { task: updated, workflow };
    }),

    /** Shout at one task's agent or every running agent (AC-11.6.4: reaches the session within 2 s). */
    shout: write.input(z.object({ taskId: Id.optional(), preset: z.enum(SHOUT_PRESETS).optional(), text: z.string().max(280).optional() })).mutation(async ({ ctx, input }) => {
      const message = input.text?.trim() || input.preset;
      if (!message) throw new ValidationError("Pick a preset or write a nudge");
      const tasks = input.taskId ? [await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId!))] : (await ctx.rls((tx) => repos.tasks.list(tx, ctx.businessId, { status: "running", limit: 200 }))).items;
      const results = await Promise.all(tasks.map((t) => signalTask(ctx, t, SIGNALS.shout, { message, preset: input.preset ?? null, by: ctx.userId, at: new Date().toISOString() })));
      await ctx.rls((tx) => audit(tx, ctx, { action: "dev.tasks.shout", target: { kind: "task", id: input.taskId ?? "all" }, details: { message, tasks: tasks.length, queued: results.filter((r) => r.queued).length } }));
      return { message, results };
    }),

    reassign: write.input(z.object({ taskId: Id, agentId: Id })).mutation(async ({ ctx, input }) => {
      const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId));
      const workflow = task.status === "running" ? await signalTask(ctx, task, SIGNALS.stop, { reason: "reassigned", by: ctx.userId }) : { queued: false, workflowId: "", reason: "task not running" };
      const updated = await ctx.rls(async (tx) => {
        const target = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (target.archivedAt) throw new TaskStartError(`${target.name} has left the team.`);
        const t = await repos.tasks.reassign(tx, ctx.businessId, task.id, input.agentId);
        const next = task.status === "running" ? await repos.tasks.setStatus(tx, ctx.businessId, t.id, "stopped", { force: true }).then(() => repos.tasks.setStatus(tx, ctx.businessId, t.id, "ready")) : t;
        await audit(tx, ctx, { action: "dev.tasks.reassign", target: { kind: "task", id: task.id }, details: { from: task.assigneeAgentId, to: input.agentId } });
        return next;
      });
      return { task: updated, workflow };
    }),

    /** Upgrade the task's agent to Opus for this task (model chip; the agent's default model is untouched). */
    upgradeModel: write.input(z.object({ taskId: Id })).mutation(async ({ ctx, input }) => {
      const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId));
      const workflow = await signalTask(ctx, task, SIGNALS.shout, { message: "Upgrade to Opus", modelKey: "opus", by: ctx.userId });
      await ctx.rls((tx) => audit(tx, ctx, { action: "dev.tasks.upgrade_model", target: { kind: "task", id: task.id }, details: { modelKey: "opus", queued: workflow.queued } }));
      return { task, workflow, modelKey: "opus" as const };
    }),

    /** Stop and discard the branch (reversible: the task returns to ready). */
    stop: write.input(z.object({ taskId: Id })).mutation(async ({ ctx, input }) => {
      const task = await ctx.rls((tx) => repos.tasks.get(tx, ctx.businessId, input.taskId));
      const workflow = await signalTask(ctx, task, SIGNALS.stop, { reason: "founder_stop", by: ctx.userId });
      const updated = await ctx.rls(async (tx) => {
        const t = ["done", "stopped"].includes(task.status) ? task : await repos.tasks.setStatus(tx, ctx.businessId, task.id, "stopped", { force: true });
        // A stop is a safety action: it never un-pauses the agent, and leaves it working when another task of its is open.
        if (task.assigneeAgentId) {
          const others = await repos.agents.listSessions(tx, ctx.businessId, { agentId: task.assigneeAgentId, openOnly: true, limit: 10 });
          if (!others.items.some((s) => s.taskId !== task.id)) await repos.agents.setHealthStatus(tx, ctx.businessId, task.assigneeAgentId, "idle");
        }
        await audit(tx, ctx, { action: "dev.tasks.stop", target: { kind: "task", id: task.id }, details: { queued: workflow.queued } });
        return t;
      });
      return { task: updated, workflow };
    }),

    /** Export branch + task context so the founder can continue in Claude Code. */
    openInClaudeCode: read.input(z.object({ taskId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const task = await repos.tasks.get(tx, ctx.businessId, input.taskId);
        const agent = task.assigneeAgentId ? await repos.agents.get(tx, ctx.businessId, task.assigneeAgentId) : null;
        const branch = agentBranch(task.id);
        const context = [`# ${task.title}`, "", task.goalMd, "", "## Acceptance", ...(task.acceptance as string[]).map((a) => `- ${a}`), "", task.fileScope.length ? `## File scope\n${task.fileScope.map((f) => `- ${f}`).join("\n")}` : ""].join("\n");
        return { branch, checkout: `git fetch origin ${branch} && git checkout ${branch}`, contextMd: context, agent: agent ? { id: agent.id, name: agent.name, modelKey: agent.modelKey } : null };
      }),
    ),
  }),

  sessions: router({
    /** Where to subscribe (apps/stream multiplexes `as:{sessionId}`). */
    stream: read.input(z.object({ sessionId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const session = await repos.agents.getSession(tx, ctx.businessId, input.sessionId);
        return { session, channel: sessionStreamKey(session.id), live: session.endedAt === null };
      }),
    ),
    /** The recorded events of a session (its `as:{sessionId}` stream, or the mock recording it was played from) plus where live frames arrive. */
    replay: read.input(z.object({ sessionId: Id, limit: z.number().int().min(1).max(5000).optional(), after: z.string().max(64).optional(), kinds: z.array(z.enum(SESSION_EVENT_KINDS)).optional() })).query(async ({ ctx, input }) => {
      const session = await ctx.rls((tx) => repos.agents.getSession(tx, ctx.businessId, input.sessionId));
      const replay = await replaySession({ redis: ctx.redis, recordings: ctx.recordings }, session, { limit: input.limit, after: input.after, kinds: input.kinds });
      return { session, recordingRef: session.recordingRef, channel: sessionStreamKey(session.id), live: session.endedAt === null, ...replay };
    }),
    list: read.input(z.object({ agentId: Id.optional(), taskId: Id.optional(), openOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).default(50) })).query(({ ctx, input }) => ctx.rls((tx) => repos.agents.listSessions(tx, ctx.businessId, input))),
  }),

  /**
   * Settings → Integrations → Simulate (owner/admin only; SEC-2). Membership and role are asserted by
   * `adminProcedure`; the service token is minted here for exactly this business and user, and ingest refuses
   * anything else. The answer is ingest's verbatim (the panel shows it), and the attempt is audited either way.
   */
  simulate: adminProcedure.input(SimulateInput).mutation(async ({ ctx, input }) => {
    if (!simulateAvailable(ctx.env.APP_ENV)) throw new NotFoundError("route");
    const result = await ctx.ingest.simulate({ businessId: ctx.businessId, userId: ctx.userId, eventName: input.eventName, connector: input.connector, seed: input.seed, params: input.params });
    const written = typeof result.body === "object" && result.body !== null ? (result.body as { written?: unknown; duplicates?: unknown; connector?: unknown }) : {};
    await ctx.rls((tx) =>
      audit(tx, ctx, {
        action: "dev.simulate",
        target: { kind: "simulation", id: input.eventName },
        details: { eventName: input.eventName, connector: input.connector ?? (typeof written.connector === "string" ? written.connector : null), seed: input.seed ?? null, ok: result.ok, status: result.status, written: typeof written.written === "number" ? written.written : null, duplicates: typeof written.duplicates === "number" ? written.duplicates : null },
      }),
    );
    return { ...result, label: "Simulated" as const };
  }),

  /** The code agents wrote on code tasks, kept after each session (0013 workspaces; written by the orchestrator). */
  code: router({
    /** Code tasks with saved work, the most recently saved first. */
    list: read.query(({ ctx }) => ctx.rls((tx) => repos.workspaces.listTasks(tx, ctx.businessId))),

    /** A task's saved files (the latest session's, or the one asked for) and every saved session, newest first. */
    files: read.input(z.object({ taskId: Id, snapshotId: Id.optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const snapshot = input.snapshotId ? await repos.workspaces.getSnapshot(tx, ctx.businessId, input.snapshotId) : await repos.workspaces.latest(tx, ctx.businessId, input.taskId);
        if (input.snapshotId && (!snapshot || snapshot.taskId !== input.taskId)) throw new NotFoundError("saved code", input.snapshotId);
        const history = await repos.workspaces.listSnapshots(tx, ctx.businessId, input.taskId);
        return { taskId: input.taskId, branch: agentBranch(input.taskId), snapshot, history };
      }),
    ),

    /** One saved file as text (the first 1 MB), or marked binary. */
    file: read.input(z.object({ snapshotId: Id, path: z.string().min(1).max(500) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const snapshot = await repos.workspaces.getSnapshot(tx, ctx.businessId, input.snapshotId);
        const entry = snapshot?.files.find((f) => f.path === input.path);
        if (!snapshot || !entry) throw new NotFoundError("saved file", input.path);
        const [file] = await repos.workspaces.readFiles(tx, ctx.businessId, snapshot, [input.path]);
        if (!file) throw new NotFoundError("saved file", input.path);
        return { path: entry.path, size: entry.size, sha256: entry.sha256, ...decodeSavedFile(file.content) };
      }),
    ),

    /**
     * Where saved code is pushed after each session: the GitHub integration's repository (null when none is chosen),
     * whether GitHub is connected, and whether it is the simulated GitHub (mock mode: nothing reaches github.com).
     */
    repository: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const integration = await repos.integrations.getByKey(tx, ctx.businessId, "github");
        const connected = integration !== null && integration.archivedAt === null && integration.status !== "disconnected";
        // Simulated follows the connection itself (a row connected in mock mode never reaches github.com, whatever this
        // service's environment says); with no connection, what Connect would make here.
        const simulated = integration && connected ? integration.status === "mock" : connectorMode(ctx.env, "github") === "mock";
        return { connected, status: integration?.status ?? null, repository: integration ? codeRepositoryOf(integration) : null, simulated };
      }),
    ),

    /** Choose the repository saved code is pushed to (`owner/name` or a github.com URL), or stop pushing with null. */
    setRepository: sectionAdmin("development")
      // Pushing is off unless the founder turns it on: a push runs the repository's CI and preview deploys on agent code.
      .input(z.object({ repository: z.string().trim().max(300).nullable(), pushEnabled: z.boolean().default(false) }))
      .mutation(({ ctx, input }) =>
        ctx.rls(async (tx) => {
          const fullName = input.repository ? input.repository.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "") : null;
          const row = await repos.integrations.setCodeRepository(tx, ctx.businessId, fullName || null, { pushEnabled: input.pushEnabled });
          await audit(tx, ctx, { action: "dev.code.set_repository", target: { kind: "integration", id: row.id }, details: { repository: fullName || null, pushEnabled: Boolean(fullName) && input.pushEnabled } });
          return { repository: codeRepositoryOf(row) };
        }),
      ),

    /**
     * Forget a task's saved code: every saved session of the task and the contents no other task uses. Owners and admins
     * only (RLS allows nothing else); a founder action, never an agent's. The next session on the task starts empty.
     */
    forget: sectionAdmin("development").input(z.object({ taskId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const result = await repos.workspaces.forgetTask(tx, ctx.businessId, input.taskId);
        if (result.snapshots === 0) throw new NotFoundError("saved code", input.taskId);
        await audit(tx, ctx, { action: "dev.code.forget", target: { kind: "task", id: input.taskId }, details: result });
        return result;
      }),
    ),
  }),

  prs: router({
    /** Pull requests = tasks in review/merging/done plus `pr.merged` events (the GitHub connector is the source). */
    list: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [tasks, merged] = await Promise.all([repos.tasks.list(tx, ctx.businessId, { status: ["review", "merging", "done"], limit: 200 }), repos.events.list(tx, ctx.businessId, { type: "pr.merged", limit: 200 })]);
        return {
          open: tasks.items.filter((t) => t.status !== "done").map((t) => ({ taskId: t.id, title: t.title, status: t.status, branch: agentBranch(t.id), agentId: t.assigneeAgentId })),
          merged: merged.items.map((e) => ({ eventId: e.id, occurredAt: e.occurredAt, ...(e.payload as Record<string, unknown>) })),
        };
      }),
    ),
  }),
});
