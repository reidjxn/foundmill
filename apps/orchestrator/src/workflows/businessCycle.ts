/**
 * businessCycle (BUILD §9.4, ARCHITECTURE §10): one press of Continue.
 *
 * load brief → Chief of Staff plan → dispatch agentSession children within concurrency, budget and file-scope
 * constraints (AC-11.6.2: overlapping file scopes never run together) → collect → composer narrate → `cycle.completed`.
 * Ends when every branch is done or waiting, at the time box (children keep working; the next cycle picks them up),
 * or on `stop`. Signals pause/resume/shout/decision/stop are fanned out to the running children. Each session row is
 * opened before its child starts and carries the child's id `session:<id>`; a stopped team (the brief says so, or a
 * dispatch is refused for it) ends the cycle as `stopped` without planning or opening anything more. A plan that cannot
 * be drafted (the model account cannot pay, a missing or refused key, or every retry failed) ends the cycle `failed`
 * with a note in the Inbox saying why, instead of the workflow failing without a word (audit BILL-06).
 *
 * Lead, 2026-10-24: before the plan, Now roadmap items without tasks are planned into tasks (`planRoadmap`, brief
 * reloaded after); and when a session finishes, the tasks it unblocked start within the same time box (`followUpStarts`).
 */
import { ActivityFailure, ApplicationFailure, CancellationScope, ParentClosePolicy, allHandlersFinished, condition, isCancellation, patched, proxyActivities, setHandler, startChild, uuid4, workflowInfo, type ChildWorkflowHandle } from "@temporalio/workflow";
import type { Activities, BusinessBrief, BusinessCycleInput, BusinessCycleResult, CyclePlan, CycleStart, RoadmapPlanResult } from "../activities";
import { CYCLE_PLAN_FAILURE, DEFAULT_TASK_RESERVE_MINOR, MIN_SESSION_CAP_MINOR, PLAN_FAILED_MESSAGE, cycleOutcomeSubject, cycleTallyLine, type PlanFailureDetails } from "../cycle-contract";
import { agentSession, type AgentSessionOutcome } from "./agentSession";
import { mergeReview } from "./mergeReview";
import { decisionSignal, pauseSignal, resumeSignal, shoutSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

/** A cycle stops opening sessions the moment it is stopped, not only between dispatch rounds (histories before it replay without). */
export const CYCLE_STOP_DISPATCH_PATCH = "cycle-stop-dispatch";
/** A paused cycle opens no new session until it is resumed (audit O-23; histories before it replay without). */
export const CYCLE_PAUSE_HOLD_PATCH = "cycle-pause-hold";

export { DEFAULT_TASK_RESERVE_MINOR };

/** A finished session returns its reserve to the cycle and takes what it really cost (histories before it replay without). */
export const CYCLE_BUDGET_RECONCILE_PATCH = "cycle-budget-reconcile";
/** The cycle plans Now roadmap items without tasks before the Chief of Staff's plan (lead, 2026-10-24; histories before it replay without). */
export const CYCLE_PLANS_ROADMAP_PATCH = "cycle-plans-roadmap";
/** A cycle keeps going when a session finishes: tasks that became dispatchable start within the time box (decision 8; histories before it replay without). */
export const CYCLE_FOLLOW_UPS_PATCH = "cycle-follow-ups";
/** A capped cycle runs only as many sessions at a time as its cap pays for at the floor (WP-05 T15; histories before it replay without). */
export const CYCLE_CAP_FLOOR_PATCH = "cycle-cap-floor";
/** The tasks the plan parked for want of a tool reach the round's note, said once (WP-05 T18; histories before it replay without). */
export const CYCLE_PARKED_SAID_ONCE_PATCH = "cycle-parked-said-once";

/**
 * What a starting task reserves of the credits left (an Estimate): its own budget or the default, but never more than
 * an equal share of what is left for the slots still free, so a small balance (a tier's included credits) still runs
 * work rather than refusing every task. Credits are settled after the fact; the charge that uses the last one pauses.
 */
export function taskReserveMinor(budgetMinor: number | null, budgetRemaining: number, freeSlots: number): number {
  return Math.max(0, Math.min(budgetMinor ?? DEFAULT_TASK_RESERVE_MINOR, Math.floor(budgetRemaining / Math.max(1, freeSlots))));
}

/** How many sessions a capped cycle runs at a time: what it may spend pays for that many at the floor, at least one, at most its slots. */
export function capSlots(capMinor: number, maxConcurrent: number): number {
  return Math.max(1, Math.min(maxConcurrent, Math.floor(capMinor / MIN_SESSION_CAP_MINOR)));
}
const HOUR_MS = 60 * 60 * 1000;

interface Running {
  start: CycleStart;
  sessionId: string;
  handle: ChildWorkflowHandle<typeof agentSession>;
  done: boolean;
  outcome: AgentSessionOutcome | null;
  error: string | null;
  /** What the cycle set aside of its credits for this session when it started (US cents, an Estimate). */
  reservedMinor: number;
}

export function fileScopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const x of a) {
    const nx = norm(x);
    for (const y of b) {
      const ny = norm(y);
      if (nx === ny || nx.startsWith(`${ny}/`) || ny.startsWith(`${nx}/`)) return true;
      const gx = nx.endsWith("/**") ? nx.slice(0, -3) : null;
      const gy = ny.endsWith("/**") ? ny.slice(0, -3) : null;
      if (gx && (ny === gx || ny.startsWith(`${gx}/`))) return true;
      if (gy && (nx === gy || nx.startsWith(`${gy}/`))) return true;
    }
  }
  return false;
}

