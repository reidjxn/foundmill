/**
 * Business cycles (BUILD §9.4 "one press of Continue"; §5.4 Continue states).
 *
 * `cycleStatus` derives the current cycle from the event log (`cycle.started` / `cycle.completed`), the running tasks
 * and the pause/resume audit trail, so the shell no longer has to guess from task statuses. `startCycle` starts (or
 * resumes) the `businessCycle` workflow on Temporal when it is reachable; otherwise it runs one in-process cycle step:
 * it records `cycle.started`, promotes the dispatchable tasks to ready, narrates one new Inbox item through the
 * composer (service or in-process fallback) and records `cycle.completed`, so the loop moves on a laptop with no
 * worker. `pauseCycle` / `resumeCycle` signal the workflow and mirror the intent on the local task state.
 */
import { CREDITS_CURRENCY, LIMITS, TIERS } from "@foundmill/config";
import { repos, type Executor, type InboxItem } from "@foundmill/db";
import { AppError } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { assertAgentsRunning } from "./stop-guard";
import { WORKFLOWS, workflowIds, type TemporalResult } from "./temporal";

export const CYCLE_OUTCOMES = ["completed", "time_box", "waiting", "stopped", "failed"] as const;
export type CycleOutcome = (typeof CYCLE_OUTCOMES)[number];

export interface CycleStatus {
  running: boolean;
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
  completedCount: number;
  lastCompletedAt: string | null;
  lastOutcome: CycleOutcome | null;
  nextCycleNumber: number;
  /** "temporal" when the current cycle runs on the orchestrator, "local" when it was an in-process step. */
  mode: "temporal" | "local" | null;
}

export type ContinueState = { kind: "idle" } | { kind: "blocked"; count: number } | { kind: "matchday"; journeyId: string | null; itemId: string } | { kind: "processing" } | { kind: "holiday"; until: string | null; untilLabel: string | null };

export const PAUSE_ACTION = "business.pause_cycle";
export const RESUME_ACTION = "business.resume_cycle";

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Read the business's cycle state. Pure over repositories; safe on the service db or inside an RLS transaction. */
export interface CycleScope {
  db: Executor;
  businessId: string;
}

export async function cycleStatus(ctx: CycleScope): Promise<CycleStatus> {
  const { db, businessId } = ctx;
  const [events, running, agents, pauses] = await Promise.all([
    repos.events.list(db, businessId, { type: ["cycle.started", "cycle.completed"], limit: 500 }),
    repos.tasks.list(db, businessId, { status: "running", limit: 500 }),
    repos.agents.list(db, businessId, { limit: 500 }),
    repos.audit.list(db, businessId, { action: [PAUSE_ACTION, RESUME_ACTION], limit: 1 }),
  ]);
  // Newest first.
  const started = events.items.filter((e) => e.type === "cycle.started");
  const completed = events.items.filter((e) => e.type === "cycle.completed");
  const completedIds = new Set(completed.map((e) => str(asRecord(e.payload).cycleId)));
  const latestStart = started[0] ?? null;
  const latestStartPayload = asRecord(latestStart?.payload);
  const open = latestStart !== null && !completedIds.has(str(latestStartPayload.cycleId));
  const lastDone = completed[0] ?? null;
  const lastDonePayload = asRecord(lastDone?.payload);

  const pauseEntry = pauses.items[0] ?? null;
  const paused = open && pauseEntry !== null && pauseEntry.action === PAUSE_ACTION && latestStart !== null && pauseEntry.createdAt >= latestStart.occurredAt;

  const deptOf = new Map(agents.items.map((a) => [a.id, a.departmentIds]));
  const activeAgentIds = [...new Set(running.items.map((t) => t.assigneeAgentId).filter((id): id is string => Boolean(id)))];
  const activeDepartmentIds = [...new Set([...running.items.map((t) => t.departmentId).filter((id): id is string => Boolean(id)), ...activeAgentIds.flatMap((id) => deptOf.get(id) ?? [])])];

  const maxNumber = started.reduce((m, e) => Math.max(m, num(asRecord(e.payload).cycleNumber) ?? 0), 0);
  const workflowId = str(latestStartPayload.workflowId);
  return {
    running: open,
    paused,
    cycleId: open ? str(latestStartPayload.cycleId) : null,
    cycleNumber: open ? num(latestStartPayload.cycleNumber) : null,
    workflowId: open ? workflowId : null,
    startedAt: open && latestStart ? latestStart.occurredAt.toISOString() : null,
    trigger: open ? str(latestStartPayload.trigger) : null,
    activeDepartmentIds,
    activeAgentIds,
    activeTaskIds: running.items.map((t) => t.id),
    plannedTaskIds: open ? ((latestStartPayload.plannedTaskIds as string[] | undefined) ?? []) : [],
    completedCount: completed.length,
    lastCompletedAt: lastDone ? lastDone.occurredAt.toISOString() : null,
    lastOutcome: (CYCLE_OUTCOMES as readonly string[]).includes(str(lastDonePayload.outcome) ?? "") ? (str(lastDonePayload.outcome) as CycleOutcome) : null,
    nextCycleNumber: maxNumber + 1,
    mode: open ? (latestStart?.actor.kind === "system" && latestStart.actor.id === LOCAL_ACTOR_ID ? "local" : "temporal") : null,
  };
}

