/**
 * Temporal client (docs/ARCHITECTURE.md §10). The connection is opened lazily on first use and every call degrades
 * gracefully: when the server is unreachable the API answers `{ queued: false, reason }` instead of failing the
 * founder's request. Workflow ids are deterministic (`cycle:{businessId}:{n}`, `session:{sessionId}`,
 * `engine:{channelId}`, `holiday:{holidayId}`, `plan:{planId}`, `training:{runId}`, `incorporation:{id}`,
 * `foundations:{businessId}:{attempt}`, `source-watch:{sourceId}:{reason}`).
 */
import type { ApiLogger } from "./log";

export const WORKFLOWS = {
  businessCycle: "businessCycle",
  agentSession: "agentSession",
  channelEngine: "channelEngine",
  holiday: "holiday",
  autopilot: "autopilot",
  planExecution: "planExecution",
  trainingRun: "trainingRun",
  incorporation: "incorporation",
  playbook: "playbook",
  journeyBuild: "journeyBuild",
  importBusiness: "importBusiness",
  businessFoundations: "businessFoundations",
  sourceWatch: "sourceWatch",
} as const;

export const SIGNALS = {
  decision: "decision",
  shout: "shout",
  pause: "pause",
  resume: "resume",
  stop: "stop",
  founderSubmit: "founderSubmit",
  wake: "wake",
} as const;
export type SignalName = (typeof SIGNALS)[keyof typeof SIGNALS];

export const workflowIds = {
  cycle: (businessId: string, n: number) => `cycle:${businessId}:${n}`,
  session: (sessionId: string) => `session:${sessionId}`,
  engine: (channelId: string) => `engine:${channelId}`,
  holiday: (holidayId: string) => `holiday:${holidayId}`,
  /** One per business in Automated mode. */
  autopilot: (businessId: string) => `autopilot:${businessId}`,
  plan: (planId: string) => `plan:${planId}`,
  training: (runId: string) => `training:${runId}`,
  incorporation: (incorporationId: string) => `incorporation:${incorporationId}`,
  playbook: (playbookId: string) => `playbook:${playbookId}`,
  foundations: (businessId: string, attempt: number) => `foundations:${businessId}:${attempt}`,
  /** One Source Watcher read of one source (a re-read after it settled gets a new suffix). */
  sourceWatch: (sourceId: string, suffix = "added") => `source-watch:${sourceId}:${suffix}`,
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

/** The slice of `@temporalio/client`'s `Client` the API uses; tests pass a fake. */
export interface TemporalClientLike {
  workflow: {
    start(workflowType: string, options: { workflowId: string; taskQueue: string; args?: unknown[] }): Promise<unknown>;
    getHandle(workflowId: string): { signal(signalName: string, ...args: unknown[]): Promise<void>; describe?(): Promise<{ status: { name: string } }> };
  };
  connection?: { close(): Promise<void> };
}

export interface TemporalService {
  reachable(): Promise<boolean>;
  start(workflowType: string, options: { workflowId: string; args?: unknown[] }): Promise<TemporalResult>;
  signal(workflowId: string, signal: SignalName, ...args: unknown[]): Promise<TemporalResult>;
  /** The state of one workflow, or `reachable: false` when Temporal cannot be asked (never throws). */
  describe(workflowId: string): Promise<WorkflowState>;
  /** Signal many workflows within a time budget (kill switch). */
  signalMany(workflowIds: readonly string[], signal: SignalName, args?: unknown[], budgetMs?: number): Promise<SignalManyResult>;
  close(): Promise<void>;
}

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
