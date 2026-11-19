/**
 * Starting the orchestrator's workflows from ingest (docs/ARCHITECTURE.md §10): `journeyBuild` for a conversion that won a
 * customer, `playbook` for a founder playbook whose trigger an ingested event matches, and, after a paid top-up lifted a
 * stop for used-up credits, the `channelEngine`s and queued `trainingRun`s a resume starts again. Same shape as apps/api's
 * Temporal service: the connection opens lazily, an unreachable server is remembered for `retryAfterMs` and reported as
 * `started: false` (a delivery is never failed because Temporal is down), and a workflow id that is already running
 * counts as started, so a vendor's retry never runs the same work twice. Ids are deterministic: `journey:{conversionId}`,
 * `playbook:{playbookId}:{eventId}`, and apps/api's `engine:{channelId}`, `training:{runId}` and
 * `post-draft:{businessId}:{trigger}` (a post the social agent drafts for the founder to share by tap, after the
 * project's first follower confirmed).
 */
import type { IngestLogger } from "./types";

export const INGEST_WORKFLOWS = { journeyBuild: "journeyBuild", playbook: "playbook", channelEngine: "channelEngine", trainingRun: "trainingRun", postDraft: "postDraft", businessCycle: "businessCycle" } as const;

export const ingestWorkflowIds = {
  journey: (conversionId: string) => `journey:${conversionId}`,
  playbook: (playbookId: string, eventId: string) => `playbook:${playbookId}:${eventId}`,
  /** Same ids as apps/api `workflowIds` (services/temporal.ts), so a start that is already running is not repeated. */
  engine: (channelId: string) => `engine:${channelId}`,
  training: (runId: string) => `training:${runId}`,
  /** Same id as apps/api `workflowIds.postDraft`: one draft of a post per business and trigger. */
  postDraft: (businessId: string, trigger: string) => `post-draft:${businessId}:${trigger}`,
  /** Same id as apps/api `workflowIds.cycle`: the round a paid checkout unblocks (followups.ts `continueAfterPayment`). */
  cycle: (businessId: string, cycleNumber: number) => `cycle:${businessId}:${cycleNumber}`,
} as const;

export interface WorkflowStartResult {
  started: boolean;
  workflowId: string;
  reason?: string;
}

export interface WorkflowStarter {
  start(workflowType: string, options: { workflowId: string; args: unknown[] }): Promise<WorkflowStartResult>;
  close(): Promise<void>;
}

/** The slice of `@temporalio/client`'s `Client` ingest uses; tests pass a fake. */
export interface TemporalStartClient {
  workflow: { start(workflowType: string, options: { workflowId: string; taskQueue: string; args: unknown[] }): Promise<unknown> };
  connection?: { close(): Promise<void> };
}

export interface TemporalStarterOptions {
  address: string;
  namespace: string;
  /** The orchestrator's main queue (`TEMPORAL_TASK_QUEUE`); journeyBuild and playbook run there, sessions do not. */
  taskQueue: string;
  log: IngestLogger;
  connectTimeoutMs?: number;
  retryAfterMs?: number;
  connect?: () => Promise<TemporalStartClient>;
}

export function createTemporalStarter(opts: TemporalStarterOptions): WorkflowStarter {
  const retryAfterMs = opts.retryAfterMs ?? 15_000;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 2_000;
  let client: TemporalStartClient | null = null;
  let connecting: Promise<TemporalStartClient | null> | null = null;
  let unreachableUntil = 0;
  let lastReason = "temporal unreachable";

  const defaultConnect = async (): Promise<TemporalStartClient> => {
    const { Client, Connection } = await import("@temporalio/client");
    const connection = await Connection.connect({ address: opts.address, connectTimeout: `${connectTimeoutMs}ms` });
    return new Client({ connection, namespace: opts.namespace }) as unknown as TemporalStartClient;
  };

  const getClient = async (): Promise<TemporalStartClient | null> => {
    if (client) return client;
    if (Date.now() < unreachableUntil) return null;
    if (!connecting) {
      connecting = (async () => {
        try {
          // A server that accepts the socket but never answers must not hold follow-ups (or shutdown) forever; a
          // connection that completes after we gave up is closed rather than leaked.
          client = await withTimeout((opts.connect ?? defaultConnect)(), connectTimeoutMs + 500, (late) => void late.connection?.close().catch(() => undefined));
          return client;
        } catch (err) {
          lastReason = `temporal unreachable: ${(err as Error).message}`;
          unreachableUntil = Date.now() + retryAfterMs;
          opts.log.warn({ address: opts.address, err: (err as Error).message }, "temporal unreachable; journeyBuild and playbooks are not started until it is");
          return null;
        } finally {
          connecting = null;
        }
      })();
    }
    return connecting;
  };

  return {
    async start(workflowType, options) {
      const c = await getClient();
      if (!c) return { started: false, workflowId: options.workflowId, reason: lastReason };
      try {
        await c.workflow.start(workflowType, { workflowId: options.workflowId, taskQueue: opts.taskQueue, args: options.args });
        return { started: true, workflowId: options.workflowId };
      } catch (err) {
        const e = err as { name?: string; message?: string };
        if (e.name === "WorkflowExecutionAlreadyStartedError") return { started: true, workflowId: options.workflowId, reason: "already running" };
        opts.log.warn({ workflowType, workflowId: options.workflowId, err: `${e.name ?? "Error"}: ${e.message ?? String(err)}` }, "workflow start failed");
        return { started: false, workflowId: options.workflowId, reason: e.message ?? String(err) };
      }
    },
    async close() {
      const c = client;
      client = null;
      await c?.connection?.close().catch(() => undefined);
    },
  };
}

/** `p`, or a "connect timeout" rejection after `ms`; `onLate` receives a value that arrives after the timeout. */
function withTimeout<T>(p: Promise<T>, ms: number, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("connect timeout"));
    }, ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        if (timedOut) onLate?.(v);
        else resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Starts nothing (tests that do not exercise follow-ups, tools). */
export const disabledWorkflowStarter: WorkflowStarter = {
  async start(_type, options) {
    return { started: false, workflowId: options.workflowId, reason: "workflows disabled" };
  },
  async close() {},
};
