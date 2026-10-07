/**
 * @foundmill/orchestrator — Temporal worker (docs/ARCHITECTURE.md §10, BUILD §9.4).
 *
 * Connects to TEMPORAL_ADDRESS, polls TEMPORAL_TASK_QUEUE and runs the workflows in ./workflows with the activities in
 * ./activities. When Temporal is unreachable it prints how to start one (`temporal server start-dev`) and retries,
 * never faster than every 10 seconds. Nothing here is imported by workflow code.
 */
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker, type NativeConnection as NativeConnectionType } from "@temporalio/worker";
import { APP_NAME } from "@foundmill/config";
import { createActivities } from "./activities";
import { createDeps, type OrchestratorDeps } from "./deps";
import { loadOrchestratorEnv } from "./env";

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
  maxConcurrentWorkflowTaskExecutions?: number;
}

export async function createWorker(options: CreateWorkerOptions = {}): Promise<{ worker: Worker; deps: OrchestratorDeps; connection: NativeConnectionType }> {
  const deps = options.deps ?? createDeps();
  const env = deps.env;
  const connection = options.connection ?? (await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS }));
  const worker = await Worker.create({
    connection,
    namespace: options.namespace ?? env.TEMPORAL_NAMESPACE,
    taskQueue: options.taskQueue ?? env.TEMPORAL_TASK_QUEUE,
    workflowsPath: options.workflowsPath ?? WORKFLOWS_PATH,
    activities: createActivities(deps),
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions ?? env.ORCHESTRATOR_MAX_ACTIVITIES,
    maxConcurrentWorkflowTaskExecutions: options.maxConcurrentWorkflowTaskExecutions ?? env.ORCHESTRATOR_MAX_WORKFLOWS,
    shutdownGraceTime: "30 seconds",
  });
  return { worker, deps, connection };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
      await sleep(retryMs);
    }
  }
}

export async function main(): Promise<void> {
  const env = loadOrchestratorEnv();
  const deps = createDeps({ env });
  const abort = new AbortController();
  deps.log.info({ app: APP_NAME, taskQueue: env.TEMPORAL_TASK_QUEUE, address: env.TEMPORAL_ADDRESS, integrations: env.INTEGRATIONS_MODE, models: env.MODEL_MODE }, "orchestrator starting");
  const connection = await connectWithRetry(deps, abort.signal);
  if (!connection) return;
  const { worker } = await createWorker({ deps, connection });
  const shutdown = (sig: string) => {
    deps.log.info({ sig }, "shutting down");
    abort.abort();
    worker.shutdown();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  try {
    await worker.run();
  } finally {
    await connection.close().catch(() => undefined);
    await deps.close();
  }
}

const invokedDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
