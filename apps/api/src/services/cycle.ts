/**
 * Business cycles (BUILD §9.4 "one press of Continue"; §5.4 Continue states).
 *
 * `cycleStatus` derives the current cycle from the event log (`cycle.started` / `cycle.completed`), the audit rows that
 * queued it, the running tasks and the pause/resume audit trail, so the shell no longer has to guess from task statuses.
 * A cycle exists from the press of Continue (queued, then planning), not only from `cycle.started`: a second press, a
 * second person and Pause all find it (audit SOAK-05, RUI-15). `startCycle` starts (or
 * resumes) the `businessCycle` workflow on Temporal when it is reachable; otherwise it runs one in-process cycle step:
 * it records `cycle.started`, promotes the dispatchable tasks to ready, narrates one new Inbox item through the
 * composer (service or in-process fallback) and records `cycle.completed`, so the loop moves on a laptop with no
 * worker. `pauseCycle` / `resumeCycle` signal the workflow and mirror the intent on the local task state.
 *
 * Continue runs until done (founder, Nov 7, 2026): with Temporal, a press no longer starts `businessCycle` itself. It
 * signals `continueRun` to the business's `autopilot:<businessId>` workflow (signal-with-start, so it runs with
 * Autopilot off too), which starts the press's cycle with the number reserved here and then round after round until
 * nothing is left the team can do, a hard stop, a vacation, Pause, or the day's cycle cap and spend ceiling from
 * Settings › What the team can do end the run. The run lives in the event log (`cycle.run_started` / `cycle.run_ended`, no table):
 * `cycleStatus` reads it as `run`, and Continue shows processing for as long as it lasts, the gap between rounds
 * included. Pause ends the run (and pauses the round in progress); the next press starts a new one. Without Temporal
 * the in-process step is unchanged: one step, no run.
 */
import { CREDITS_CURRENCY, LIMITS, TIERS } from "@foundmill/config";
import { openRunOf, repos, runRoundsOf, type Executor, type InboxItem } from "@foundmill/db";
import { AppError, vacationUntilLabel, type ContinueRunEndReason } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { redispatchPlans } from "./plans";
import { assertAgentsRunning } from "./stop-guard";
import { SIGNALS, WORKFLOWS, workflowIds, type TemporalResult } from "./temporal";

export const CYCLE_OUTCOMES = ["completed", "time_box", "waiting", "stopped", "failed"] as const;

/** The subject of the note for a round of work that stopped unfinished (the orchestrator's `CYCLE_NOT_FINISHED_SUBJECT`). */
export const CYCLE_NOT_FINISHED_SUBJECT = "The team's last round of work did not finish";
export type CycleOutcome = (typeof CYCLE_OUTCOMES)[number];

export interface CycleStatus {
  running: boolean;
  /** The workflow exists but has not written `cycle.started` yet (waiting for the orchestrator, or planning). */
  queued: boolean;
  paused: boolean;
  cycleId: string | null;
  cycleNumber: number | null;
  workflowId: string | null;
  startedAt: string | null;
  trigger: string | null;
  /** Departments with an agent working a running task. */
  activeDepartmentIds: string[];
  /** Agents with a running task. */
  activeAgentIds: string[];
  activeTaskIds: string[];
  plannedTaskIds: string[];
  /** The tasks the cycle's pause paused (resume puts back exactly these). */
  pausedTaskIds: string[];
  completedCount: number;
  lastCompletedAt: string | null;
  lastOutcome: CycleOutcome | null;
  /** When the last cycle ended `failed`: what stopped it (Home shows it as a banner until a cycle runs again). */
  lastFailure: { kind: "billing" | "credential" | "request" | "error"; message: string; at: string } | null;
  nextCycleNumber: number;
  /** "temporal" when the current cycle runs on the orchestrator, "local" when it was an in-process step. */
  mode: "temporal" | "local" | null;
  /**
   * The run one press of Continue started, while it lasts (rounds start on their own until it ends); null when none is
   * open. `rounds`: the rounds of the run that finished.
   */
  run: CycleRun | null;
}

export interface CycleRun {
  id: string;
  startedAt: string;
  rounds: number;
}

/** `processing.run`: a run is open, so new cycles start on their own (the button keeps Pause between rounds too). */
export type ContinueState = { kind: "idle" } | { kind: "blocked"; count: number } | { kind: "matchday"; journeyId: string | null; itemId: string } | { kind: "processing"; run?: boolean } | { kind: "holiday"; until: string | null; untilLabel: string | null };

