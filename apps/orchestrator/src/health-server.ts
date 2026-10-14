/**
 * The orchestrator's `/health` and `/ready` (SOAK-06). The worker serves no other HTTP; this is what an uptime monitor,
 * an operator or Railway's healthcheck reads to see whether the platform's work is being done:
 *
 * - each worker's state and activity slots (in flight, free) from the process itself;
 * - each task queue's backlog as Temporal sees it (activity tasks waiting, how long the oldest has waited, pollers).
 *
 * `ready` is false before the workers run, while the database is down and once a worker stopped: `GET /ready` answers
 * 503 then, and it is Railway's deploy healthcheck (railway/orchestrator.toml). `ok` is also false when work waits past
 * its limit (the 2026-10-11 wedge: 32 slots held by sessions, a backlog of 95 tasks aged 1 h 37 min, and nothing
 * reported it): `GET /health` answers 503 then, for an uptime monitor. The backlog never fails `/ready`: a new
 * deployment that comes to clear a wedged queue must be let in while that queue is still old. Listens on PORT (Railway)
 * or ORCHESTRATOR_PORT, `::` then `0.0.0.0`.
 */
import { createServer, type Server } from "node:http";
import type { Logger } from "@foundmill/shared/logger";

/** Longest acceptable wait of the oldest activity task (seconds): the main queue's work is short, sessions may queue. */
export const BACKLOG_LIMIT_SECONDS = { main: 5 * 60, sessions: 15 * 60 } as const;

export interface WorkerSlots {
  taskQueue: string;
  kind: "main" | "sessions";
  /** The Temporal worker's run state (RUNNING, DRAINING, STOPPED...), or "starting" before it exists. */
  state: string;
  maxActivities: number;
  inFlightActivities: number;
}

export interface QueueBacklog {
  taskQueue: string;
  activityPollers: number;
  backlogCount: number | null;
  backlogAgeSeconds: number | null;
}

export interface OrchestratorHealth {
  /** Ready, and no task queue's work waits past its limit (`GET /health`). */
  ok: boolean;
  /** The workers run and the database answers (`GET /ready`, the deploy healthcheck). */
  ready: boolean;
  service: "orchestrator";
  reasons: string[];
  db: boolean;
  draining: boolean;
  workers: (WorkerSlots & { freeActivities: number })[];
  queues: QueueBacklog[] | null;
  time: string;
}

export function orchestratorHealth(input: { db: boolean; draining: boolean; workers: WorkerSlots[]; queues: QueueBacklog[] | null; now: Date }): OrchestratorHealth {
  const reasons: string[] = [];
  if (!input.db) reasons.push("the database did not answer");
  if (input.workers.length === 0) reasons.push("the workers have not started (Temporal not reachable yet)");
  const workers = input.workers.map((w) => ({ ...w, freeActivities: Math.max(0, w.maxActivities - w.inFlightActivities) }));
  for (const w of workers) if (w.state !== "RUNNING" && !input.draining) reasons.push(`${w.taskQueue}: worker ${w.state.toLowerCase()}`);
  const ready = reasons.length === 0;
  for (const q of input.queues ?? []) {
    const worker = workers.find((w) => w.taskQueue === q.taskQueue);
    const limit = worker?.kind === "sessions" ? BACKLOG_LIMIT_SECONDS.sessions : BACKLOG_LIMIT_SECONDS.main;
    if (q.backlogAgeSeconds !== null && q.backlogAgeSeconds > limit) reasons.push(`${q.taskQueue}: the oldest waiting activity has waited ${Math.round(q.backlogAgeSeconds / 60)} min${worker ? ` (${worker.freeActivities} of ${worker.maxActivities} slots free)` : ""}`);
  }
  return { ok: reasons.length === 0, ready, service: "orchestrator", reasons, db: input.db, draining: input.draining, workers, queues: input.queues, time: input.now.toISOString() };
}

export interface HealthServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

/**
 * Serves `GET /health` (and `/`; 503 unless `ok`) and `GET /ready` (503 unless `ready`), with the same body; anything
 * else is 404. `status` must never throw for long: it is raced against 3 s.
 */
export function startHealthServer(options: { port: number; status: () => Promise<OrchestratorHealth>; log: Pick<Logger, "info" | "warn">; hosts?: readonly string[] }): Promise<HealthServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" || (path !== "/health" && path !== "/ready" && path !== "/")) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000).unref?.());
    void Promise.race([options.status().catch(() => null), timeout]).then((body) => {
      if (!body) {
        res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, ready: false, service: "orchestrator", reasons: ["the health check did not complete"] }));
        return;
      }
      const up = path === "/ready" ? body.ready : body.ok;
      res.writeHead(up ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  const hosts = options.hosts ?? ["::", "0.0.0.0"];
  const listen = (i: number): Promise<HealthServer> =>
    new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if ((err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") && i + 1 < hosts.length) listen(i + 1).then(resolve, reject);
        else reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : options.port;
        options.log.info({ port, host: hosts[i] }, "orchestrator health listening");
        resolve({ server, port, close: () => new Promise<void>((done) => server.close(() => done())) });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(options.port, hosts[i]);
    });
  return listen(0);
}
