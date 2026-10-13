/**
 * Is the orchestrator doing its work? (SOAK-06.) Temporal answering is not enough: on 2026-10-11 every activity slot of
 * the worker was held for 1.5 h, the activity backlog reached 95 tasks aged 1 h 37 min with nothing dispatched, and
 * /health stayed green. The verdict here reads the orchestrator's task queues (the main one and the sessions one):
 *
 * - a backlog whose oldest activity has waited longer than its threshold (5 minutes on the main queue, where cycles,
 *   plans and the controls of sessions run; 15 on the sessions queue, where a session may wait for a free slot), or
 * - work waiting with no worker polling for it (every slot held, or no worker at all)
 *
 * makes the worker unhealthy. /health reports it under `worker` (it never fails the api's own readiness, which Railway
 * uses to switch deployments), and `monitorWorker` logs an error when it turns unhealthy, again every 15 minutes while
 * it stays so, and a line when it recovers, so log alerts and error reporting see a stalled platform.
 */
import type { TaskQueueHealth, TemporalService } from "./temporal";
import type { ApiLogger } from "./log";

/** Longest acceptable wait of the oldest activity task, per queue kind (seconds). */
export const BACKLOG_ALERT_SECONDS = { main: 5 * 60, sessions: 15 * 60 } as const;

export interface WorkerVerdict {
  ok: boolean;
  reasons: string[];
  queues: TaskQueueHealth[];
}

const minutes = (s: number) => `${Math.round(s / 60)} min`;

export function workerVerdict(queues: readonly TaskQueueHealth[], mainQueue: string): WorkerVerdict {
  const reasons: string[] = [];
  for (const q of queues) {
    const limit = q.taskQueue === mainQueue ? BACKLOG_ALERT_SECONDS.main : BACKLOG_ALERT_SECONDS.sessions;
    if (q.backlogAgeSeconds !== null && q.backlogAgeSeconds > limit) reasons.push(`${q.taskQueue}: the oldest waiting activity has waited ${minutes(q.backlogAgeSeconds)} (limit ${minutes(limit)})`);
    if ((q.backlogCount ?? 0) > 0 && q.activityPollers === 0) reasons.push(`${q.taskQueue}: ${q.backlogCount} activities waiting and no worker polling (every slot held, or no worker running)`);
  }
  return { ok: reasons.length === 0, reasons, queues: [...queues] };
}

/** The verdict for /health, or null when Temporal cannot be asked (unreachable, disabled, or no stats). */
export async function checkWorker(temporal: Pick<TemporalService, "taskQueues">, taskQueue: string): Promise<WorkerVerdict | null> {
  const queues = (await temporal.taskQueues?.()) ?? null;
  return queues ? workerVerdict(queues, taskQueue) : null;
}

export interface WorkerMonitor {
  /** One check now (the timer calls it every `intervalMs`). */
  tick(): Promise<WorkerVerdict | null>;
  stop(): void;
}

export function monitorWorker(deps: { temporal: Pick<TemporalService, "taskQueues">; log: Pick<ApiLogger, "error" | "info">; taskQueue: string }, options: { intervalMs?: number; repeatMs?: number; now?: () => number; onAlert?: (verdict: WorkerVerdict) => void } = {}): WorkerMonitor {
  const intervalMs = options.intervalMs ?? 60_000;
  const repeatMs = options.repeatMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  let unhealthySince: number | null = null;
  let lastAlert = 0;
  const tick = async () => {
    const verdict = await checkWorker(deps.temporal, deps.taskQueue).catch(() => null);
    if (!verdict) return null;
    if (!verdict.ok) {
      const t = now();
      if (unhealthySince === null || t - lastAlert >= repeatMs) {
        unhealthySince ??= t;
        lastAlert = t;
        deps.log.error({ reasons: verdict.reasons, queues: verdict.queues, since: new Date(unhealthySince).toISOString() }, "orchestrator is not working through its task queues: activities wait with no worker taking them (check the orchestrator's /health and logs)");
        options.onAlert?.(verdict);
      }
    } else if (unhealthySince !== null) {
      deps.log.info({ queues: verdict.queues, unhealthyForMs: now() - unhealthySince }, "orchestrator task queues are served again");
      unhealthySince = null;
    }
    return verdict;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