export const PAUSE_ACTION = "business.pause_cycle";
export const RESUME_ACTION = "business.resume_cycle";
/** Audit actions that record a cycle workflow being started on Temporal: the founder's press, and the first cycle at Commit. */
export const CONTINUE_ACTION = "business.continue";
export const QUEUE_ACTION = "cycle.queue";
/** A run started for a cycle already open (a resume, a press while one runs) and a run's end written here. */
export const RUN_START_ACTION = "cycle.run_start";
export const RUN_END_ACTION = "cycle.run_end";
/** One `cycle.run_ended` per run, whoever writes it (the orchestrator's `autopilotRunEnded` uses the same key). */
export const runEndedKey = (runId: string) => `cycle.run_ended:${runId}`;
/** A queued cycle that never wrote `cycle.started` stops counting after this long (the reconciler asks Temporal first). */
const QUEUED_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Read the business's cycle state. Pure over repositories; safe on the service db or inside an RLS transaction. */
export interface CycleScope {
  db: Executor;
  businessId: string;
  /** Who is asking: a win waits for *their* Customer Update until they have opened it (per-person reads, 0048). */
  userId?: string;
}

export async function cycleStatus(ctx: CycleScope): Promise<CycleStatus> {
  const { db, businessId } = ctx;
  const [events, running, agents, pauses, queues] = await Promise.all([
    repos.events.list(db, businessId, { type: ["cycle.started", "cycle.completed", "cycle.run_started", "cycle.run_ended"], limit: 500 }),
    repos.tasks.list(db, businessId, { status: "running", limit: 500 }),
    repos.agents.list(db, businessId, { limit: 500 }),
    repos.audit.list(db, businessId, { action: [PAUSE_ACTION, RESUME_ACTION], limit: 1 }),
    repos.audit.list(db, businessId, { action: [CONTINUE_ACTION, QUEUE_ACTION], limit: 8 }),
  ]);
  // Newest first.
  const started = events.items.filter((e) => e.type === "cycle.started");
  const completed = events.items.filter((e) => e.type === "cycle.completed");
  const completedIds = new Set(completed.map((e) => str(asRecord(e.payload).cycleId)));
  const latestStart = started[0] ?? null;
  const latestStartPayload = asRecord(latestStart?.payload);
  const startedOpen = latestStart !== null && !completedIds.has(str(latestStartPayload.cycleId));
  const lastDone = completed[0] ?? null;
  const lastDonePayload = asRecord(lastDone?.payload);

  // A cycle the API started on Temporal whose workflow has written neither `cycle.started` nor `cycle.completed` yet.
  const seenWorkflows = new Set([...started, ...completed].map((e) => str(asRecord(e.payload).workflowId)));
  const queuedEntries = queues.items.filter((q) => asRecord(q.details).mode !== "local" && str(asRecord(q.details).workflowId) !== null);
  const queuedEntry = startedOpen ? null : (queuedEntries.find((q) => !seenWorkflows.has(str(asRecord(q.details).workflowId)) && Date.now() - q.createdAt.getTime() < QUEUED_MAX_AGE_MS) ?? null);
  const queuedDetails = asRecord(queuedEntry?.details);
  const open = startedOpen || queuedEntry !== null;
  const openSince = startedOpen ? (latestStart?.occurredAt ?? null) : (queuedEntry?.createdAt ?? null);

  const pauseEntry = pauses.items[0] ?? null;
  const paused = open && pauseEntry !== null && pauseEntry.action === PAUSE_ACTION && openSince !== null && pauseEntry.createdAt >= openSince;
  const pausedTaskIds = paused && Array.isArray(asRecord(pauseEntry?.details).pausedTaskIds) ? (asRecord(pauseEntry?.details).pausedTaskIds as unknown[]).filter((id): id is string => typeof id === "string") : [];

  const deptOf = new Map(agents.items.map((a) => [a.id, a.departmentIds]));
  const activeAgentIds = [...new Set(running.items.map((t) => t.assigneeAgentId).filter((id): id is string => Boolean(id)))];
  const activeDepartmentIds = [...new Set([...running.items.map((t) => t.departmentId).filter((id): id is string => Boolean(id)), ...activeAgentIds.flatMap((id) => deptOf.get(id) ?? [])])];

  // Every cycle number in use, a queued or failed-before-start one included: the next press never reuses a workflow id.
  const numbers = [...started, ...completed].map((e) => num(asRecord(e.payload).cycleNumber) ?? 0);
  for (const q of queuedEntries) numbers.push(num(asRecord(q.details).cycleNumber) ?? 0);
  const maxNumber = numbers.reduce((m, n) => Math.max(m, n), 0);
  const workflowId = startedOpen ? str(latestStartPayload.workflowId) : str(queuedDetails.workflowId);
  const openRun = openRunOf(events.items, Date.now());
  const run: CycleRun | null = openRun ? { id: openRun.runId, startedAt: new Date(openRun.startedAt).toISOString(), rounds: runRoundsOf(completed, openRun.startedAt).rounds } : null;
  return {
    running: open,
    queued: queuedEntry !== null,
    paused,
    cycleId: startedOpen ? str(latestStartPayload.cycleId) : null,
    cycleNumber: startedOpen ? num(latestStartPayload.cycleNumber) : queuedEntry ? num(queuedDetails.cycleNumber) : null,
    workflowId: open ? workflowId : null,
    startedAt: startedOpen && latestStart ? latestStart.occurredAt.toISOString() : queuedEntry ? queuedEntry.createdAt.toISOString() : null,
    trigger: startedOpen ? str(latestStartPayload.trigger) : queuedEntry ? (str(queuedDetails.trigger) ?? "continue") : null,
    activeDepartmentIds,
    activeAgentIds,
    activeTaskIds: running.items.map((t) => t.id),
    plannedTaskIds: startedOpen ? ((latestStartPayload.plannedTaskIds as string[] | undefined) ?? []) : [],
    pausedTaskIds,
    completedCount: completed.length,
    lastCompletedAt: lastDone ? lastDone.occurredAt.toISOString() : null,
    lastOutcome: (CYCLE_OUTCOMES as readonly string[]).includes(str(lastDonePayload.outcome) ?? "") ? (str(lastDonePayload.outcome) as CycleOutcome) : null,
    lastFailure: lastDone && str(lastDonePayload.outcome) === "failed" ? failureOf(lastDonePayload.failure, lastDone.occurredAt) : null,
    nextCycleNumber: maxNumber + 1,
    mode: startedOpen ? (latestStart?.actor.kind === "system" && latestStart.actor.id === LOCAL_ACTOR_ID ? "local" : "temporal") : queuedEntry ? "temporal" : null,
    run,
  };
}

