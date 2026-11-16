/**
 * dev.tasks.plan/list/start/pause/resume/shout/reassign/upgradeModel/stop/openInClaudeCode, dev.sessions.stream/replay,
 * dev.prs.list (BUILD §11.6) and dev.simulate (BUILD §13.3, SEC-2). Every control is a Temporal signal to
 * `session:{sessionId}` that degrades to `{ queued: false, reason }`; the local task state is always updated so the
 * Training Ground reflects the intent.
 */
import { FLAGS, INPUT_LIMITS, isSimulateEnv } from "@foundmill/config";
import { REPOSITORY_FULL_NAME, TaskListFilter, codeRepositoryOf, repos, type AgentSession, type DbTx, type Executor, type Task } from "@foundmill/db";
import { SESSION_EVENT_KINDS, sessionStreamKey } from "@foundmill/events";
import { boundedRecord, ForbiddenError, NotFoundError, ValidationError, connectorMode, hasSectionAccess, sessionSections, type EntityKind } from "@foundmill/shared";
import { buildManifest, extractEntityIds, stripInvalidMentions, type ManifestEntityInput } from "@foundmill/entity-linker";
import { z } from "zod";
import { verifyCodeRepository } from "../services/code-repository";
import { replaySession } from "../services/replay";
import { PlanInput, planKey, planTaskGraph, type PlanResult } from "../services/task-graph";

export { PLAN_REPEAT_WINDOW_MS, PlanInput, planKey } from "../services/task-graph";
import { assertAgentsRunning } from "../services/stop-guard";
import { SIGNALS, workflowIds, type SignalName } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { Id, adminProcedure, audit, router, sectionAdmin, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

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
  params: boundedRecord(INPUT_LIMITS.jsonObjectKeys, z.record(z.string(), z.unknown())).optional(),
});

/** Whether `dev.simulate` exists here: the flag and development/staging; production and test never (404). */
export const simulateAvailable = (appEnv: string, flag: boolean = FLAGS.devSimulatePanel): boolean => flag && isSimulateEnv(appEnv);

const SHOUT_PRESETS = ["Focus on tests", "Simplify", "Ask before schema changes", "Match the design system", "Hurry up"] as const;

/** Worktree branch per task (packages/sandbox `agentBranch`; mirrored here so the API does not depend on the sandbox package). */
export { agentBranch } from "../services/task-start";
import { TaskStartError, agentBranch, startTaskByHand } from "../services/task-start";

/**
 * A session the member may watch: besides Development (the procedure's own wall), every module of the department its
 * work is filed under (a Finance agent's terminal shows Finance's figures). apps/stream applies the same wall to
 * `as:<sessionId>` (security review S1).
 */
async function readableSession(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "membership">, sessionId: string): Promise<AgentSession> {
  const session = await repos.agents.getSession(tx, ctx.businessId, sessionId);
  const walled = sessionSections(await repos.agents.sessionModuleKeys(tx, ctx.businessId, session)).filter((section) => !hasSectionAccess(ctx.membership, section, "read"));
  if (walled.length > 0) throw new ForbiddenError(`You do not have read access to ${walled.join(" and ")}, where this session's work belongs`);
  return session;
}

/**
 * The task's latest report (WP-05 T7), as the founder reads it on the task. Read in the caller's RLS transaction, so a
 * collaborator gets null (`task_reports` is closed to them). The body is agent-written and may quote web pages: every
 * mention that does not name something this reader can open is stripped to text (`stripInvalidMentions`). The manifest
 * holds the records the body names: the business's agents, and its CRM entities only for a reader with CRM read (as
 * the conversation's `manifestFor`).
 */
async function taskReportFor(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "membership">, taskId: string) {
  const row = await repos.taskReports.latestForTask(tx, ctx.businessId, taskId);
  if (!row) return null;
  const ids = extractEntityIds(row.bodyMd).filter((id) => Id.safeParse(id).success);
  const [crm, agents] = ids.length === 0 ? [[], []] : await Promise.all([hasSectionAccess(ctx.membership, "crm", "read") ? repos.entities.manifest(tx, ctx.businessId, { ids }) : Promise.resolve([]), repos.agents.list(tx, ctx.businessId, { limit: 200 }).then((p) => p.items)]);
  const entries: ManifestEntityInput[] = [
    ...crm.map((e) => ({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, aliases: e.aliases })),
    ...agents.map((a) => ({ id: a.id, kind: "agent" as const, name: a.name, aliases: [], role: a.role })),
  ];
  const bodyMd = stripInvalidMentions(row.bodyMd, buildManifest(entries, { strictKinds: false }));
  return { id: row.id, title: row.title, bodyMd, sources: row.sources, simulated: row.simulated, createdAt: row.createdAt.toISOString() };
}

