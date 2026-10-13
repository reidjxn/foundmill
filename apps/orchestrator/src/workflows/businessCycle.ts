/**
 * businessCycle (BUILD §9.4, ARCHITECTURE §10): one press of Continue.
 *
 * load brief → Chief of Staff plan → dispatch agentSession children within concurrency, budget and file-scope
 * constraints (AC-11.6.2: overlapping file scopes never run together) → collect → composer narrate → `cycle.completed`.
 * Ends when every branch is done or waiting, at the time box (children keep working; the next cycle picks them up),
 * or on `stop`. Signals pause/resume/shout/decision/stop are fanned out to the running children. Each session row is
 * opened before its child starts and carries the child's id `session:<id>`; a stopped team (the brief says so, or a
 * dispatch is refused for it) ends the cycle as `stopped` without planning or opening anything more.
 */
import { ActivityFailure, CancellationScope, ParentClosePolicy, allHandlersFinished, condition, isCancellation, patched, proxyActivities, setHandler, startChild, uuid4, workflowInfo, type ChildWorkflowHandle } from "@temporalio/workflow";
import type { Activities, BusinessCycleInput, BusinessCycleResult, CycleStart } from "../activities";
import { agentSession, type AgentSessionOutcome } from "./agentSession";
import { decisionSignal, pauseSignal, resumeSignal, shoutSignal, stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "2 seconds" } });

/** A cycle stops opening sessions the moment it is stopped, not only between dispatch rounds (histories before it replay without). */
export const CYCLE_STOP_DISPATCH_PATCH = "cycle-stop-dispatch";
/** A paused cycle opens no new session until it is resumed (audit O-23; histories before it replay without). */
export const CYCLE_PAUSE_HOLD_PATCH = "cycle-pause-hold";

/** Tasks without a budget reserve this much of the cycle budget (minor units; an Estimate). */
export const DEFAULT_TASK_RESERVE_MINOR = 2_000;

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

/** The activity's own error rather than Temporal's "Activity task failed" wrapper. */
const failureMessage = (err: unknown): string => (err instanceof ActivityFailure && err.cause ? err.cause.message : (err as Error).message ?? String(err));

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
    const reason = isCancellation(err) ? "the cycle was canceled" : failureMessage(err);
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
    const brief = await acts.loadBrief({ businessId: input.businessId });
    creditsCurrency = brief.creditsCurrency;
    // A stopped team (Stop all agents, a revoked key, used-up credits) plans nothing and dispatches nothing.
    if (brief.agentsStopped) stopped = { reason: "agents_stopped", by: null };
    const plan = await acts.planCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, trigger: input.trigger, brief });
    const timeBoxHours = input.timeBoxAgentHours ?? plan.timeBoxHours;
    await acts.startCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, workflowId: info.workflowId, trigger: input.trigger, plan, brief, cycleId });

    const maxConcurrent = Math.max(1, Math.min(input.maxConcurrent ?? brief.maxAgents, brief.maxAgents));
    let budgetRemaining = brief.budgetRemainingMinor;
    const pending: CycleStart[] = [...plan.starts];
    const skipped: { taskId: string; reason: string }[] = [];
    const deadline = startedAt + timeBoxHours * HOUR_MS;
    costMinor = plan.costMinor;

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
          skipped.push({ taskId: s.taskId, reason: "budget exhausted for this cycle" });
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
        const opened = await acts.openSession({ businessId: input.businessId, agentId: s.agentId, taskId: s.taskId, sessionId });
        if (!opened.sessionId) {
          skipped.push({ taskId: s.taskId, reason: opened.detail ?? opened.refused ?? "not dispatched" });
          if (opened.refused === "agents_stopped") stopped = { reason: "agents_stopped", by: null };
          continue;
        }
        const handle = await startChild(agentSession, {
          workflowId: `session:${opened.sessionId}`,
          args: [{ businessId: input.businessId, agentId: s.agentId, taskId: s.taskId, sessionId: opened.sessionId, cycleId, briefText: brief.text }],
          parentClosePolicy: ParentClosePolicy.ABANDON,
        });
        const entry: Running = { start: s, sessionId: opened.sessionId, handle, done: false, outcome: null, error: null };
        running.set(s.taskId, entry);
        if (budgetRemaining !== null) budgetRemaining -= taskReserveMinor(s.budgetMinor, budgetRemaining, maxConcurrent - running.size + 1);
        if (paused) void handle.signal(pauseSignal, {}).catch(() => undefined);
        void handle
          .result()
          .then((outcome) => {
            entry.outcome = outcome;
          })
          .catch((err: unknown) => {
            entry.error = (err as Error).message ?? String(err);
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
    // Nothing could start and no model was called: the cycle waits for the founder, not for a task.
    if (outcome === "completed" && plan.idle) outcome = "waiting";

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
      if (plan.idle) {
        // One plain note saying what is in the way (no planner, no narration to pay for), not a "Cycle N completed" per press.
        const note = await acts.noteIdleCycle({ businessId: input.businessId, cycleNumber: input.cycleNumber, summary: plan.summary });
        inboxItemIds = note.inboxItemId ? [note.inboxItemId] : [];
      } else {
        const narrated = await acts.narrateCycle({ businessId: input.businessId, eventIds, summary, fallbackSubject: `Cycle ${input.cycleNumber} ${outcome.replace("_", " ")}` });
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