const FAILURE_KINDS = new Set(["billing", "credential", "request", "error"]);
/** The failed cycle's `failure` as the status carries it; a cycle recorded before the field existed says so in general words. */
export function failureOf(raw: unknown, at: Date): CycleStatus["lastFailure"] {
  const f = asRecord(raw);
  const kind = str(f.kind);
  const message = str(f.message);
  if (kind && FAILURE_KINDS.has(kind) && message) return { kind: kind as "billing" | "credential" | "request" | "error", message, at: at.toISOString() };
  return { kind: "error", message: "The last round of work could not start. Press Continue to try again.", at: at.toISOString() };
}

/**
 * What a vacation lasts until, as words that follow "until" ("you return", "MRR hits 10k"): the button and the top bar
 * put "until" in front, so a stored "until I return" or a typed "until the launch ships" must not say it twice.
 */
export function untilWords(text: string | null | undefined): string {
  const t = (text ?? "").trim().replace(/^until\s+/i, "");
  return !t || /^i return$/i.test(t) ? "you return" : t;
}

/**
 * The Continue button state (BUILD §5.4, AC-11.3.3): holiday › a hard stop › processing › idle. Since Nov 7, 2026 a won
 * customer no longer turns the button into "Go to Journey" (the win is good news in the Inbox, never the main control's
 * state), and only a hard stop counts as blocking (0071).
 * `status` is the cycle status when the caller has it, or is reading it (a promise: its reads then go out with these).
 */
export async function continueStateFor(ctx: CycleScope, status?: CycleStatus | Promise<CycleStatus>): Promise<ContinueState> {
  const { db, businessId } = ctx;
  const [holiday, blocking] = await Promise.all([repos.holidays.current(db, businessId), repos.inbox.countBlocking(db, businessId)]);
  if (holiday) {
    const condition = holiday.untilCondition as { text?: string } | null;
    return { kind: "holiday", until: holiday.untilAt ? holiday.untilAt.toISOString() : null, untilLabel: holiday.untilAt ? null : vacationUntilLabel(condition?.text) };
  }
  if (blocking > 0) return { kind: "blocked", count: blocking };
  return cycleContinueState(await (status ?? cycleStatus(ctx)));
}