/** What the founder reads about a planning failure, and its kind: the activity's own words when it said why. */
export function planFailureOf(err: unknown): { message: string; details: PlanFailureDetails | null } {
  const cause = err instanceof ActivityFailure ? err.cause : err;
  if (cause instanceof ApplicationFailure && cause.type === CYCLE_PLAN_FAILURE && cause.message) {
    const details = (cause.details?.[0] ?? null) as PlanFailureDetails | null;
    return { message: cause.message, details };
  }
  return { message: PLAN_FAILED_MESSAGE, details: { kind: "error" } };
}

/**
 * The plan could not be drafted: the cycle is recorded (started with nothing planned, then completed `failed`) so the
 * shell stops showing it as processing, and the Chief of Staff's note in the Inbox says why.
 */
async function endUnplanned(input: BusinessCycleInput, brief: BusinessBrief, err: unknown, startedAt: number, cycleId: string): Promise<BusinessCycleResult> {
  const info = workflowInfo();
  const failure = planFailureOf(err);
  const empty: CyclePlan = { summary: failure.message, timeBoxHours: 0.25, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 0 };
  await acts.startCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, trigger: input.trigger, plan: empty, brief, cycleId });
  let inboxItemIds: string[];
  try {
    inboxItemIds = (await acts.notePlanFailure({ businessId: input.businessId, cycleNumber: input.cycleNumber, message: failure.message, details: failure.details })).inboxItemIds;
  } catch {
    inboxItemIds = [];
  }
  await acts.completeCycle({ businessId: input.businessId, cycleId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, costMinor: 0, currency: brief.creditsCurrency, inboxItemIds, durationMs: Date.now() - startedAt, failure: { kind: failure.details?.kind ?? "error", message: failure.message } });
  return { cycleId, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, inboxItemIds, costMinor: 0 };
}

/** The activity's own error rather than Temporal's "Activity task failed" wrapper. */
const failureMessage = (err: unknown): string => (err instanceof ActivityFailure && err.cause ? err.cause.message : (err as Error).message ?? String(err));

/**
 * Since 2026-10-30 every cycle starts the merge of code tasks that passed their tests and wait in review with nothing
 * moving them (activities/merge.ts `pendingMerges`): one `mergeReview` per task, abandoned, so it outlives the cycle. A
 * patch, so cycles recorded before it replay unchanged.
 */
export const MERGE_SWEEP_PATCH = "merge-sweep";

async function startPendingMerges(businessId: string): Promise<void> {
  // The sweep never holds a cycle back: a failed read, or a review already running for a task, is left for the next cycle.
  const pendingMerges = await acts.pendingMerges({ businessId }).catch(() => []);
  for (const merge of pendingMerges) {
    await startChild(mergeReview, { workflowId: `merge:${merge.taskId}`, args: [merge], parentClosePolicy: ParentClosePolicy.ABANDON }).catch(() => undefined);
  }
}

