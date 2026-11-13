/**
 * Temporal client (docs/ARCHITECTURE.md §10). The connection is opened lazily on first use and every call degrades
 * gracefully: when the server is unreachable the API answers `{ queued: false, reason }` instead of failing the
 * founder's request. Workflow ids are deterministic (`cycle:{businessId}:{n}`, `session:{sessionId}`,
 * `engine:{channelId}`, `autopilot:{businessId}`, `automated:{businessId}`, `holiday:{holidayId}`, `plan:{planId}`, `training:{runId}`, `incorporation:{id}`,
 * `foundations:{businessId}:{attempt}`, `source-watch:{sourceId}:{reason}`, `approval:{approvalId}`).
 */
import type { ApiLogger } from "./log";

export const WORKFLOWS = {
  businessCycle: "businessCycle",
  autopilot: "autopilot",
  agentSession: "agentSession",
  channelEngine: "channelEngine",
  holiday: "holiday",
  automatedMode: "automatedMode",
  planExecution: "planExecution",
  trainingRun: "trainingRun",
  incorporation: "incorporation",
  playbook: "playbook",
  journeyBuild: "journeyBuild",
  importBusiness: "importBusiness",
  businessFoundations: "businessFoundations",
  sourceWatch: "sourceWatch",
  postDraft: "postDraft",
} as const;

export const SIGNALS = {
  decision: "decision",
  shout: "shout",
  pause: "pause",
  resume: "resume",
  stop: "stop",
  founderSubmit: "founderSubmit",
  wake: "wake",
  autopilotRefresh: "autopilotRefresh",
  /** Continue runs until done (Nov 7, 2026): start a run on `autopilot:<businessId>`, or end it (Pause). */
  continueRun: "continueRun",
  continueRunEnd: "continueRunEnd",
} as const;
export type SignalName = (typeof SIGNALS)[keyof typeof SIGNALS];