/**
 * What Continue shows when nothing comes before the cycle: processing while one runs and is not paused, or while a run
 * is open (between its rounds too); a paused cycle shows Continue (it resumes), else idle.
 */
export function cycleContinueState(s: CycleStatus): ContinueState {
  if (s.running && s.paused) return { kind: "idle" };
  if (s.run) return { kind: "processing", run: true };
  return s.running ? { kind: "processing" } : { kind: "idle" };
}

/** Actor id of in-process cycle steps (distinguishes them from orchestrator-run cycles in the event log). */
export const LOCAL_ACTOR_ID = "api-local-cycle";
const LOCAL_ACTOR = { kind: "system" as const, id: LOCAL_ACTOR_ID };

export interface StartCycleResult {
  action: "started" | "resumed" | "already_running";
  mode: "temporal" | "local";
  workflow: TemporalResult | null;
  /** The Inbox item the in-process step narrated (local mode only). */
  item: InboxItem | null;
  status: CycleStatus;
  continueState: ContinueState;
  /** The run this press started (Temporal only): rounds now start on their own until it ends. Null: none started. */
  run: CycleRun | null;
}

export class ContinueBlockedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("continue_blocked", message, 409, details);
  }
}

/**
 * One press of Continue. Refuses while the team is stopped (Stop all agents, a revoked key, used-up credits: no cycle,
 * and no Chief of Staff plan to pay for, until an owner or admin resumes it), blocked or on vacation; resumes a paused
 * cycle; otherwise starts the next one. A cycle that is already queued or planning answers `already_running` (no second
 * start, no second audit row), and one whose workflow is gone is closed first so it cannot hold Continue for good.
 *
 * With Temporal every press also starts a run (Nov 7, 2026): the next cycle and the rounds after it are the `autopilot`
 * workflow's to start, until the run ends. A resume and a press while a cycle runs start a run that picks up after that
 * cycle (none when one is open already). Without Temporal one in-process step runs, as before, and no run starts.
 */
