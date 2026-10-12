/**
 * @foundmill/orchestrator — Temporal worker (docs/ARCHITECTURE.md §10, BUILD §9.4).
 *
 * Connects to TEMPORAL_ADDRESS, polls TEMPORAL_TASK_QUEUE and runs the workflows in ./workflows with the activities in
 * ./activities. When Temporal is unreachable it prints how to start one (`temporal server start-dev`) and retries,
 * never faster than every 10 seconds. Nothing here is imported by workflow code.
 *
 * Two workers share the connection: the main one (workflows and every short activity, ORCHESTRATOR_MAX_ACTIVITIES
 * slots) and the sessions one (`runAgentSession` only, on `${TEMPORAL_TASK_QUEUE}-sessions`, ORCHESTRATOR_MAX_SESSIONS
 * slots), so agent sessions, however long they run or wait, can never starve cycles, plans, imports, training,
 * vacations or the control activities that pause, stop and decide for those sessions. When one worker stops, the
 * other is shut down too. A promise rejection nobody handled is logged instead of ending the process (and with it
 * every session on this worker).
 *
 * Once the workers run, the periodic jobs' Temporal Schedules are registered (src/schedules.ts: created or updated,
 * retried in the background while Temporal is unreachable; ORCHESTRATOR_SCHEDULES=off skips it).
 *
 * SIGTERM/SIGINT, handled from the first line (a signal while connecting also closes Redis and the pool): stop
 * connecting, stop polling, give running activities `shutdownGraceTime` to finish (then cancel them; an activity that
 * accepts the cancellation is reported failed, so the server retries it on another worker at once), close the Temporal
 * connection, Redis and the database pool, exit 0, all within SHUTDOWN_TIMEOUT_MS (docs/DEPLOY.md §3). The Temporal
 * Runtime listens for the same signals and stops its workers too; `worker.shutdown()` is only called while RUNNING.
 */
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker, type NativeConnection as NativeConnectionType } from "@temporalio/worker";
import { APP_NAME } from "@foundmill/config";
import { MemoryRedis } from "@foundmill/events";
import { onShutdown } from "@foundmill/shared/shutdown";
import { createActivities } from "./activities";
import { MemoryControlBus } from "./control-bus";
import { prepareDb } from "./db-boot";
import { createDeps, type OrchestratorDeps } from "./deps";
import { loadOrchestratorEnv } from "./env";
import { chooseRedisBackend, probeRedis } from "./redis";
import { connectScheduleClient, registerSchedulesWithRetry } from "./schedules";
import { sessionTaskQueue } from "./session-contract";

export { createActivities } from "./activities";
export type { Activities } from "./activities";
export * from "./activities/types";
export { createDeps, type OrchestratorDeps, type CreateDepsOptions } from "./deps";
export { loadOrchestratorEnv, type OrchestratorEnv } from "./env";
export { computeProgress, applySessionEvent, reduceSessionEvents, initialProgress, estimateEta } from "./progress";
export { computeHealth, type HealthSignals, type HealthVerdict } from "./health";
export { FakeClock, SystemClock, systemClock, type Clock } from "./clock";
export { createGatewayClient, createOfflineGatewayClient, signServiceToken } from "./gateway-client";
export { createComposerClient, createOfflineComposerClient, ComposerUnavailableError } from "./composer-client";
export { MemoryControlBus, RedisControlBus, type SessionControlBus, type SessionCommand } from "./control-bus";
export { LoopDetector, LOOP_THRESHOLD } from "./activities/loop";
export { probeRedis, chooseRedisBackend, createRedisClient, type RedisProbe, type RedisBackendChoice } from "./redis";
export { prepareDb, type DbReadiness } from "./db-boot";
export { sessionTaskQueue } from "./session-contract";
export { SCHEDULES, registerSchedules, registerSchedulesWithRetry, scheduleFingerprint, scheduleId, type ScheduleClientLike, type ScheduleDefinition, type RegisterResult } from "./schedules";
export { requestJourneyDailyRefresh, journeyDailyRefreshIdle } from "./journey-refresh";

/** Absolute path of the workflow bundle entry (a TypeScript file; the worker bundles it with swc). */
export const WORKFLOWS_PATH = fileURLToPath(new URL("./workflows/index.ts", import.meta.url));

