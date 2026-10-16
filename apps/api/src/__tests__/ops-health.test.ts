/**
 * What an operator relies on to see the platform's state:
 * - the outbox relay starts as soon as Redis answers, however late (CDD-7), and /health says where it is;
 * - /health reports the model mode the api actually serves (api-services-26);
 * - /health and a monitor report an orchestrator that stopped taking work (SOAK-06);
 * - a deployed api says when a private service address is still on localhost (CDD-8).
 */
import type { OutboxRelay } from "@foundmill/events";
import { createModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { warnLocalhostUrls } from "../index";
import { superviseOutboxRelay } from "../services/relay";
import { createTemporalService, type DescribeTaskQueueAnswer, type TemporalClientLike } from "../services/temporal";
import { BACKLOG_ALERT_SECONDS, monitorWorker, workerVerdict } from "../services/worker-health";
import { createApiHarness, type ApiHarness } from "./harness";

describe("outbox relay supervisor", () => {
  it("keeps trying with a capped backoff until Redis answers, then starts the relay once", async () => {
    vi.useFakeTimers();
    try {
      let up = false;
      const started: OutboxRelay[] = [];
      const log = { warn: vi.fn(), info: vi.fn() };
      const relay = superviseOutboxRelay({ db: {} as never, redis: null, log: log as never, env: { REDIS_URL: "redis://user:pw@redis:6379" } as never }, {
        reachable: async () => up,
        start: () => {
          const r = { stop: vi.fn(async () => undefined) } as unknown as OutboxRelay;
          started.push(r);
          return r;
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(relay.status()).toMatchObject({ state: "waiting_for_redis", attempts: 1, since: null });
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.warn.mock.calls[0])).not.toContain("pw@");
      await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
      expect(relay.status()).toMatchObject({ state: "waiting_for_redis", attempts: 4 });
      up = true;
      await vi.advanceTimersByTimeAsync(8_000);
      expect(relay.status()).toMatchObject({ state: "running", attempts: 5 });
      expect(started).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(started).toHaveLength(1);
      await relay.stop();
      expect(relay.status().state).toBe("stopped");
      expect(started[0]!.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops trying once shut down", async () => {
    vi.useFakeTimers();
    try {
      const reachable = vi.fn(async () => false);
      const relay = superviseOutboxRelay({ db: {} as never, redis: null, log: { warn: vi.fn(), info: vi.fn() } as never, env: { REDIS_URL: "redis://r" } as never }, { reachable, start: () => ({ stop: async () => undefined }) as unknown as OutboxRelay });
      await vi.advanceTimersByTimeAsync(0);
      await relay.stop();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reachable).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("orchestrator worker verdict", () => {
  const q = (taskQueue: string, activityPollers: number, backlogCount: number | null, backlogAgeSeconds: number | null) => ({ taskQueue, activityPollers, backlogCount, backlogAgeSeconds });

  it("is healthy while activities are taken in time", () => {
    expect(workerVerdict([q("foundmill", 1, 3, 2), q("foundmill-sessions", 1, 0, 0)], "foundmill")).toMatchObject({ ok: true, reasons: [] });
  });

  it("fails on an old backlog or on waiting work nobody polls for (the 2026-10-11 wedge)", () => {
    const wedged = workerVerdict([q("foundmill", 0, 95, 97 * 60), q("foundmill-sessions", 1, 0, 0)], "foundmill");
    expect(wedged.ok).toBe(false);
    expect(wedged.reasons.join(" ")).toContain("97 min");
    expect(wedged.reasons.join(" ")).toContain("no worker polling");
    // Sessions may wait longer for a free slot than the main queue's work.
    expect(workerVerdict([q("foundmill-sessions", 1, 2, BACKLOG_ALERT_SECONDS.main + 60)], "foundmill").ok).toBe(true);
    expect(workerVerdict([q("foundmill-sessions", 1, 2, BACKLOG_ALERT_SECONDS.sessions + 60)], "foundmill").ok).toBe(false);
  });

  it("the monitor logs an error when the worker stalls, repeats it while it lasts, and says when it recovers", async () => {
    let answer = [q("foundmill", 0, 40, 600)];
    let t = 0;
    const log = { error: vi.fn(), info: vi.fn() };
    const monitor = monitorWorker({ temporal: { taskQueues: async () => answer }, log, taskQueue: "foundmill" }, { intervalMs: 3_600_000, repeatMs: 900_000, now: () => t });
    try {
      await monitor.tick();
      t += 60_000;
      await monitor.tick();
      expect(log.error).toHaveBeenCalledTimes(1);
      t += 900_000;
      await monitor.tick();
      expect(log.error).toHaveBeenCalledTimes(2);
      answer = [q("foundmill", 1, 0, 0)];
      await monitor.tick();
      expect(log.info).toHaveBeenCalledTimes(1);
    } finally {
      monitor.stop();
    }
  });

  it("reads pollers and backlog from Temporal's DescribeTaskQueue for both queues", async () => {
    const asked: string[] = [];
    const client: TemporalClientLike = {
      workflow: { start: async () => undefined, getHandle: () => ({ signal: async () => undefined }) },
      workflowService: {
        async describeTaskQueue(req): Promise<DescribeTaskQueueAnswer> {
          asked.push(`${req.taskQueue.name}:${req.taskQueueType}:${req.reportStats}`);
          return req.taskQueue.name === "foundmill" ? { pollers: [], stats: { approximateBacklogCount: { toString: () => "95" }, approximateBacklogAge: { seconds: { toString: () => "5820" }, nanos: 500_000_000 } } } : { pollers: [{}], stats: null };
        },
      },
    };
    const temporal = createTemporalService({ address: "x", namespace: "default", taskQueue: "foundmill", log: { warn: vi.fn() } as never, connect: async () => client });
    expect(await temporal.taskQueues!()).toEqual([
      { taskQueue: "foundmill", activityPollers: 0, backlogCount: 95, backlogAgeSeconds: 5820.5 },
      { taskQueue: "foundmill-sessions", activityPollers: 1, backlogCount: null, backlogAgeSeconds: null },
    ]);
    expect(asked).toEqual(["foundmill:2:true", "foundmill-sessions:2:true"]);
  });
});

describe("GET /health", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "opshealth" });
  }, 120_000);
  afterAll(() => hz.close());

  it("reports the model mode the api serves, and a missing key, rather than MODEL_MODE", async () => {
    const live = createApp({ ...hz.deps, env: { ...hz.deps.env, MODEL_MODE: "live", ANTHROPIC_API_KEY: undefined }, models: createModelClient({ mode: "mock" }) });
    expect(await (await live.request("/health")).json()).toMatchObject({ ok: true, modes: { models: "mock" }, modelKeyMissing: true });
    expect(await (await createApp(hz.deps).request("/health")).json()).toMatchObject({ modes: { models: "mock" }, modelKeyMissing: false });
  });

  it("reports the relay's state and the orchestrator's worker without failing readiness", async () => {
    const relay = { status: () => ({ state: "waiting_for_redis" as const, attempts: 7, since: null }), wake: () => undefined, stop: async () => undefined };
    const temporal = { ...hz.deps.temporal, taskQueues: async () => [{ taskQueue: "test", activityPollers: 0, backlogCount: 12, backlogAgeSeconds: 3_600 }] };
    const res = await createApp({ ...hz.deps, relay, temporal }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, relay: { state: "waiting_for_redis", attempts: 7 }, worker: { ok: false, queues: [{ taskQueue: "test", backlogCount: 12 }] } });
    // Without Temporal there is no verdict, not a false alarm.
    expect(await (await createApp(hz.deps).request("/health")).json()).toMatchObject({ relay: null, worker: null });
  });
});

describe("private service addresses", () => {
  it("logs an error per address still on localhost in staging and production only", () => {
    const log = { error: vi.fn() };
    const env = { APP_ENV: "staging", INGEST_URL: "http://localhost:4005", GATEWAY_URL: "http://gateway.railway.internal:4001", COMPOSER_URL: "http://127.0.0.1:4002" };
    expect(warnLocalhostUrls({ env: env as never, log: log as never })).toEqual(["INGEST_URL", "COMPOSER_URL"]);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error.mock.calls[0]![1]).toContain("INGEST_URL is not set for staging");
    expect(warnLocalhostUrls({ env: { ...env, APP_ENV: "development" } as never, log: log as never })).toEqual([]);
  });
});