export async function startCycle(ctx: BusinessContext): Promise<StartCycleResult> {
  // The stop, the Continue state and the cycle status are read at once (one wave of independent reads; until 2026-10-15
  // the status was read three times, one after another). A stopped team is still refused first.
  const first = cycleStatus(ctx);
  const [stop, ready] = await Promise.allSettled([assertAgentsRunning(ctx, "the next cycle"), Promise.all([continueStateFor(ctx, first), first])]);
  if (stop.status === "rejected") throw stop.reason;
  if (ready.status === "rejected") throw ready.reason;
  const [before, read] = ready.value;
  if (before.kind === "holiday") throw new ContinueBlockedError("The Chief of Staff is running the business while you are away. End the vacation to take over.", { continueState: before });
  if (before.kind === "blocked") throw new ContinueBlockedError(`${before.count} thing${before.count === 1 ? " needs" : "s need"} you before the team can work: open the Inbox's Needs you tab.`, { continueState: before });
  // Neither a vacation nor a hard stop comes after this point: the cycle's own state.
  const continueStateAfter = (s: CycleStatus): ContinueState => cycleContinueState(s);

  // Plans an earlier decision could not hand to the orchestrator start now that the founder moves on (audit api-services-15).
  await redispatchPlans(ctx).catch((err: unknown) => ctx.log.warn({ err: (err as Error).message }, "plan redispatch failed"));

  const status = await reconcileCycle(ctx, read);
  if (status.running && status.paused) {
    const result = await resumeCycle(ctx, status);
    // Pause ended the run; pressing Continue resumes the cycle and starts a new run that goes on after it.
    const run = status.mode === "local" ? null : await startRunAfterOpenCycle(ctx, result.status);
    const after: CycleStatus = run ? { ...result.status, run } : result.status;
    return { action: "resumed", mode: status.mode ?? "temporal", workflow: result.workflow, item: null, status: after, continueState: continueStateAfter(after), run };
  }
  if (status.running) {
    // A second press, a second person, or a cycle Autopilot started: keep going after it.
    const run = status.mode === "local" || status.run ? null : await startRunAfterOpenCycle(ctx, status);
    const after: CycleStatus = run ? { ...status, run } : status;
    return { action: "already_running", mode: status.mode ?? "temporal", workflow: null, item: null, status: after, continueState: continueStateAfter(after), run };
  }

  const cycleNumber = status.nextCycleNumber;
  const workflowId = workflowIds.cycle(ctx.businessId, cycleNumber);
  const runId = crypto.randomUUID();
  // The run's first round is this press's cycle: the workflow starts it at once with the number reserved here.
  const workflow = await ctx.temporal.signalWithStart(WORKFLOWS.autopilot, { workflowId: workflowIds.autopilot(ctx.businessId), args: [{ businessId: ctx.businessId }], signal: SIGNALS.continueRun, signalArgs: [{ runId, cycleNumber, by: ctx.userId }] });
  if (workflow.queued) {
    const mark = await ctx.rls(async (tx) => {
      const row = await audit(tx, ctx, { action: CONTINUE_ACTION, target: { kind: "cycle", id: workflowId }, details: { cycleNumber, mode: "temporal", workflowId, trigger: "continue", runId, runWorkflowId: workflow.workflowId } });
      await emit(tx, ctx, { type: "cycle.run_started", occurredAt: row.createdAt, payload: { runId, firstCycleNumber: cycleNumber } });
      return row;
    });
    // The audit row is the cycle's first mark: status reads it as queued until the orchestrator writes `cycle.started`.
    // What that read would say is known without asking again (the stream brings the orchestrator's own marks).
    const run: CycleRun = { id: runId, startedAt: mark.createdAt.toISOString(), rounds: 0 };
    return { action: "started", mode: "temporal", workflow: { ...workflow, workflowId }, item: null, status: { ...queuedStatus(status, { cycleNumber, workflowId, queuedAt: mark.createdAt }), run }, continueState: { kind: "processing", run: true }, run };
  }
  const local = await runLocalCycleStep(ctx, cycleNumber, workflow.reason ?? "temporal unreachable");
  return { action: "started", mode: "local", workflow: { ...workflow, workflowId }, item: local.item, status: local.status, continueState: await continueStateFor(ctx, local.status), run: null };
}

/**
 * A run that picks up after the cycle that is open now (a resumed one, or one already running): no cycle number is
 * reserved, the workflow waits for that cycle and decides from how it ended. Null when Temporal cannot be reached.
 */
async function startRunAfterOpenCycle(ctx: BusinessContext, status: CycleStatus): Promise<CycleRun | null> {
  const runId = crypto.randomUUID();
  const workflow = await ctx.temporal.signalWithStart(WORKFLOWS.autopilot, { workflowId: workflowIds.autopilot(ctx.businessId), args: [{ businessId: ctx.businessId }], signal: SIGNALS.continueRun, signalArgs: [{ runId, cycleNumber: null, by: ctx.userId }] });
  if (!workflow.queued) return null;
  const at = await ctx.rls(async (tx) => {
    const row = await audit(tx, ctx, { action: RUN_START_ACTION, target: { kind: "business", id: ctx.businessId }, details: { runId, afterCycleNumber: status.cycleNumber, workflowId: workflow.workflowId } });
    await emit(tx, ctx, { type: "cycle.run_started", occurredAt: row.createdAt, payload: { runId, firstCycleNumber: null } });
    return row.createdAt;
  });
  return { id: runId, startedAt: at.toISOString(), rounds: 0 };
}

/**
 * Record the end of the open run here (Pause, Stop all agents, a lost workflow), once: the orchestrator's own end of the
 * same run finds it written and writes nothing. `signal`: also tell the workflow (Pause), so the round in progress is
 * the last one.
 */
export async function endRun(ctx: BusinessContext, run: CycleRun, reason: ContinueRunEndReason, options: { signal?: boolean; actor?: { kind: "system"; id: string } } = {}): Promise<TemporalResult | null> {
  const workflow = options.signal ? await ctx.temporal.signal(workflowIds.autopilot(ctx.businessId), SIGNALS.continueRunEnd, { reason, runId: run.id, by: ctx.userId }) : null;
  const done = await repos.events.list(ctx.db, ctx.businessId, { type: "cycle.completed", limit: 200 });
  const rounds = runRoundsOf(done.items, Date.parse(run.startedAt));
  await ctx.rls(async (tx) => {
    if (await repos.events.byIdempotencyKey(tx, ctx.businessId, runEndedKey(run.id))) return;
    await emit(tx, ctx, { type: "cycle.run_ended", ...(options.actor ? { actor: options.actor } : {}), idempotencyKey: runEndedKey(run.id), payload: { runId: run.id, reason, rounds: rounds.rounds, cost: rounds.cost } });
    await audit(tx, ctx, { action: RUN_END_ACTION, target: { kind: "business", id: ctx.businessId }, details: { runId: run.id, reason, rounds: rounds.rounds, signaled: workflow?.queued ?? false } });
  });
  return workflow;
}

