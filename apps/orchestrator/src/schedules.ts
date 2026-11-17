/**
 * Temporal Schedules for the periodic jobs (BUILD §9.4 "Schedules"; audit O-17, DB-03, BF-10, RA-23, MLSL-20).
 *
 * `SCHEDULES` is the one list of every periodic job; `registerSchedules` makes the Temporal Schedules match it at
 * orchestrator boot: a missing schedule is created, one whose definition changed is updated (the definition's
 * fingerprint travels in the schedule's note), an unchanged one is left alone, so every boot of every replica is
 * idempotent. Ids are prefixed with the task queue (`<queue>:<id>`), one set per environment even when environments
 * share a namespace. The schedule workflows (src/workflows/schedules.ts) list the businesses they cover when they run.
 *
 * `registerSchedulesWithRetry` never fails boot: when Temporal is unreachable it logs and tries again with backoff until
 * it succeeds or the process stops. Times are UTC; a run that overlaps the previous one is skipped, and a run missed
 * while the cluster was down is caught up within an hour or not at all (the next one does the work).
 * docs/ARCHITECTURE.md §10 lists them.
 */
import { createHash } from "node:crypto";
import type { ScheduleDescription, ScheduleOptions, ScheduleUpdateOptions } from "@temporalio/client";
import type { Logger } from "@foundmill/shared/logger";

export type ScheduleSpecLike = { cronExpressions: string[] } | { intervals: { every: string }[] };

export interface ScheduleDefinition {
  /** Stable id (the schedule id is `<taskQueue>:<id>`). */
  id: string;
  workflowType: string;
  spec: ScheduleSpecLike;
  args: unknown[];
  /** What the job does (the schedule's note in the Temporal UI starts with it). */
  description: string;
  /** Run once each time the orchestrator registers it, at boot (the engine reconciler: a reseeded or restored database gets its engines at once). */
  triggerOnRegister?: boolean;
}

const daily = (minute: number, hour: number): ScheduleSpecLike => ({ cronExpressions: [`${minute} ${hour} * * *`] });
const every = (duration: string): ScheduleSpecLike => ({ intervals: [{ every: duration }] });

export const SCHEDULES: readonly ScheduleDefinition[] = [
  { id: "journey-daily-refresh", workflowType: "journeyDailyRefresh", spec: daily(10, 2), args: [{}], description: "Nightly: journey_daily refresh, attribution refit (Estimate) and milestone catch-up" },
  { id: "journey-matview-refresh", workflowType: "journeyMatviewRefresh", spec: every("15m"), args: [], description: "Every 15 minutes: journey_daily refresh for the Ribbon and status strip" },
  { id: "benchmarks-rebuild", workflowType: "benchmarksRebuild", spec: daily(40, 2), args: [{}], description: "Nightly: per-archetype channel CPA benchmarks (Estimate)" },
  { id: "credential-expiry-scan", workflowType: "credentialExpiryScan", spec: daily(5, 6), args: [{}], description: "Daily: credentials expiring within 14 days" },
  { id: "consent-renewal-scan", workflowType: "consentRenewalScan", spec: daily(20, 6), args: [{}], description: "Daily: open-banking consents expiring within 14 days" },
  { id: "agent-metrics-rollup", workflowType: "agentMetricsRollup", spec: daily(20, 0), args: [{}], description: "Nightly: yesterday's sessions into agent metrics, then agent health" },
  { id: "agent-health-sweep", workflowType: "agentHealthSweep", spec: every("1h"), args: [{}], description: "Hourly: lost sessions closed, agent health, rested agents back to work, wage-cap pauses lifted in a new period" },
  { id: "legal-calendar-roll", workflowType: "legalCalendarRoll", spec: daily(50, 5), args: [{}], description: "Daily: filings due within 30 days and overdue ones" },
  { id: "source-watch-sweep", workflowType: "sourceWatchSweep", spec: daily(10, 4), args: [{ staleAfterHours: 24, perBusiness: 10 }], description: "Daily: the Source Watcher re-reads sources older than a day" },
  { id: "channel-engine-reconcile", workflowType: "channelEngineReconcile", spec: every("15m"), args: [], description: "Every 15 minutes: every channel on the board has its engine running", triggerOnRegister: true },
  { id: "crm-deletion-sweep", workflowType: "crmDeletionSweep", spec: daily(15, 1), args: [{}], description: "Nightly: CRM records whose deletion request came due are purged" },
  { id: "founder-notifications", workflowType: "founderNotifications", spec: every("5m"), args: [{}], description: "Every 5 minutes: founder emails (waiting decisions, wins, milestones, finished runs, used-up credits, the morning brief and the weekly review)" },
  { id: "mock-results-cleanup", workflowType: "mockResultsCleanup", spec: daily(30, 3), args: [{}], description: "Nightly: generated results on real projects, counted or removed (MOCK_RESULTS_CLEANUP)", triggerOnRegister: true },
  { id: "platform-metrics", workflowType: "platformMetrics", spec: daily(15, 3), args: [{}], description: "Nightly: funnel, north star, retention and agent-work counts for real projects" },
  { id: "waitlist-admissions", workflowType: "waitlistAdmissions", spec: every("15m"), args: [{}], description: "Every 15 minutes: admit today's waitlist number, then email everyone admitted" },
  { id: "page-catch-up", workflowType: "pageCatchUp", spec: daily(30, 3), args: [{ limit: 25 }], description: "Nightly: a drafted, unpublished public page and its note for up to 25 real projects that began before public pages and have none (nothing is published)" },
  { id: "business-deletion-sweep", workflowType: "businessDeletionSweep", spec: daily(45, 1), args: [{}], description: "Nightly: businesses whose scheduled deletion came due are deleted" },
];