/** The Continue button state (BUILD §5.4, AC-11.3.3): holiday › blocked › win waiting for its Customer Update › processing › idle. */
export async function continueStateFor(ctx: CycleScope, status?: CycleStatus): Promise<ContinueState> {
  const { db, businessId } = ctx;
  const [holiday, blocking, wins] = await Promise.all([repos.holidays.current(db, businessId), repos.inbox.countBlocking(db, businessId), repos.inbox.list(db, businessId, { type: "customer_won", state: "unread", limit: 1 })]);
  if (holiday) {
    const condition = holiday.untilCondition as { text?: string } | null;
    return { kind: "holiday", until: holiday.untilAt ? holiday.untilAt.toISOString() : null, untilLabel: holiday.untilAt ? null : (condition?.text ?? "until I return") };
  }
  if (blocking > 0) return { kind: "blocked", count: blocking };
  const win = wins.items[0];
  if (win) {
    const journeyId = str(asRecord(asRecord(win.decision).meta).journeyId);
    return { kind: "matchday", journeyId, itemId: win.id };
  }
  const s = status ?? (await cycleStatus(ctx));
  if (s.running && !s.paused) return { kind: "processing" };
  return { kind: "idle" };
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
}

export class ContinueBlockedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("continue_blocked", message, 409, details);
  }
}

/**
 * One press of Continue. Refuses while the team is stopped (Stop all agents, a revoked key, used-up credits: no cycle,
 * and no Chief of Staff plan to pay for, until an owner or admin resumes it), blocked or on vacation; resumes a paused
 * cycle; otherwise starts the next one.
 */