/**
 * The status `cycleStatus` reads right after a Continue press queued cycle `cycleNumber` (its audit row written at
 * `queuedAt`), given the status read before it: open and queued, numbered, nothing planned or paused yet.
 */
export function queuedStatus(before: CycleStatus, queued: { cycleNumber: number; workflowId: string; queuedAt: Date }): CycleStatus {
  return {
    ...before,
    running: true,
    queued: true,
    paused: false,
    cycleId: null,
    cycleNumber: queued.cycleNumber,
    workflowId: queued.workflowId,
    startedAt: queued.queuedAt.toISOString(),
    trigger: "continue",
    plannedTaskIds: [],
    pausedTaskIds: [],
    nextCycleNumber: Math.max(before.nextCycleNumber, queued.cycleNumber + 1),
    mode: "temporal",
  };
}

const reconciledAt = new Map<string, number>();
/** A cycle younger than this is given time to start; older ones are checked against Temporal (at most every 30 s per workflow). */
const RECONCILE_AFTER_MS = 90_000;
const RECONCILE_EVERY_MS = 30_000;

/**
 * Close a cycle whose workflow no longer exists or has ended without writing `cycle.completed` (a terminated workflow,
 * a worker that lost it, a failure before the orchestrator's own failure path ran). Without this the cycle reads as
 * running for good and Continue stays on "processing" (audit O-07). Asks Temporal only for a cycle that has been open
 * for a while; does nothing when Temporal cannot be reached, so an outage never closes a cycle that is still running.
 */
export async function reconcileCycle(ctx: BusinessContext, known?: CycleStatus): Promise<CycleStatus> {
  const s = await reconcileRun(ctx, known ?? (await cycleStatus(ctx)));
  if (!s.running || s.mode !== "temporal" || !s.workflowId || !s.startedAt) return s;
  const now = Date.now();
  if (now - Date.parse(s.startedAt) < RECONCILE_AFTER_MS) return s;
  const key = `${ctx.businessId}:${s.workflowId}`;
  if (now - (reconciledAt.get(key) ?? 0) < RECONCILE_EVERY_MS) return s;
  reconciledAt.set(key, now);
  const state = await ctx.temporal.describe(s.workflowId);
  if (!state.reachable || state.running) return s;
  // Re-read: the workflow may have finished normally between the first read and the question.
  const fresh = await cycleStatus(ctx);
  if (!fresh.running || fresh.workflowId !== s.workflowId) return fresh;
  const cycleId = fresh.cycleId ?? crypto.randomUUID();
  const cycleNumber = fresh.cycleNumber ?? 1;
  // Founder words (Nov 8, 2026: Builder view): the note is stored once and read by everyone, so it names no cycle number;
  // the workflow's own status stays in the audit and the event (apps/orchestrator cycle-contract CYCLE_NOT_FINISHED_SUBJECT).
  const reason = state.found ? `it ended (${(state.status ?? "stopped").toLowerCase().replace(/_/g, " ")}) before the work was done` : "the system that runs the team lost track of it";
  const chief = await repos.agents.chiefOfStaff(ctx.db, ctx.businessId);
  await ctx.rls(async (tx) => {
    const item = chief
      ? await repos.inbox.createItem(tx, ctx.businessId, {
          type: "warning",
          from_agent_id: chief.id,
          subject: CYCLE_NOT_FINISHED_SUBJECT,
          body_md: `The round of work stopped before it finished: ${reason}. Open work is still on the board. Press Continue to start the next round.`,
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: null,
          blocks_continue: false,
          source_event_ids: [],
          entity_ids: [],
        })
      : null;
    await emit(tx, ctx, {
      type: "cycle.completed",
      actor: { kind: "system", id: "api-cycle-reconciler" },
      idempotencyKey: `cycle.completed:${cycleId}`,
      payload: { cycleId, cycleNumber, workflowId: s.workflowId!, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, cost: { amountMinor: 0, currency: CREDITS_CURRENCY }, inboxItemIds: item ? [item.id] : [], durationMs: Math.max(0, now - Date.parse(s.startedAt!)) },
    });
    await audit(tx, ctx, { action: "cycle.reconcile", target: { kind: "cycle", id: cycleId }, details: { workflowId: s.workflowId, cycleNumber, temporalStatus: state.status, reason } });
  });
  return cycleStatus(ctx);
}