export async function businessCycle(input: BusinessCycleInput): Promise<BusinessCycleResult> {
  const info = workflowInfo();
  const startedAt = Date.now();
  /** Named up front: the retries of `startCycle` and `completeCycle`, and the failure path, all speak of this one cycle. */
  const cycleId = uuid4();
  const running = new Map<string, Running>();
  const finished: Running[] = [];
  let stopped: { reason: string; by: string | null } | null = null;
  let paused = false;
  let costMinor = 0;

  /** Sessions a pause or resume reaches: the tasks it names, or every running session when it names none. */
  const fanOut = (fn: (r: Running) => Promise<void>, taskIds?: readonly string[]) => {
    for (const r of running.values()) if (!r.done && (!taskIds || taskIds.includes(r.start.taskId))) void fn(r).catch(() => undefined);
  };
  setHandler(stopSignal, (p) => {
    stopped = { reason: p?.reason ?? "stopped", by: p?.by ?? null };
    fanOut((r) => r.handle.signal(stopSignal, p));
  });
  setHandler(pauseSignal, (p) => {
    paused = true;
    fanOut((r) => r.handle.signal(pauseSignal, p), p?.taskIds);
  });
  setHandler(resumeSignal, (p) => {
    paused = false;
    fanOut((r) => r.handle.signal(resumeSignal, p), p?.taskIds);
  });
  setHandler(shoutSignal, (p) => fanOut((r) => r.handle.signal(shoutSignal, p)));
  setHandler(decisionSignal, (d) => fanOut((r) => r.handle.signal(decisionSignal, d)));

  let creditsCurrency = "USD";
  try {
    return await runCycle();
  } catch (err) {
    // A failed planning call or a database outage mid-dispatch: close the cycle as failed and tell the founder, instead
    // of leaving Continue stuck on "processing" with nothing in the Inbox (audit O-07).
    const reason = isCancellation(err) ? "the round of work was canceled" : failureMessage(err);
    await CancellationScope.nonCancellable(() =>
      acts.failCycle({
        businessId: input.businessId,
        cycleId,
        cycleNumber: input.cycleNumber,
        workflowId: info.workflowId,
        reason,
        tasksDispatched: finished.length + running.size,
        tasksCompleted: 0,
        tasksBlocked: 0,
        costMinor,
        currency: creditsCurrency,
        durationMs: Date.now() - startedAt,
      }),
    );
    await condition(allHandlersFinished);
    return { cycleId, outcome: "failed", tasksDispatched: finished.length + running.size, tasksCompleted: 0, tasksBlocked: 0, inboxItemIds: [], costMinor };
  }

  async function runCycle(): Promise<BusinessCycleResult> {
    let brief = await acts.loadBrief({ businessId: input.businessId });
    creditsCurrency = brief.creditsCurrency;
    // A stopped team (Stop all agents, a revoked key, used-up credits) plans nothing and dispatches nothing.
    if (brief.agentsStopped) stopped = { reason: "agents_stopped", by: null };
    // The team plans the roadmap (lead, 2026-10-24): Now items without tasks are planned into tasks before the Chief of
    // Staff plans, and the brief is reloaded so the plan sees them. The activity never fails for one item; should it fail
    // outright, the cycle goes on without it and the items are tried again next cycle.
    let roadmapPlanned: RoadmapPlanResult | null = null;
    if (!stopped && (brief.untaskedRoadmap ?? []).some((r) => r.horizon === "now") && patched(CYCLE_PLANS_ROADMAP_PATCH)) {
      try {
        roadmapPlanned = await acts.planRoadmap({ businessId: input.businessId, cycleNumber: input.cycleNumber, brief });
      } catch {
        roadmapPlanned = null;
      }
      if (roadmapPlanned && roadmapPlanned.planned.length > 0) brief = await acts.loadBrief({ businessId: input.businessId });
    }
    let plan: CyclePlan;
    try {
      plan = await acts.planCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, trigger: input.trigger, brief, roadmapPlanned });
    } catch (err) {
      return endUnplanned(input, brief, err, startedAt, cycleId);
    }
    const timeBoxHours = input.timeBoxAgentHours ?? plan.timeBoxHours;
    await acts.startCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, trigger: input.trigger, plan, brief, cycleId });
    if (patched(MERGE_SWEEP_PATCH)) await startPendingMerges(input.businessId);

    const maxConcurrent = Math.max(1, Math.min(input.maxConcurrent ?? brief.maxAgents, brief.maxAgents));
    // A capped cycle (Autopilot's own spend ceiling, 0077) has the smaller of its cap and the credits left.
    const cap = typeof input.budgetCapMinor === "number" ? Math.max(0, input.budgetCapMinor) : null;
    let budgetRemaining = cap === null ? brief.budgetRemainingMinor : brief.budgetRemainingMinor === null ? cap : Math.min(cap, brief.budgetRemainingMinor);
    // Split across every free slot, a small cap gave each session too little to finish anything (15 cents in four shares
    // of 3). A capped cycle runs as many at a time as what it may spend pays for at the floor, and always at least one.
    const slots = cap !== null && budgetRemaining !== null && patched(CYCLE_CAP_FLOOR_PATCH) ? capSlots(budgetRemaining, maxConcurrent) : maxConcurrent;
    const reconcileBudget = patched(CYCLE_BUDGET_RECONCILE_PATCH);
    const pending: CycleStart[] = [...plan.starts];
    const skipped: { taskId: string; reason: string }[] = [];
    /** Every task this cycle started, holds pending, skipped or finished: a follow-up never offers one of them again. */
    const seenTasks = new Set(plan.starts.map((s) => s.taskId));
    const deadline = startedAt + timeBoxHours * HOUR_MS;
    costMinor = plan.costMinor + (roadmapPlanned?.costMinor ?? 0);

    const canStart = (s: CycleStart): string | null => {
      if (running.size >= slots) return "concurrency";
      for (const r of running.values()) {
        if (r.start.agentId === s.agentId) return "agent busy";
        if (fileScopesOverlap(r.start.fileScope, s.fileScope)) return "file scope overlap";
      }
      if (budgetRemaining !== null && (budgetRemaining <= 0 || budgetRemaining - taskReserveMinor(s.budgetMinor, budgetRemaining, slots - running.size) < 0)) return "budget";
      return null;
    };

    const dispatchReady = async () => {
      for (let i = 0; i < pending.length; ) {
        // A paused cycle opens nothing new until it is resumed (or stopped, or its time box ends).
        if (paused && patched(CYCLE_PAUSE_HOLD_PATCH)) {
          await condition(() => !paused || stopped !== null, Math.max(1, deadline - Date.now()));
          if (paused) return;
        }
        // A stop that lands mid-dispatch (Stop all agents now signals the cycle) ends it before the next session opens.
        if (stopped && patched(CYCLE_STOP_DISPATCH_PATCH)) return;
        const s = pending[i]!;
        const blocker = canStart(s);
        if (blocker === "budget") {
          skipped.push({ taskId: s.taskId, reason: "budget exhausted for this round of work" });
          pending.splice(i, 1);
          continue;
        }
        if (blocker) {
          i += 1;
          continue;
        }
        pending.splice(i, 1);
        // The row is created first and carries the workflow id `session:<id>` the child is started with. The id is
        // chosen here, so a retried `openSession` finds the row it opened instead of opening a second session.
        const sessionId = uuid4();
        // A capped cycle hands each session its reserve as the most it may spend (decided before it is opened).
        const sessionCap = cap !== null && budgetRemaining !== null ? taskReserveMinor(s.budgetMinor, budgetRemaining, slots - running.size) : null;
        const opened = await acts.openSession({ businessId: input.businessId, agentId: s.agentId, taskId: s.taskId, sessionId });
        if (!opened.sessionId) {
          skipped.push({ taskId: s.taskId, reason: opened.detail ?? opened.refused ?? "not dispatched" });
          if (opened.refused === "agents_stopped") stopped = { reason: "agents_stopped", by: null };
          continue;
        }
        const handle = await startChild(agentSession, {
          workflowId: `session:${opened.sessionId}`,
          args: [{ businessId: input.businessId, agentId: s.agentId, taskId: s.taskId, sessionId: opened.sessionId, cycleId, briefText: brief.text, ...(sessionCap !== null ? { spendCapMinor: sessionCap } : {}) }],
          parentClosePolicy: ParentClosePolicy.ABANDON,
        });
        const entry: Running = { start: s, sessionId: opened.sessionId, handle, done: false, outcome: null, error: null, reservedMinor: 0 };
        running.set(s.taskId, entry);
        if (budgetRemaining !== null) {
          entry.reservedMinor = sessionCap ?? taskReserveMinor(s.budgetMinor, budgetRemaining, slots - running.size + 1);
          budgetRemaining -= entry.reservedMinor;
        }
        // The stop landed while this session was being opened: the fan-out ran before the child existed, so it gets its own.
        const stop: { reason: string; by: string | null } | null = stopped;
        if (stop && patched(CYCLE_STOP_DISPATCH_PATCH)) void handle.signal(stopSignal, stop).catch(() => undefined);
        if (paused) void handle.signal(pauseSignal, {}).catch(() => undefined);
        void handle
          .result()
          .then((outcome) => {
            entry.outcome = outcome;
            // The reserve was a guess: it goes back, and what the session really cost comes off (audit O-29). Later
            // dispatches see what is left, so a cycle stops starting work once its credits are spent.
            if (reconcileBudget && budgetRemaining !== null) budgetRemaining += entry.reservedMinor - Math.max(0, Math.round(outcome.result.costMinor));
          })
          .catch((err: unknown) => {
            entry.error = (err as Error).message ?? String(err);
            if (reconcileBudget && budgetRemaining !== null) budgetRemaining += entry.reservedMinor;
          })
          .finally(() => {
            entry.done = true;
            running.delete(s.taskId);
            finished.push(entry);
          });
      }
    };

    let outcome: BusinessCycleResult["outcome"] = "completed";
    for (;;) {
      if (stopped) {
        outcome = "stopped";
        break;
      }
      await dispatchReady();
      if (running.size === 0 && pending.length === 0) break;
      if (running.size === 0 && pending.length > 0) {
        // Everything left is blocked by a busy agent or scope that no running session will free: wait for the next cycle.
        for (const s of pending.splice(0, pending.length)) skipped.push({ taskId: s.taskId, reason: "waiting on an agent or file scope" });
        outcome = "waiting";
        break;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        outcome = "time_box";
        break;
      }
      const before = finished.length;
      const woke = await condition(() => finished.length > before || stopped !== null, remaining);
      if (!woke) {
        outcome = "time_box";
        break;
      }
      // A session finished: the tasks that waited on it (and anything else now dispatchable) start within this cycle's
      // time box instead of waiting for the next press of Continue (decision 8). One read per wake; a failure here only
      // means the next wake, or the next cycle, picks them up.
      if (finished.length > before && !stopped && !paused && patched(CYCLE_FOLLOW_UPS_PATCH)) {
        try {
          const more = await acts.followUpStarts({ businessId: input.businessId, cycleId, exclude: [...seenTasks], busyAgentIds: [...running.values()].map((r) => r.start.agentId), limit: maxConcurrent, trigger: input.trigger });
          for (const s of more) {
            if (seenTasks.has(s.taskId)) continue;
            seenTasks.add(s.taskId);
            pending.push(s);
          }
        } catch {
          /* tried again on the next wake */
        }
      }
    }
    // Nothing could start and no model was called: the cycle waits for the founder, not for a task.
    if (outcome === "completed" && plan.idle) outcome = "waiting";

    const outcomes = finished.map((f) => f.outcome).filter((o): o is AgentSessionOutcome => o !== null);
    const tasksCompleted = outcomes.filter((o) => o.result.outcome === "done").length;
    const tasksBlocked = outcomes.filter((o) => o.result.outcome === "blocked" || o.result.outcome === "failed").length + finished.filter((f) => f.error).length;
    for (const o of outcomes) costMinor += o.result.costMinor;
    if (outcome === "completed" && tasksBlocked > 0 && tasksCompleted === 0) outcome = "waiting";
    if (outcome === "completed" && finished.some((f) => f.error) && tasksCompleted === 0) outcome = "failed";

    const eventIds = outcomes.flatMap((o) => o.finish?.eventIds ?? []);
    // Founder words (Nov 8, 2026): the note is read by everyone, so no cycle number. String arguments only: replay-safe.
    const summary = `${plan.summary}\n\n${cycleTallyLine({ started: finished.length + running.size, finished: tasksCompleted, blocked: tasksBlocked, stillRunning: running.size, deferred: skipped.length })}`;
    let inboxItemIds: string[];
    try {
      if (plan.idle) {
        // One plain note saying what is in the way (no planner, no narration to pay for), not a "Cycle N completed" per press.
        const note = await acts.noteIdleCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, summary: plan.summary });
        inboxItemIds = note.inboxItemId ? [note.inboxItemId] : [];
      } else {
        const parked = plan.parked?.length && patched(CYCLE_PARKED_SAID_ONCE_PATCH) ? { parked: plan.parked } : {};
        const narrated = await acts.narrateCycle({ businessId: input.businessId, eventIds, summary, fallbackSubject: cycleOutcomeSubject(outcome), ...parked });
        inboxItemIds = narrated.inboxItemIds;
      }
    } catch {
      inboxItemIds = [];
    }
    const agentHours = outcomes.reduce((a, o) => a + o.result.durationMs, 0) / HOUR_MS;
    await acts.completeCycle({ businessId: input.businessId, cycleId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, outcome, tasksDispatched: finished.length + running.size, tasksCompleted, tasksBlocked, agentHours: Math.round(agentHours * 1000) / 1000, costMinor, currency: brief.creditsCurrency, inboxItemIds, durationMs: Date.now() - startedAt });
    await condition(allHandlersFinished);
    return { cycleId, outcome, tasksDispatched: finished.length + running.size, tasksCompleted, tasksBlocked, inboxItemIds, costMinor };
  }
}