export const scheduleId = (taskQueue: string, id: string) => `${taskQueue}:${id}`;

/** The definition as the schedule holds it; its hash is the fingerprint kept in the note. */
function definitionOf(def: ScheduleDefinition, taskQueue: string) {
  return {
    spec: def.spec,
    action: { type: "startWorkflow" as const, workflowType: def.workflowType, taskQueue, args: def.args, workflowId: `schedule:${scheduleId(taskQueue, def.id)}` },
    policies: { overlap: "SKIP" as const, catchupWindow: "1 hour" },
  };
}

export function scheduleFingerprint(def: ScheduleDefinition, taskQueue: string): string {
  return createHash("sha256").update(JSON.stringify(definitionOf(def, taskQueue))).digest("hex").slice(0, 16);
}

const noteFor = (def: ScheduleDefinition, taskQueue: string) => `${def.description} [fm:${scheduleFingerprint(def, taskQueue)}]`;

/** The slice of `@temporalio/client`'s `ScheduleClient` registration needs; tests pass a fake. */
export interface ScheduleClientLike {
  create(options: ScheduleOptions): Promise<unknown>;
  getHandle(scheduleId: string): {
    describe(): Promise<Pick<ScheduleDescription, "state">>;
    update(fn: (previous: ScheduleDescription) => ScheduleUpdateOptions): Promise<void>;
    trigger(): Promise<void>;
  };
}

export interface RegisterResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

const alreadyExists = (err: unknown) => {
  const e = err as { name?: string; message?: string };
  return e?.name === "ScheduleAlreadyRunning" || /already (exists|running|registered)/i.test(e?.message ?? "");
};

/** Create every schedule that is missing and update every one whose definition changed (see the module comment). */
export async function registerSchedules(client: ScheduleClientLike, opts: { taskQueue: string; log?: Pick<Logger, "info">; definitions?: readonly ScheduleDefinition[] }): Promise<RegisterResult> {
  const result: RegisterResult = { created: [], updated: [], unchanged: [] };
  for (const def of opts.definitions ?? SCHEDULES) {
    const id = scheduleId(opts.taskQueue, def.id);
    const d = definitionOf(def, opts.taskQueue);
    const note = noteFor(def, opts.taskQueue);
    try {
      await client.create({ scheduleId: id, spec: d.spec, action: d.action, policies: { overlap: d.policies.overlap, catchupWindow: d.policies.catchupWindow }, state: { note } } as ScheduleOptions);
      result.created.push(id);
      if (def.triggerOnRegister) await client.getHandle(id).trigger();
      continue;
    } catch (err) {
      if (!alreadyExists(err)) throw err;
    }
    const handle = client.getHandle(id);
    const current = await handle.describe();
    if (current.state?.note === note) {
      result.unchanged.push(id);
      if (def.triggerOnRegister) await handle.trigger();
      continue;
    }
    // Keep a pause an operator set; replace everything the definition owns.
    await handle.update((previous) => ({ spec: d.spec, action: d.action, policies: { overlap: d.policies.overlap, catchupWindow: d.policies.catchupWindow }, state: { note, paused: previous.state?.paused ?? false } }) as ScheduleUpdateOptions);
    result.updated.push(id);
    if (def.triggerOnRegister) await handle.trigger();
  }
  opts.log?.info({ created: result.created.length, updated: result.updated.length, unchanged: result.unchanged.length }, "temporal schedules registered");
  return result;
}

export interface RegisterWithRetryOptions {
  taskQueue: string;
  log: Pick<Logger, "info" | "warn">;
  signal?: AbortSignal;
  /** First wait after a failure (default 5 s); doubles up to `maxDelayMs` (default 5 minutes). */
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Register the schedules, retrying with backoff while Temporal is unreachable; never throws. `connect` opens a schedule
 * client (and says how to close it); it is called again on each attempt. Resolves with the result, or null when stopped.
 */
export async function registerSchedulesWithRetry(connect: () => Promise<{ client: ScheduleClientLike; close: () => Promise<void> }>, opts: RegisterWithRetryOptions): Promise<RegisterResult | null> {
  const sleep = opts.sleep ?? defaultSleep;
  let delay = opts.initialDelayMs ?? 5_000;
  const max = opts.maxDelayMs ?? 300_000;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) return null;
    let close: (() => Promise<void>) | null = null;
    try {
      const opened = await connect();
      close = opened.close;
      return await registerSchedules(opened.client, { taskQueue: opts.taskQueue, log: opts.log });
    } catch (err) {
      opts.log.warn({ attempt, err: (err as Error)?.message ?? String(err), retryInSeconds: Math.round(delay / 1000) }, "temporal schedules not registered yet; retrying");
    } finally {
      await close?.().catch(() => undefined);
    }
    await sleep(delay, opts.signal);
    delay = Math.min(max, delay * 2);
  }
}

/** A schedule client on its own connection to TEMPORAL_ADDRESS (the worker's native connection cannot serve a Client). */
export async function connectScheduleClient(address: string, namespace: string): Promise<{ client: ScheduleClientLike; close: () => Promise<void> }> {
  const { Client, Connection } = await import("@temporalio/client");
  const connection = await Connection.connect({ address, connectTimeout: "5s" });
  const client = new Client({ connection, namespace });
  return { client: client.schedule as unknown as ScheduleClientLike, close: () => connection.close() };
}