/**
 * Close a run whose `autopilot:<businessId>` workflow is gone (terminated, lost by a worker): it ends `lost`, so Continue
 * is not stuck on "processing" between rounds. Like the cycle check: only a run open for a while, at most every 30 s,
 * and nothing when Temporal cannot be reached. Returns `s` itself when nothing changed.
 */
async function reconcileRun(ctx: BusinessContext, s: CycleStatus): Promise<CycleStatus> {
  const run = s.run;
  if (!run) return s;
  const now = Date.now();
  if (now - Date.parse(run.startedAt) < RECONCILE_AFTER_MS) return s;
  const workflowId = workflowIds.autopilot(ctx.businessId);
  const key = `${ctx.businessId}:${workflowId}:${run.id}`;
  if (now - (reconciledAt.get(key) ?? 0) < RECONCILE_EVERY_MS) return s;
  reconciledAt.set(key, now);
  const state = await ctx.temporal.describe(workflowId);
  if (!state.reachable || state.running) return s;
  const fresh = await cycleStatus(ctx);
  if (fresh.run?.id !== run.id) return fresh;
  await endRun(ctx, run, "lost", { actor: { kind: "system", id: "api-cycle-reconciler" } });
  return cycleStatus(ctx);
}

/**
 * In-process cycle step (no orchestrator): `cycle.started` → dispatchable tasks become ready → the composer narrates
 * exactly one new item → `cycle.completed`. Nothing here runs an agent; the step is honest about that in the audit row.
 */
export async function runLocalCycleStep(ctx: BusinessContext, cycleNumber: number, reason: string): Promise<{ item: InboxItem; status: CycleStatus; cycleId: string }> {
  const startedAt = Date.now();
  const cycleId = crypto.randomUUID();
  const workflowId = workflowIds.cycle(ctx.businessId, cycleNumber);
  const dispatchable = await repos.tasks.dispatchable(ctx.db, ctx.businessId, TIERS[ctx.business.planTier].maxConcurrentAgents);
  await ctx.rls(async (tx) => {
    await emit(tx, ctx, {
      type: "cycle.started",
      actor: LOCAL_ACTOR,
      payload: { cycleId, cycleNumber, workflowId, trigger: "continue", timeBoxAgentHours: LIMITS.cycleTimeBoxAgentHours, plannedTaskIds: dispatchable.map((t) => t.id), budget: null },
    });
    for (const task of dispatchable) if (task.status === "planned") await repos.tasks.setStatus(tx, ctx.businessId, task.id, "ready");
  });

  let item: InboxItem;
  try {
    item = (await ctx.composer.refresh(ctx.businessId, { actorUserId: ctx.userId })).item;
  } catch (err) {
    await ctx.rls((tx) =>
      emit(tx, ctx, {
        type: "cycle.completed",
        actor: LOCAL_ACTOR,
        payload: { cycleId, cycleNumber, workflowId, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, cost: { amountMinor: 0, currency: CREDITS_CURRENCY }, inboxItemIds: [], durationMs: Date.now() - startedAt },
      }),
    );
    throw err;
  }

  await ctx.rls(async (tx) => {
    await emit(tx, ctx, {
      type: "cycle.completed",
      actor: LOCAL_ACTOR,
      payload: {
        cycleId,
        cycleNumber,
        workflowId,
        outcome: "completed",
        tasksDispatched: 0,
        tasksCompleted: 0,
        tasksBlocked: 0,
        agentHours: 0,
        cost: { amountMinor: item.costMinor, currency: item.currency },
        inboxItemIds: [item.id],
        durationMs: Date.now() - startedAt,
      },
    });
    await audit(tx, ctx, {
      action: CONTINUE_ACTION,
      target: { kind: "cycle", id: cycleId },
      details: { cycleNumber, mode: "local", workflowId, reason, readyTasks: dispatchable.length, inboxItemId: item.id, note: "No orchestrator reachable: one in-process cycle step ran (no agent sessions were started)." },
    });
  });
  return { item, status: await cycleStatus(ctx), cycleId };
}