export const TEMPORAL_DEV_HINT = [
  "Temporal is not reachable.",
  "In development start a local server in another terminal:",
  "    temporal server start-dev",
  "(brew install temporal · or see https://docs.temporal.io/cli). The UI is on http://localhost:8233.",
  "Set TEMPORAL_ADDRESS when it runs elsewhere (default localhost:7233).",
].join("\n");

export interface CreateWorkerOptions {
  deps?: OrchestratorDeps;
  connection?: NativeConnectionType;
  taskQueue?: string;
  namespace?: string;
  /** Override the bundle entry (tests). */
  workflowsPath?: string;
  maxConcurrentActivityTaskExecutions?: number;
  /** Concurrent agent sessions on the sessions worker (default ORCHESTRATOR_MAX_SESSIONS). */
  maxConcurrentSessions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
  /** Time running activities get to finish after shutdown starts, before they are cancelled (default: budget − 15 s). */
  shutdownGraceTimeMs?: number;
  /** After this long the worker stops waiting for activities that ignore cancellation (default: budget − 5 s). */
  shutdownForceTimeMs?: number;
}

/** Worker shutdown timings that fit inside SHUTDOWN_TIMEOUT_MS, leaving time to close the connection, Redis and the pool. */
export function workerShutdownTimes(shutdownTimeoutMs: number): { graceMs: number; forceMs: number } {
  const forceMs = Math.max(2_000, shutdownTimeoutMs - 5_000);
  const graceMs = Math.max(1_000, Math.min(forceMs - 1_000, shutdownTimeoutMs - 15_000));
  return { graceMs, forceMs };
}

/**
 * The main worker and the sessions worker on one connection. The main worker keeps `runAgentSession` registered for
 * session workflows started before the sessions queue existed (they schedule it on the main queue).
 */
export async function createWorker(options: CreateWorkerOptions = {}): Promise<{ worker: Worker; sessionWorker: Worker; deps: OrchestratorDeps; connection: NativeConnectionType }> {
  const deps = options.deps ?? createDeps();
  const env = deps.env;
  const connection = options.connection ?? (await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS }));
  const namespace = options.namespace ?? env.TEMPORAL_NAMESPACE;
  const taskQueue = options.taskQueue ?? env.TEMPORAL_TASK_QUEUE;
  const shutdownGraceTime = options.shutdownGraceTimeMs ?? workerShutdownTimes(env.SHUTDOWN_TIMEOUT_MS).graceMs;
  const shutdownForceTime = options.shutdownForceTimeMs ?? workerShutdownTimes(env.SHUTDOWN_TIMEOUT_MS).forceMs;
  const activities = createActivities(deps);
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: options.workflowsPath ?? WORKFLOWS_PATH,
    activities,
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions ?? env.ORCHESTRATOR_MAX_ACTIVITIES,
    maxConcurrentWorkflowTaskExecutions: options.maxConcurrentWorkflowTaskExecutions ?? env.ORCHESTRATOR_MAX_WORKFLOWS,
    shutdownGraceTime,
    shutdownForceTime,
  });
  const sessionWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: sessionTaskQueue(taskQueue),
    activities: { runAgentSession: activities.runAgentSession },
    maxConcurrentActivityTaskExecutions: options.maxConcurrentSessions ?? env.ORCHESTRATOR_MAX_SESSIONS,
    shutdownGraceTime,
    shutdownForceTime,
  });
  return { worker, sessionWorker, deps, connection };
}

/** Run every worker until all have stopped; when one stops (an error or not), the others are shut down too. */
export async function runWorkers(workers: readonly Worker[]): Promise<void> {
  const stopAll = () => {
    for (const w of workers) if (w.getState() === "RUNNING") w.shutdown();
  };
  const settled = await Promise.allSettled(workers.map((w) => w.run().finally(stopAll)));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) throw failed.reason;
}

/**
 * Log a promise rejection nobody handled instead of letting Node end the process: one stray rejection (a Redis blip
 * in a timer) would otherwise end every session running on this worker. Returns the uninstaller.
 */
