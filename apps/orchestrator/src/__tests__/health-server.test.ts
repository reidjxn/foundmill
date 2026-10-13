/**
 * The orchestrator's /health (SOAK-06) and its Temporal log lines (PH-3): a wedged worker answers 503 with why, the
 * workers' free slots and the queues' backlog are visible, and the SDK's lines go through pino at their own level.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "@foundmill/shared/logger";
import { describeQueues, workerSlots } from "../index";
import { BACKLOG_LIMIT_SECONDS, orchestratorHealth, startHealthServer, type HealthServer } from "../health-server";
import { temporalLogger } from "../temporal-logger";

const now = new Date("2026-10-11T22:31:00.000Z");
const main = (inFlight: number, state = "RUNNING") => ({ taskQueue: "foundmill", kind: "main" as const, state, maxActivities: 32, inFlightActivities: inFlight });
const sessions = (inFlight: number) => ({ taskQueue: "foundmill-sessions", kind: "sessions" as const, state: "RUNNING", maxActivities: 16, inFlightActivities: inFlight });

describe("orchestratorHealth", () => {
  it("is ok while both workers run and nothing waits past its limit", () => {
    const h = orchestratorHealth({ db: true, draining: false, workers: [main(3), sessions(16)], queues: [{ taskQueue: "foundmill", activityPollers: 1, backlogCount: 0, backlogAgeSeconds: 0 }, { taskQueue: "foundmill-sessions", activityPollers: 0, backlogCount: 2, backlogAgeSeconds: 120 }], now });
    expect(h).toMatchObject({ ok: true, reasons: [], workers: [{ freeActivities: 29 }, { freeActivities: 0 }] });
  });

  it("is not ok on the 2026-10-11 wedge: every slot held and a backlog aged 1 h 37 min", () => {
    const h = orchestratorHealth({ db: true, draining: false, workers: [main(32), sessions(16)], queues: [{ taskQueue: "foundmill", activityPollers: 0, backlogCount: 95, backlogAgeSeconds: 97 * 60 }], now });
    expect(h.ok).toBe(false);
    expect(h.reasons[0]).toContain("foundmill: the oldest waiting activity has waited 97 min (0 of 32 slots free)");
    // Still ready: a new deployment that comes to clear the backlog must pass its deploy healthcheck (/ready).
    expect(h.ready).toBe(true);
  });

  it("is not ok before the workers start, without the database, or with a stopped worker; a drain is expected", () => {
    expect(orchestratorHealth({ db: true, draining: false, workers: [], queues: null, now })).toMatchObject({ ok: false, ready: false, reasons: ["the workers have not started (Temporal not reachable yet)"] });
    expect(orchestratorHealth({ db: false, draining: false, workers: [main(0), sessions(0)], queues: null, now })).toMatchObject({ ok: false, ready: false });
    expect(orchestratorHealth({ db: true, draining: false, workers: [main(0, "STOPPED"), sessions(0)], queues: null, now })).toMatchObject({ ok: false, ready: false });
    expect(orchestratorHealth({ db: true, draining: true, workers: [main(0, "DRAINING"), sessions(0)], queues: null, now }).ok).toBe(true);
    // Sessions may wait for a slot longer than the main queue's work.
    expect(orchestratorHealth({ db: true, draining: false, workers: [main(0), sessions(16)], queues: [{ taskQueue: "foundmill-sessions", activityPollers: 0, backlogCount: 1, backlogAgeSeconds: BACKLOG_LIMIT_SECONDS.main + 60 }], now }).ok).toBe(true);
  });

  it("reads slots from the workers and backlog from Temporal", async () => {
    expect(workerSlots({ getState: () => "RUNNING", getStatus: () => ({ numInFlightActivities: 5 }) as never }, "foundmill", "main", 32)).toEqual(main(5));
    const asked: string[] = [];
    const connection = {
      workflowService: {
        describeTaskQueue: async (req: { taskQueue: { name: string }; taskQueueType: number; reportStats: boolean }) => {
          asked.push(`${req.taskQueue.name}:${req.taskQueueType}:${req.reportStats}`);
          return { pollers: [], stats: { approximateBacklogCount: { toString: () => "95" }, approximateBacklogAge: { seconds: { toString: () => "5820" }, nanos: 0 } } };
        },
      },
    };
    expect(await describeQueues(connection as never, "default", ["foundmill"])).toEqual([{ taskQueue: "foundmill", activityPollers: 0, backlogCount: 95, backlogAgeSeconds: 5820 }]);
    expect(asked).toEqual(["foundmill:2:true"]);
    expect(await describeQueues({ workflowService: { describeTaskQueue: async () => Promise.reject(new Error("unavailable")) } } as never, "default", ["foundmill"])).toBeNull();
  });
});

describe("GET /health", () => {
  let server: HealthServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("answers 200 or 503 with the status, and 404 elsewhere", async () => {
    let ok = true;
    let backlogAgeSeconds = 0;
    server = await startHealthServer({ port: 0, hosts: ["127.0.0.1"], log: { info: () => undefined, warn: () => undefined }, status: async () => ({ ...orchestratorHealth({ db: ok, draining: false, workers: [main(1)], queues: [{ taskQueue: "foundmill", activityPollers: 1, backlogCount: 3, backlogAgeSeconds }], now }) }) });
    const base = `http://127.0.0.1:${server.port}`;
    const a = await fetch(`${base}/health`);
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ ok: true, ready: true, service: "orchestrator", workers: [{ taskQueue: "foundmill", freeActivities: 31 }] });
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    // An old backlog fails /health (the monitor) but not /ready (Railway's deploy healthcheck).
    backlogAgeSeconds = 40 * 60;
    expect((await fetch(`${base}/health`)).status).toBe(503);
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    ok = false;
    expect((await fetch(`${base}/health`)).status).toBe(503);
    expect((await fetch(`${base}/ready`)).status).toBe(503);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe("Temporal SDK log lines", () => {
  it("go through pino at their own level (the SDK's default writes every line to stderr)", () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger("orchestrator", "debug", { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) });
    const temporal = temporalLogger(log);
    temporal.info("Worker state changed", { state: "RUNNING" });
    temporal.warn("Activity failed", { activityType: "runAgentSession" });
    temporal.log("ERROR", "Worker failed");
    expect(lines.map((l) => [l.level, l.msg])).toEqual([
      ["info", "Worker state changed"],
      ["warn", "Activity failed"],
      ["error", "Worker failed"],
    ]);
    expect(lines[0]).toMatchObject({ temporal: true, state: "RUNNING" });
  });
});