export interface PauseResult {
  paused: boolean;
  workflow: TemporalResult | null;
  pausedTasks: number;
  reason?: string;
  status: CycleStatus;
  /** The open run ended with this Pause: no new cycle starts on its own (Continue starts a new run). */
  runEnded: boolean;
}

/**
 * Pause the cycle (queued, planning or running): signal the workflow, which opens no new session while paused, and its
 * sessions for the tasks paused here, and mirror it on those tasks. The tasks paused are recorded, so a resume puts back
 * exactly these and leaves a task the founder paused by hand alone (audit OL-25). Pause also ends the open run (between
 * rounds that is all it does): without that, the round's time box ending would start the next round while the founder
 * is paused.
 */
export async function pauseCycle(ctx: BusinessContext, status?: CycleStatus): Promise<PauseResult> {
  const s = await reconcileCycle(ctx, status);
  const runEnded = s.run ? (await endRun(ctx, s.run, "paused", { signal: true }), true) : false;
  if (!s.running) return runEnded ? { paused: false, runEnded, workflow: null, pausedTasks: 0, reason: "no cycle is running; no new cycle starts on its own", status: await cycleStatus(ctx) } : { paused: false, runEnded, workflow: null, pausedTasks: 0, reason: "no cycle is running", status: s };
  if (s.paused) return { paused: true, runEnded, workflow: null, pausedTasks: 0, reason: "already paused", status: runEnded ? await cycleStatus(ctx) : s };
  const workflow = s.workflowId ? await ctx.temporal.signal(s.workflowId, "pause", { by: ctx.userId, taskIds: s.activeTaskIds }) : null;
  const pausedTaskIds = await ctx.rls(async (tx) => {
    const ids: string[] = [];
    for (const taskId of s.activeTaskIds) {
      await repos.tasks.setStatus(tx, ctx.businessId, taskId, "paused");
      ids.push(taskId);
    }
    await audit(tx, ctx, { action: PAUSE_ACTION, target: { kind: "cycle", id: s.cycleId ?? s.workflowId ?? "" }, details: { cycleNumber: s.cycleNumber, workflowId: s.workflowId, queued: workflow?.queued ?? false, pausedTasks: ids.length, pausedTaskIds: ids } });
    return ids;
  });
  return { paused: true, runEnded, workflow, pausedTasks: pausedTaskIds.length, status: await cycleStatus(ctx) };
}

export interface ResumeResult {
  resumed: boolean;
  workflow: TemporalResult | null;
  resumedTasks: number;
  reason?: string;
  status: CycleStatus;
}

/**
 * Resume a paused cycle: signal the workflow and put the paused tasks back to running. Refused while the team is
 * stopped: the tasks Stop all agents paused wait for the resume of the agents, not of a cycle.
 */
export async function resumeCycle(ctx: BusinessContext, status?: CycleStatus): Promise<ResumeResult> {
  await assertAgentsRunning(ctx, "the cycle");
  const s = await reconcileCycle(ctx, status);
  if (!s.running) return { resumed: false, workflow: null, resumedTasks: 0, reason: "no cycle is running", status: s };
  if (!s.paused) return { resumed: false, workflow: null, resumedTasks: 0, reason: "the cycle is not paused", status: s };
  const workflow = s.workflowId ? await ctx.temporal.signal(s.workflowId, "resume", { by: ctx.userId, taskIds: s.pausedTaskIds }) : null;
  const resumedTasks = await ctx.rls(async (tx) => {
    let n = 0;
    for (const taskId of s.pausedTaskIds) {
      const task = await repos.tasks.get(tx, ctx.businessId, taskId);
      // Only a task still paused: one the founder stopped or finished since is left as it is.
      if (task.status !== "paused") continue;
      await repos.tasks.setStatus(tx, ctx.businessId, task.id, "running");
      n++;
    }
    await audit(tx, ctx, { action: RESUME_ACTION, target: { kind: "cycle", id: s.cycleId ?? s.workflowId ?? "" }, details: { cycleNumber: s.cycleNumber, workflowId: s.workflowId, queued: workflow?.queued ?? false, resumedTasks: n } });
    return n;
  });
  return { resumed: true, workflow, resumedTasks, status: await cycleStatus(ctx) };
}