export function installRejectionLogger(log: Pick<OrchestratorDeps["log"], "error">): () => void {
  const onRejection = (reason: unknown) => {
    log.error({ err: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined }, "unhandled promise rejection; the worker keeps running");
  };
  process.on("unhandledRejection", onRejection);
  return () => {
    process.off("unhandledRejection", onRejection);
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
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

/** Connect with a bounded retry loop: one attempt, a clear hint, then try again every TEMPORAL_RETRY_SECONDS (≥ 10 s). */
export async function connectWithRetry(deps: OrchestratorDeps, signal?: AbortSignal): Promise<NativeConnectionType | null> {
  const env = deps.env;
  const retryMs = Math.max(10, env.TEMPORAL_RETRY_SECONDS) * 1000;
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) return null;
    attempt += 1;
    try {
      const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
      if (attempt > 1) deps.log.info({ attempt }, "temporal reachable");
      return connection;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (attempt === 1 && (env.APP_ENV === "development" || env.APP_ENV === "test")) {
        deps.log.error({ address: env.TEMPORAL_ADDRESS, err: message }, TEMPORAL_DEV_HINT);
      } else {
        deps.log.warn({ address: env.TEMPORAL_ADDRESS, err: message, attempt, retryInSeconds: retryMs / 1000 }, "temporal unreachable; retrying");
      }
      await sleep(retryMs, signal);
    }
  }
}

export async function main(): Promise<void> {
  const env = loadOrchestratorEnv();
  // Redis first (one bounded probe): unreachable in development means the in-memory stream + control bus, never a retry storm.
  const backend = chooseRedisBackend(env, await probeRedis(env.REDIS_URL));
  const deps = createDeps({ env, ...(backend.kind === "memory" ? { redis: new MemoryRedis(), control: new MemoryControlBus() } : {}) });
  deps.log[backend.level]({ redis: backend.kind }, backend.message);
  installRejectionLogger(deps.log);
  const abort = new AbortController();
  let connection: NativeConnectionType | null = null;
  let workers: Worker[] = [];
  let running: Promise<void> | null = null;
  const lifecycle = onShutdown({
    service: "orchestrator",
    log: deps.log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      {
        name: "stop worker",
        run: async () => {
          abort.abort();
          // The Temporal Runtime's own handler may have started this already; shutdown() throws unless RUNNING.
          for (const w of workers) if (w.getState() === "RUNNING") w.shutdown();
          await running;
        },
      },
      { name: "close temporal connection", run: () => connection?.close() },
      { name: "close redis and database", run: () => deps.close() },
    ],
  });
  // Database: PGlite boots + migrates here; a locked directory or an unreachable Postgres is one clear line, activities then fail per call.
  const readiness = await prepareDb(deps.db, deps.log, { service: "orchestrator" });
  deps.log.info({ app: APP_NAME, taskQueue: env.TEMPORAL_TASK_QUEUE, sessionTaskQueue: sessionTaskQueue(env.TEMPORAL_TASK_QUEUE), maxActivities: env.ORCHESTRATOR_MAX_ACTIVITIES, maxSessions: env.ORCHESTRATOR_MAX_SESSIONS, address: env.TEMPORAL_ADDRESS, integrations: env.INTEGRATIONS_MODE, models: env.MODEL_MODE, db: readiness.ok, driver: readiness.driver, redis: backend.kind }, "orchestrator starting");
  connection = await connectWithRetry(deps, abort.signal);
  if (!connection || lifecycle.stopping) return;
  const created = await createWorker({ deps, connection });
  workers = [created.worker, created.sessionWorker];
  if (lifecycle.stopping) return;
  running = runWorkers(workers);
  // The periodic jobs' schedules (src/schedules.ts): registered in the background, retried while Temporal is away, never
  // holding up the workers.
  if (env.ORCHESTRATOR_SCHEDULES === "on") {
    void registerSchedulesWithRetry(() => connectScheduleClient(env.TEMPORAL_ADDRESS, env.TEMPORAL_NAMESPACE), { taskQueue: env.TEMPORAL_TASK_QUEUE, log: deps.log, signal: abort.signal });
  }
  try {
    await running;
  } catch (err) {
    if (lifecycle.stopping) return; // the shutdown step reports it
    deps.log.error({ err: (err as Error).message }, "worker stopped with an error; exiting 1 so the platform restarts it");
    await connection.close().catch(() => undefined);
    await deps.close();
    process.exit(1);
  }
  if (!lifecycle.stopping) {
    deps.log.error({}, "worker stopped without a shutdown request; exiting 1 so the platform restarts it");
    await connection.close().catch(() => undefined);
    await deps.close();
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