/** A merged pull request row: GitHub's `pr.merged` payload (repo, PR number, diff stats…) or the merge queue's own fields. */
type MergedPr = Record<string, unknown> & { eventId: string | null; occurredAt: Date; source: "github" | "merge_queue"; taskId?: unknown; title?: unknown };

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

export { STARTABLE_TASK_STATUSES, TaskNotStartedError, TaskStartError } from "../services/task-start";

/** Plans being built on this instance, by business and request: a concurrent identical request shares the one planner call. */
const plansInFlight = new Map<string, Promise<PlanResult>>();

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
      const run = planTaskGraph(ctx, input, key).finally(() => plansInFlight.delete(flightKey));
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
        const [sessions, report] = await Promise.all([repos.agents.listSessions(tx, ctx.businessId, { taskId: task.id, limit: 20 }), taskReportFor(tx, ctx, task.id)]);
        return { task, sessions: sessions.items, branch: agentBranch(task.id), report };
      }),
    ),

    /**
     * Start: an agentSession workflow is started for the task. A task nobody is assigned to gets an agent the way the
     * cycle picks one (`autoAssign`, lead 2026-10-24) and is refused only when nobody on the team does that kind of work.
     * Refused (CONFLICT) while the team is stopped, while the task already runs (or has a session open), is in review or
     * done, waits on an unfinished dependency, or when its agent is paused, released or at its wage cap, or the business's
     * monthly model budget is used up: a start never wakes a paused agent, so it cannot undo Stop all agents.
     * Refused with `tier_limit` (the web's upgrade prompt) when every concurrent agent the plan holds is already working.
     * The task is claimed with one conditional update, so a double click starts one session; when the workflow cannot
     * be queued the claim is undone and the session row closed (SERVICE_UNAVAILABLE), so a retry is not refused.
     */
    start: write.input(z.object({ taskId: Id })).use(modelLimited("session")).mutation(({ ctx, input }) => startTaskByHand(ctx, input.taskId)),

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
      // The nudge the session records, in the words the tile's control uses (UX plan §7.12: never the model's name).
      const workflow = await signalTask(ctx, task, SIGNALS.shout, { message: "Use the strongest model", modelKey: "opus", by: ctx.userId });
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
        const session = await readableSession(tx, ctx, input.sessionId);
        return { session, channel: sessionStreamKey(session.id), live: session.endedAt === null };
      }),
    ),
    /** The recorded events of a session (its saved recording once it finished, its `as:{sessionId}` stream while it runs, or the mock recording it was played from) plus where live frames arrive. */
    replay: read.input(z.object({ sessionId: Id, limit: z.number().int().min(1).max(5000).optional(), after: z.string().max(64).optional(), kinds: z.array(z.enum(SESSION_EVENT_KINDS)).max(SESSION_EVENT_KINDS.length).optional() })).query(async ({ ctx, input }) => {
      const session = await ctx.rls((tx) => readableSession(tx, ctx, input.sessionId));
      const replay = await replaySession({ redis: ctx.redis, recordings: ctx.recordings, saved: () => ctx.rls((tx) => repos.recordings.get(tx, ctx.businessId, session.id)) }, session, { limit: input.limit, after: input.after, kinds: input.kinds });
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

    /**
     * Choose the repository saved code is pushed to (`owner/name` or a github.com URL), or stop pushing with null. The
     * installation must reach it and it must be private; GitHub's id of it is pinned with the choice.
     */
    setRepository: sectionAdmin("development")
      // Pushing is off unless the founder turns it on: a push runs the repository's CI and preview deploys on agent code.
      .input(z.object({ repository: z.string().trim().max(300).nullable(), pushEnabled: z.boolean().default(false) }))
      .mutation(async ({ ctx, input }) => {
        const typed = input.repository ? input.repository.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "") : null;
        // A repository is checked with GitHub before it is stored (security review B1): the installation must reach it, it
        // must be private, and its id is pinned with the choice. Shape and connection are checked first, so nothing is asked
        // of GitHub for a name that could never be stored.
        let verified: { fullName: string; repoId: number } | null = null;
        if (typed) {
          if (!REPOSITORY_FULL_NAME.test(typed)) throw new ValidationError("repository must be owner/name");
          const integration = await ctx.rls((tx) => repos.integrations.getByKey(tx, ctx.businessId, "github"));
          if (!integration || integration.archivedAt || integration.status === "disconnected") throw new ValidationError("connect GitHub before choosing a repository");
          const repository = await verifyCodeRepository({ env: ctx.env, connectors: ctx.connectors, gateway: ctx.gateway }, ctx.businessId, integration, typed);
          // GitHub's own spelling of the name (a renamed repository answers under its new one).
          verified = { fullName: REPOSITORY_FULL_NAME.test(repository.fullName) ? repository.fullName : typed, repoId: repository.id };
        }
        return ctx.rls(async (tx) => {
          const fullName = verified?.fullName ?? null;
          const row = await repos.integrations.setCodeRepository(tx, ctx.businessId, fullName, { pushEnabled: input.pushEnabled, repoId: verified?.repoId ?? null });
          await audit(tx, ctx, { action: "dev.code.set_repository", target: { kind: "integration", id: row.id }, details: { repository: fullName, repoId: verified?.repoId ?? null, pushEnabled: Boolean(fullName) && input.pushEnabled } });
          return { repository: codeRepositoryOf(row) };
        });
      }),

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
    /**
     * Pull requests are code tasks only (a finance or specialist task in review has no branch): open = code tasks in
     * review or the merge queue; merged = the `pr.merged` events GitHub reports, plus every done code task the platform's
     * own merge queue landed (no event: in mock mode and with pushing off nothing reaches GitHub), one row per task with
     * GitHub's event winning, newest first. So the table agrees with Environments and Home, which count done code tasks.
     */
    list: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [tasks, events, completed] = await Promise.all([repos.tasks.list(tx, ctx.businessId, { kind: "code", status: ["review", "merging", "done"], limit: 200 }), repos.events.list(tx, ctx.businessId, { type: "pr.merged", limit: 200 }), repos.events.list(tx, ctx.businessId, { type: "task.completed", limit: 200 })]);
        // A task's latest completion (newest first) says whether its work was saved with nowhere to push (WP-05 T8).
        const landedOf = new Map<string, unknown>();
        for (const e of completed.items) {
          const p = e.payload as { taskId?: unknown; landed?: unknown };
          if (typeof p.taskId === "string" && !landedOf.has(p.taskId)) landedOf.set(p.taskId, p.landed ?? null);
        }
        // Each merged row carries its task's founder title and agent (Builder view off reads "Gone live: <founder title>").
        const byTask = new Map(tasks.items.map((t) => [t.id, t]));
        const fromGitHub: MergedPr[] = events.items.map((e) => {
          const payload = e.payload as Record<string, unknown>;
          const task = typeof payload.taskId === "string" ? byTask.get(payload.taskId) : undefined;
          return { ...payload, founderTitle: task?.founderTitle ?? null, agentId: task?.assigneeAgentId ?? null, eventId: e.id, occurredAt: e.occurredAt, source: "github" as const };
        });
        const reported = new Set(fromGitHub.map((m) => m.taskId).filter((id): id is string => typeof id === "string"));
        const fromQueue: MergedPr[] = tasks.items
          .filter((t) => t.status === "done" && !reported.has(t.id))
          .map((t) => ({ eventId: null, occurredAt: t.endedAt ?? t.updatedAt, source: "merge_queue" as const, taskId: t.id, title: t.title, founderTitle: t.founderTitle, agentId: t.assigneeAgentId, branch: agentBranch(t.id), mergedBy: t.assigneeAgentId ? { kind: "agent", id: t.assigneeAgentId } : { kind: "system", id: null }, landed: landedOf.get(t.id) === "saved_only" ? ("saved_only" as const) : null }));
        return {
          open: tasks.items.filter((t) => t.status !== "done").map((t) => ({ taskId: t.id, title: t.title, founderTitle: t.founderTitle, status: t.status, kind: t.kind, branch: agentBranch(t.id), agentId: t.assigneeAgentId })),
          merged: [...fromGitHub, ...fromQueue].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
        };
      }),
    ),
  }),

  deployments: router({
    /**
     * The business's recent deployments, newest first, from its `deploy.succeeded` events (there is no deployment table,
     * BUILD §8.3): what Development › Live product reads after a reload, so "Your live product" and its previews do not
     * wait for the next live event. Each row carries its task's founder title when the deployment belongs to a task.
     */
    list: read.input(z.object({ limit: z.number().int().min(1).max(200).optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const events = await repos.events.list(tx, ctx.businessId, { type: "deploy.succeeded", limit: input.limit ?? 100 });
        const taskIds = [...new Set(events.items.map((e) => (e.payload as { taskId?: unknown }).taskId).filter((id): id is string => typeof id === "string"))];
        const tasks = taskIds.length ? await repos.tasks.list(tx, ctx.businessId, { kind: "code", limit: 500 }) : { items: [] as Task[] };
        const byTask = new Map(tasks.items.map((t) => [t.id, t]));
        return {
          items: events.items.map((e) => {
            const p = e.payload as { taskId?: string | null; environment: "preview" | "staging" | "production"; provider: string; url: string | null; commitSha: string; branch?: string | null };
            const task = p.taskId ? byTask.get(p.taskId) : undefined;
            return { eventId: e.id, occurredAt: e.occurredAt, taskId: p.taskId ?? null, environment: p.environment, provider: p.provider, url: p.url ?? null, commitSha: p.commitSha, branch: p.branch ?? null, title: task?.title ?? null, founderTitle: task?.founderTitle ?? null };
          }),
        };
      }),
    ),
  }),
});
