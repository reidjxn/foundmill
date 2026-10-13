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
 */
import { ActivityFailure, ApplicationFailure, ParentClosePolicy, allHandlersFinished, condition, patched, proxyActivities, setHandler, startChild, workflowInfo, type ChildWorkflowHandle } from "@temporalio/workflow";
import type { Activities, BusinessBrief, BusinessCycleInput, BusinessCycleResult, CyclePlan, CycleStart } from "../activities";
import { CYCLE_PLAN_FAILURE, DEFAULT_TASK_RESERVE_MINOR, PLAN_FAILED_MESSAGE, type PlanFailureDetails } from "../cycle-contract";
import { agentSession, type AgentSessionOutcome } from "./agentSession";
import { decisionSignal, pauseSignal, resumeSignal, shoutSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

/** A cycle stops opening sessions the moment it is stopped, not only between dispatch rounds (histories before it replay without). */
export const CYCLE_STOP_DISPATCH_PATCH = "cycle-stop-dispatch";

export { DEFAULT_TASK_RESERVE_MINOR };

/** A finished session returns its reserve to the cycle and takes what it really cost (histories before it replay without). */
export const CYCLE_BUDGET_RECONCILE_PATCH = "cycle-budget-reconcile";

/**
 * What a starting task reserves of the credits left (an Estimate): its own budget or the default, but never more than
 * an equal share of what is left for the slots still free, so a small balance (a tier's included credits) still runs
 * work rather than refusing every task. Credits are settled after the fact; the charge that uses the last one pauses.
 */
export function taskReserveMinor(budgetMinor: number | null, budgetRemaining: number, freeSlots: number): number {
  return Math.max(0, Math.min(budgetMinor ?? DEFAULT_TASK_RESERVE_MINOR, Math.floor(budgetRemaining / Math.max(1, freeSlots))));
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
async function endUnplanned(input: BusinessCycleInput, brief: BusinessBrief, err: unknown, startedAt: number): Promise<BusinessCycleResult> {
  const info = workflowInfo();
  const failure = planFailureOf(err);
  const empty: CyclePlan = { summary: failure.message, timeBoxHours: 0.25, starts: [], deferred: [], approvalsNeeded: [], modelKey: "opus", warning: null, costMinor: 0 };
  const { cycleId } = await acts.startCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, trigger: input.trigger, plan: empty, brief });
  let inboxItemIds: string[];
  try {
    inboxItemIds = (await acts.notePlanFailure({ businessId: input.businessId, cycleNumber: input.cycleNumber, message: failure.message, details: failure.details })).inboxItemIds;
  } catch {
    inboxItemIds = [];
  }
  await acts.completeCycle({ businessId: input.businessId, cycleId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, costMinor: 0, currency: brief.creditsCurrency, inboxItemIds, durationMs: Date.now() - startedAt });
  return { cycleId, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, inboxItemIds, costMinor: 0 };
}