export const workflowIds = {
  cycle: (businessId: string, n: number) => `cycle:${businessId}:${n}`,
  /** One Autopilot per business (0055): started when it is turned on, ended by Stop all agents or when it is turned off. */
  autopilot: (businessId: string) => `autopilot:${businessId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  engine: (channelId: string) => `engine:${channelId}`,
  holiday: (holidayId: string) => `holiday:${holidayId}`,
  /** One per business in Automated mode (the loop that answers within its authority and runs cycles). */
  automatedMode: (businessId: string) => `automated:${businessId}`,
  plan: (planId: string) => `plan:${planId}`,
  training: (runId: string) => `training:${runId}`,
  incorporation: (incorporationId: string) => `incorporation:${incorporationId}`,
  playbook: (playbookId: string) => `playbook:${playbookId}`,
  foundations: (businessId: string, attempt: number) => `foundations:${businessId}:${attempt}`,
  /** The approvalWait a plan action or a channel launch runs in until the founder answers. */
  approval: (approvalId: string) => `approval:${approvalId}`,
  /** One Source Watcher read of one source (a re-read after it settled gets a new suffix). */
  sourceWatch: (sourceId: string, suffix = "added") => `source-watch:${sourceId}:${suffix}`,
  importBusiness: (businessId: string, at: Date) => `import:${businessId}:${at.getTime().toString(36)}`,
  /** One draft of a post for the founder to share by tap, per business and trigger (a milestone's draft names the milestone). */
  postDraft: (businessId: string, trigger: { kind: string; milestoneId?: string }) => `post-draft:${businessId}:${trigger.kind}${trigger.milestoneId ? `:${trigger.milestoneId}` : ""}`,
} as const;

export interface TemporalResult {
  queued: boolean;
  workflowId: string;
  reason?: string;
  /**
   * `start` only: a workflow with this id was already running, so nothing new started (`queued` stays true: the work is
   * in the orchestrator's hands). Callers that report "started" check this first.
   */
  alreadyStarted?: boolean;
}

/** What Temporal knows about one workflow (`describe`). `reachable: false` means nothing is known. */
export interface WorkflowState {
  reachable: boolean;
  /** Temporal has an execution with this id. */
  found: boolean;
  /** The execution is still open. */
  running: boolean;
  /** Temporal's status name (RUNNING, COMPLETED, FAILED, TERMINATED, ...), when found. */
  status: string | null;
}

export interface SignalManyResult {
  queued: boolean;
  signalled: string[];
  failed: { workflowId: string; reason: string }[];
  reason?: string;
}

/** A Temporal int64 (protobuf Long) or a plain number. */
type LongLike = number | { toString(): string } | null | undefined;

/** The part of `DescribeTaskQueue` the worker health check reads (`report_stats` on). */
export interface DescribeTaskQueueAnswer {
  pollers?: unknown[] | null;
  stats?: { approximateBacklogCount?: LongLike; approximateBacklogAge?: { seconds?: LongLike; nanos?: number | null } | null } | null;
}

/** The slice of `@temporalio/client`'s `Client` the API uses; tests pass a fake. */
export interface TemporalClientLike {
  workflow: {
    start(workflowType: string, options: { workflowId: string; taskQueue: string; args?: unknown[] }): Promise<unknown>;
    getHandle(workflowId: string): { signal(signalName: string, ...args: unknown[]): Promise<void>; describe?(): Promise<{ status: { name: string } }> };
    /** Start the workflow if it is not running, and deliver the signal either way (one call, no race). */
    signalWithStart?(workflowType: string, options: { workflowId: string; taskQueue: string; args?: unknown[]; signal: string; signalArgs?: unknown[] }): Promise<unknown>;
  };
  /** Raw WorkflowService (the worker health check describes the task queues). */
  workflowService?: { describeTaskQueue(request: { namespace: string; taskQueue: { name: string; kind?: number }; taskQueueType?: number; reportStats?: boolean }): Promise<DescribeTaskQueueAnswer> };
  connection?: { close(): Promise<void> };
}

/** How one task queue's activities are being served (Temporal `DescribeTaskQueue`, activity type). */
export interface TaskQueueHealth {
  taskQueue: string;
  /** Workers that polled the queue for activities recently. A worker whose slots are all taken stops polling. */
  activityPollers: number;
  /** Activity tasks waiting for a worker; null when the server reports no stats. */
  backlogCount: number | null;
  /** How long the oldest waiting activity task has waited, in seconds; null when the server reports no stats. */
  backlogAgeSeconds: number | null;
}

const toNumber = (v: LongLike): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
};

/**
 * What is known about the orchestrator's reachability without waiting for it: `reachable` null until the first connect
 * attempt has answered. `reason` is the service's own words (they name Temporal), for logs; never shown to a founder.
 */
export interface TemporalHealth {
  reachable: boolean | null;
  reason: string | null;
}

export interface TemporalService {
  reachable(): Promise<boolean>;
  /**
   * The last verdict at once, never a wait (first-time founder report, Nov 8, 2026: `business.get` tells the shell
   * whether Continue and Start can run anything). A verdict that is missing or due for a retry starts a connect attempt
   * in the background, so the next read knows.
   */
  health(): TemporalHealth;
  start(workflowType: string, options: { workflowId: string; args?: unknown[] }): Promise<TemporalResult>;
  signal(workflowId: string, signal: SignalName, ...args: unknown[]): Promise<TemporalResult>;
  /**
   * Signal the workflow, starting it first when it is not running (Temporal's signal-with-start). A client without it
   * starts (an already running workflow is fine) and then signals.
   */
  signalWithStart(workflowType: string, options: { workflowId: string; args?: unknown[]; signal: SignalName; signalArgs?: unknown[] }): Promise<TemporalResult>;
  /** The state of one workflow, or `reachable: false` when Temporal cannot be asked (never throws). */
  describe(workflowId: string): Promise<WorkflowState>;
  /** Signal many workflows within a time budget (kill switch). */
  signalMany(workflowIds: readonly string[], signal: SignalName, args?: unknown[], budgetMs?: number): Promise<SignalManyResult>;
  /**
   * The activity side of the orchestrator's task queues (the main queue and `${taskQueue}-sessions`): pollers and
   * backlog. Null when Temporal is unreachable or the client cannot describe queues.
   */
  taskQueues?(): Promise<TaskQueueHealth[] | null>;
  close(): Promise<void>;
}

/** The orchestrator's queues: the main one and the agent sessions' own (`${taskQueue}-sessions`, apps/orchestrator session-contract.ts). */
export const orchestratorTaskQueues = (taskQueue: string): string[] => [taskQueue, `${taskQueue}-sessions`];

export interface CreateTemporalServiceOptions {
  address: string;
  namespace: string;
  taskQueue: string;
  log: ApiLogger;
  /** Never connect (tests, or TEMPORAL_ADDRESS unset). */
  disabled?: boolean;
  connectTimeoutMs?: number;
  /** How long an unreachable verdict is cached before trying again. */
  retryAfterMs?: number;
  /** Override the connection (tests). */
  connect?: () => Promise<TemporalClientLike>;
}

const UNREACHABLE = "temporal unreachable";

export function createTemporalService(opts: CreateTemporalServiceOptions): TemporalService {
  const retryAfterMs = opts.retryAfterMs ?? 15_000;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 2_000;
  let client: TemporalClientLike | null = null;
  let connecting: Promise<TemporalClientLike | null> | null = null;
  let unreachableUntil = 0;
  let lastReason = opts.disabled ? "temporal disabled" : UNREACHABLE;
  /** A connect attempt has answered at least once (so `health` has a verdict, not a guess). */
  let probed = opts.disabled;

  const defaultConnect = async (): Promise<TemporalClientLike> => {
    const { Client, Connection } = await import("@temporalio/client");
    const connection = await Connection.connect({ address: opts.address, connectTimeout: `${connectTimeoutMs}ms` });
    const c = new Client({ connection, namespace: opts.namespace });
    return c as unknown as TemporalClientLike;
  };

  const getClient = async (): Promise<TemporalClientLike | null> => {
    if (opts.disabled) return null;
    if (client) return client;
    if (Date.now() < unreachableUntil) return null;
    if (!connecting) {
      connecting = (async () => {
        try {
          const c = await withTimeout((opts.connect ?? defaultConnect)(), connectTimeoutMs + 500, "connect timeout");
          client = c;
          lastReason = "";
          return c;
        } catch (err) {
          lastReason = `${UNREACHABLE}: ${(err as Error).message}`;
          unreachableUntil = Date.now() + retryAfterMs;
          opts.log.warn({ address: opts.address, err: (err as Error).message }, "temporal unreachable; workflow calls will be reported as not queued");
          return null;
        } finally {
          probed = true;
          connecting = null;
        }
      })();
    }
    return connecting;
  };

  const describe = (err: unknown): string => {
    const e = err as { name?: string; message?: string };
    return `${e.name ?? "Error"}: ${e.message ?? String(err)}`;
  };

  const service: TemporalService = {
    async reachable() {
      return (await getClient()) !== null;
    },
    health() {
      if (client) return { reachable: true, reason: null };
      if (opts.disabled) return { reachable: false, reason: lastReason };
      // Unknown, or the unreachable verdict is due for a retry: ask in the background (one attempt at a time) and
      // answer with what is known now.
      if (Date.now() >= unreachableUntil) void getClient();
      return probed ? { reachable: false, reason: lastReason } : { reachable: null, reason: null };
    },
    async start(workflowType, options) {
      const c = await getClient();
      if (!c) return { queued: false, workflowId: options.workflowId, reason: lastReason };
      try {
        await c.workflow.start(workflowType, { workflowId: options.workflowId, taskQueue: opts.taskQueue, args: options.args ?? [] });
        return { queued: true, workflowId: options.workflowId };
      } catch (err) {
        if ((err as { name?: string }).name === "WorkflowExecutionAlreadyStartedError") {
          return { queued: true, workflowId: options.workflowId, reason: "already running", alreadyStarted: true };
        }
        opts.log.warn({ workflowType, workflowId: options.workflowId, err: describe(err) }, "workflow start failed");
        return { queued: false, workflowId: options.workflowId, reason: describe(err) };
      }
    },
    async signal(workflowId, signal, ...args) {
      const c = await getClient();
      if (!c) return { queued: false, workflowId, reason: lastReason };
      try {
        await c.workflow.getHandle(workflowId).signal(signal, ...args);
        return { queued: true, workflowId };
      } catch (err) {
        return { queued: false, workflowId, reason: describe(err) };
      }
    },
    async signalWithStart(workflowType, options) {
      const c = await getClient();
      if (!c) return { queued: false, workflowId: options.workflowId, reason: lastReason };
      try {
        if (c.workflow.signalWithStart) {
          await c.workflow.signalWithStart(workflowType, { workflowId: options.workflowId, taskQueue: opts.taskQueue, args: options.args ?? [], signal: options.signal, signalArgs: options.signalArgs ?? [] });
        } else {
          try {
            await c.workflow.start(workflowType, { workflowId: options.workflowId, taskQueue: opts.taskQueue, args: options.args ?? [] });
          } catch (err) {
            if ((err as { name?: string }).name !== "WorkflowExecutionAlreadyStartedError") throw err;
          }
          await c.workflow.getHandle(options.workflowId).signal(options.signal, ...(options.signalArgs ?? []));
        }
        return { queued: true, workflowId: options.workflowId };
      } catch (err) {
        opts.log.warn({ workflowType, workflowId: options.workflowId, signal: options.signal, err: describe(err) }, "workflow signal-with-start failed");
        return { queued: false, workflowId: options.workflowId, reason: describe(err) };
      }
    },
    async describe(workflowId) {
      const c = await getClient();
      if (!c) return { reachable: false, found: false, running: false, status: null };
      try {
        const handle = c.workflow.getHandle(workflowId);
        if (!handle.describe) return { reachable: false, found: false, running: false, status: null };
        const d = await withTimeout(handle.describe(), connectTimeoutMs + 500, "describe timeout");
        return { reachable: true, found: true, running: d.status.name === "RUNNING", status: d.status.name };
      } catch (err) {
        if ((err as { name?: string }).name === "WorkflowNotFoundError") return { reachable: true, found: false, running: false, status: null };
        return { reachable: false, found: false, running: false, status: null };
      }
    },
    async signalMany(ids, signal, args = [], budgetMs = 10_000) {
      const c = await getClient();
      if (!c) return { queued: false, signalled: [], failed: ids.map((workflowId) => ({ workflowId, reason: lastReason })), reason: lastReason };
      const deadline = Date.now() + budgetMs;
      const results = await Promise.allSettled(
        ids.map(async (workflowId) => {
          const remaining = Math.max(250, deadline - Date.now());
          await withTimeout(c.workflow.getHandle(workflowId).signal(signal, ...args), remaining, "signal timeout");
          return workflowId;
        }),
      );
      const signalled: string[] = [];
      const failed: { workflowId: string; reason: string }[] = [];
      results.forEach((r, i) => {
        const workflowId = ids[i]!;
        if (r.status === "fulfilled") signalled.push(workflowId);
        else failed.push({ workflowId, reason: describe(r.reason) });
      });
      return { queued: true, signalled, failed };
    },
    async taskQueues() {
      const c = await getClient();
      if (!c?.workflowService) return null;
      const service = c.workflowService;
      try {
        return await Promise.all(
          orchestratorTaskQueues(opts.taskQueue).map(async (name): Promise<TaskQueueHealth> => {
            // TASK_QUEUE_KIND_NORMAL = 1, TASK_QUEUE_TYPE_ACTIVITY = 2.
            const r = await service.describeTaskQueue({ namespace: opts.namespace, taskQueue: { name, kind: 1 }, taskQueueType: 2, reportStats: true });
            const age = r.stats?.approximateBacklogAge;
            return {
              taskQueue: name,
              activityPollers: r.pollers?.length ?? 0,
              backlogCount: toNumber(r.stats?.approximateBacklogCount),
              backlogAgeSeconds: r.stats ? (toNumber(age?.seconds) ?? 0) + (age?.nanos ?? 0) / 1e9 : null,
            };
          }),
        );
      } catch (err) {
        opts.log.warn({ err: describe(err) }, "temporal task queues could not be described");
        return null;
      }
    },
    async close() {
      const c = client;
      client = null;
      try {
        await c?.connection?.close();
      } catch {
        /* closing is best effort */
      }
    },
  };
  return service;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