export async function startCycle(ctx: BusinessContext): Promise<StartCycleResult> {
  await assertAgentsRunning(ctx, "the next cycle");
  const before = await continueStateFor(ctx);
  if (before.kind === "holiday") throw new ContinueBlockedError("The Chief of Staff is running the business while you are away. End the vacation to take over.", { continueState: before });
  if (before.kind === "blocked") throw new ContinueBlockedError(`Respond to ${before.count} item${before.count === 1 ? "" : "s"} in the Inbox before the next cycle.`, { continueState: before });

  const status = await cycleStatus(ctx);
  if (status.running && status.paused) {
    const result = await resumeCycle(ctx, status);
    return { action: "resumed", mode: status.mode ?? "temporal", workflow: result.workflow, item: null, status: result.status, continueState: await continueStateFor(ctx, result.status) };
  }
  if (status.running) return { action: "already_running", mode: status.mode ?? "temporal", workflow: null, item: null, status, continueState: await continueStateFor(ctx, status) };

  const cycleNumber = status.nextCycleNumber;
  const workflowId = workflowIds.cycle(ctx.businessId, cycleNumber);
  const workflow = await ctx.temporal.start(WORKFLOWS.businessCycle, { workflowId, args: [{ businessId: ctx.businessId, cycleNumber, trigger: "continue" }] });
  if (workflow.queued) {
    await ctx.rls((tx) => audit(tx, ctx, { action: "business.continue", target: { kind: "cycle", id: workflowId }, details: { cycleNumber, mode: "temporal", workflowId } }));
    const after = await cycleStatus(ctx);
    // The orchestrator writes `cycle.started` asynchronously; report the press as processing right away.
    const optimistic: CycleStatus = after.running ? after : { ...after, running: true, cycleNumber, workflowId, trigger: "continue", mode: "temporal", startedAt: new Date().toISOString() };
    return { action: "started", mode: "temporal", workflow, item: null, status: optimistic, continueState: { kind: "processing" } };
  }
  const local = await runLocalCycleStep(ctx, cycleNumber, workflow.reason ?? "temporal unreachable");
  return { action: "started", mode: "local", workflow, item: local.item, status: local.status, continueState: await continueStateFor(ctx, local.status) };
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
      action: "business.continue",
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
}

/** Pause the running cycle: signal the workflow (children included) and mirror it on running tasks. */
export async function pauseCycle(ctx: BusinessContext, status?: CycleStatus): Promise<PauseResult> {
  const s = status ?? (await cycleStatus(ctx));
  if (!s.running) return { paused: false, workflow: null, pausedTasks: 0, reason: "no cycle is running", status: s };
  if (s.paused) return { paused: true, workflow: null, pausedTasks: 0, reason: "already paused", status: s };
  const workflow = s.workflowId ? await ctx.temporal.signal(s.workflowId, "pause", { by: ctx.userId }) : null;
  const pausedTasks = await ctx.rls(async (tx) => {
    let n = 0;
    for (const taskId of s.activeTaskIds) {
      await repos.tasks.setStatus(tx, ctx.businessId, taskId, "paused");
      n++;
    }
    await audit(tx, ctx, { action: PAUSE_ACTION, target: { kind: "cycle", id: s.cycleId ?? "" }, details: { cycleNumber: s.cycleNumber, workflowId: s.workflowId, queued: workflow?.queued ?? false, pausedTasks: n } });
    return n;
  });
  return { paused: true, workflow, pausedTasks, status: await cycleStatus(ctx) };
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
  const s = status ?? (await cycleStatus(ctx));
  if (!s.running) return { resumed: false, workflow: null, resumedTasks: 0, reason: "no cycle is running", status: s };
  if (!s.paused) return { resumed: false, workflow: null, resumedTasks: 0, reason: "the cycle is not paused", status: s };
  const workflow = s.workflowId ? await ctx.temporal.signal(s.workflowId, "resume", { by: ctx.userId }) : null;
  const paused = await repos.tasks.list(ctx.db, ctx.businessId, { status: "paused", limit: 500 });
  const resumedTasks = await ctx.rls(async (tx) => {
    let n = 0;
    for (const task of paused.items) {
      if (!s.plannedTaskIds.includes(task.id) && !task.startedAt) continue;
      await repos.tasks.setStatus(tx, ctx.businessId, task.id, "running");
      n++;
    }
    await audit(tx, ctx, { action: RESUME_ACTION, target: { kind: "cycle", id: s.cycleId ?? "" }, details: { cycleNumber: s.cycleNumber, workflowId: s.workflowId, queued: workflow?.queued ?? false, resumedTasks: n } });
    return n;
  });
  return { resumed: true, workflow, resumedTasks, status: await cycleStatus(ctx) };
}