export async function businessCycle(input: BusinessCycleInput): Promise<BusinessCycleResult> {
  const info = workflowInfo();
  const startedAt = Date.now();
  const running = new Map<string, Running>();
  let stopped: { reason: string; by: string | null } | null = null;
  let paused = false;

  const fanOut = (fn: (r: Running) => Promise<void>) => {
    for (const r of running.values()) if (!r.done) void fn(r).catch(() => undefined);
  };
  setHandler(stopSignal, (p) => {
    stopped = { reason: p?.reason ?? "stopped", by: p?.by ?? null };
    fanOut((r) => r.handle.signal(stopSignal, p));
  });
  setHandler(pauseSignal, (p) => {
    paused = true;
    fanOut((r) => r.handle.signal(pauseSignal, p));
  });
  setHandler(resumeSignal, (p) => {
    paused = false;
    fanOut((r) => r.handle.signal(resumeSignal, p));
  });
  setHandler(shoutSignal, (p) => fanOut((r) => r.handle.signal(shoutSignal, p)));
  setHandler(decisionSignal, (d) => fanOut((r) => r.handle.signal(decisionSignal, d)));

  const brief = await acts.loadBrief({ businessId: input.businessId });
  // A stopped team (Stop all agents, a revoked key, used-up credits) plans nothing and dispatches nothing.
  if (brief.agentsStopped) stopped = { reason: "agents_stopped", by: null };
  let plan: CyclePlan;
  try {
    plan = await acts.planCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, trigger: input.trigger, brief });
  } catch (err) {
    return endUnplanned(input, brief, err, startedAt);
  }
  const timeBoxHours = input.timeBoxAgentHours ?? plan.timeBoxHours;
  const { cycleId } = await acts.startCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, trigger: input.trigger, plan, brief });

  const maxConcurrent = Math.max(1, Math.min(input.maxConcurrent ?? brief.maxAgents, brief.maxAgents));
  let budgetRemaining = brief.budgetRemainingMinor;
  const reconcileBudget = patched(CYCLE_BUDGET_RECONCILE_PATCH);
  const pending: CycleStart[] = [...plan.starts];
  const skipped: { taskId: string; reason: string }[] = [];
  const finished: Running[] = [];
  const deadline = startedAt + timeBoxHours * HOUR_MS;
  let costMinor = plan.costMinor;

  const canStart = (s: CycleStart): string | null => {
    if (running.size >= maxConcurrent) return "concurrency";
    for (const r of running.values()) {
      if (r.start.agentId === s.agentId) return "agent busy";
      if (fileScopesOverlap(r.start.fileScope, s.fileScope)) return "file scope overlap";
    }
    if (budgetRemaining !== null && (budgetRemaining <= 0 || budgetRemaining - taskReserveMinor(s.budgetMinor, budgetRemaining, maxConcurrent - running.size) < 0)) return "budget";
    return null;
  };

  const dispatchReady = async () => {
    for (let i = 0; i < pending.length; ) {
      // A stop that lands mid-dispatch (Stop all agents now signals the cycle) ends it before the next session opens.
      if (stopped && patched(CYCLE_STOP_DISPATCH_PATCH)) return;
      const s = pending[i]!;
      const blocker = canStart(s);
      if (blocker === "budget") {
        skipped.push({ taskId: s.taskId, reason: "budget exhausted for this cycle" });
        pending.splice(i, 1);
        continue;
      }
      if (blocker) {
        i += 1;
        continue;
      }
      pending.splice(i, 1);
      // The row is created first and carries the workflow id `session:<id>` the child is started with.
      const opened = await acts.openSession({ businessId: input.businessId, agentId: s.agentId, taskId: s.taskId });
      const sessionId = opened.sessionId;
      if (!sessionId) {
        skipped.push({ taskId: s.taskId, reason: opened.detail ?? opened.refused ?? "not dispatched" });
        if (opened.refused === "agents_stopped") stopped = { reason: "agents_stopped", by: null };
        continue;
      }
      const handle = await startChild(agentSession, {
        workflowId: `session:${sessionId}`,
        args: [{ businessId: input.businessId, agentId: s.agentId, taskId: s.taskId, sessionId, cycleId, briefText: brief.text }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      });
      const entry: Running = { start: s, sessionId, handle, done: false, outcome: null, error: null, reservedMinor: 0 };
      running.set(s.taskId, entry);
      if (budgetRemaining !== null) {
        entry.reservedMinor = taskReserveMinor(s.budgetMinor, budgetRemaining, maxConcurrent - running.size + 1);
        budgetRemaining -= entry.reservedMinor;
      }
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
  }

  const outcomes = finished.map((f) => f.outcome).filter((o): o is AgentSessionOutcome => o !== null);
  const tasksCompleted = outcomes.filter((o) => o.result.outcome === "done").length;
  const tasksBlocked = outcomes.filter((o) => o.result.outcome === "blocked" || o.result.outcome === "failed").length + finished.filter((f) => f.error).length;
  for (const o of outcomes) costMinor += o.result.costMinor;
  if (outcome === "completed" && tasksBlocked > 0 && tasksCompleted === 0) outcome = "waiting";
  if (outcome === "completed" && finished.some((f) => f.error) && tasksCompleted === 0) outcome = "failed";

  const eventIds = outcomes.flatMap((o) => o.finish?.eventIds ?? []);
  const summary = `${plan.summary}\n\nCycle ${input.cycleNumber}: ${finished.length + running.size} session${finished.length + running.size === 1 ? "" : "s"} dispatched, ${tasksCompleted} finished, ${tasksBlocked} blocked${running.size ? `, ${running.size} still running past the time box` : ""}${skipped.length ? `; ${skipped.length} task${skipped.length === 1 ? "" : "s"} deferred` : ""}.`;
  let inboxItemIds: string[];
  try {
    const narrated = await acts.narrateCycle({ businessId: input.businessId, eventIds, summary, fallbackSubject: `Cycle ${input.cycleNumber} ${outcome.replace("_", " ")}` });
    inboxItemIds = narrated.inboxItemIds;
  } catch {
    inboxItemIds = [];
  }
  const agentHours = outcomes.reduce((a, o) => a + o.result.durationMs, 0) / HOUR_MS;
  await acts.completeCycle({ businessId: input.businessId, cycleId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, outcome, tasksDispatched: finished.length + running.size, tasksCompleted, tasksBlocked, agentHours: Math.round(agentHours * 1000) / 1000, costMinor, currency: brief.creditsCurrency, inboxItemIds, durationMs: Date.now() - startedAt });
  await condition(allHandlersFinished);
  return { cycleId, outcome, tasksDispatched: finished.length + running.size, tasksCompleted, tasksBlocked, inboxItemIds, costMinor };
}
