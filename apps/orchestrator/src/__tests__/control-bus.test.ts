/**
 * Session control under a Redis outage and the worker setup around it (O-10, O-24): the Redis bus keeps the commands
 * it popped before a failure, numbered commands survive the round trip, a stray rejection is logged instead of ending
 * the process, the two workers stop together, and the session knobs have their documented defaults.
 */
import type { Worker } from "@temporalio/worker";
import { describe, expect, it, vi } from "vitest";
import { parseCommand, RedisControlBus, type ControlRedis } from "../control-bus";
import { loadOrchestratorEnv } from "../env";
import { installRejectionLogger, runWorkers } from "../index";
import { sessionTaskQueue } from "../session-contract";

/** A Redis list that fails every call while `down` is set, the way ioredis rejects with MaxRetriesPerRequestError. */
function flakyRedis(items: string[]): ControlRedis & { down: boolean } {
  const state = { down: false };
  const guard = () => {
    if (state.down) throw Object.assign(new Error("Reached the max retries per request limit (which is 3)."), { name: "MaxRetriesPerRequestError" });
  };
  return {
    get down() {
      return state.down;
    },
    set down(v: boolean) {
      state.down = v;
    },
    async rpush(_key, ...values) {
      guard();
      items.push(...values);
      return items.length;
    },
    async lpop() {
      guard();
      const next = items.shift() ?? null;
      // The outage starts right after the second command is popped.
      if (items.length === 1) state.down = true;
      return next;
    },
    async del() {
      guard();
      items.length = 0;
      return 1;
    },
  };
}

describe("RedisControlBus under an outage", () => {
  it("returns the commands it popped before Redis failed, and fails only when it popped nothing", async () => {
    const items = [{ kind: "pause", seq: 0 }, { kind: "shout", message: "Simplify", seq: 1 }, { kind: "resume", seq: 2 }].map((c) => JSON.stringify(c));
    const redis = flakyRedis(items);
    const bus = new RedisControlBus(redis);
    expect(await bus.drain("s1")).toEqual([
      { kind: "pause", seq: 0 },
      { kind: "shout", message: "Simplify", seq: 1 },
    ]);
    await expect(bus.drain("s1")).rejects.toThrow(/max retries/);
    redis.down = false;
    expect(await bus.drain("s1")).toEqual([{ kind: "resume", seq: 2 }]);
  });

  it("keeps the workflow's sequence number on every command, a defaulted stop included", () => {
    expect(parseCommand(JSON.stringify({ kind: "decision", approvalId: "a", outcome: "approved", seq: 4 }))).toMatchObject({ kind: "decision", seq: 4 });
    expect(parseCommand(JSON.stringify({ kind: "stop", seq: 7 }))).toEqual({ kind: "stop", reason: "stopped", by: null, seq: 7 });
  });
});

describe("worker process", () => {
  it("logs a promise rejection nobody handled instead of letting it end the worker", () => {
    const log = { error: vi.fn() };
    const before = process.listeners("unhandledRejection").length;
    const uninstall = installRejectionLogger(log as never);
    try {
      const listener = process.listeners("unhandledRejection").at(-1)!;
      listener(Object.assign(new Error("Reached the max retries per request limit (which is 3)."), { name: "MaxRetriesPerRequestError" }), Promise.resolve());
      expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.stringMatching(/max retries/) }), expect.stringMatching(/keeps running/));
    } finally {
      uninstall();
    }
    expect(process.listeners("unhandledRejection")).toHaveLength(before);
  });

  it("stops every worker when one stops, and reports the one that failed", async () => {
    const fake = (fails: boolean) => {
      let state = "RUNNING";
      let release!: () => void;
      const stopped = new Promise<void>((r) => (release = r));
      return {
        getState: () => state,
        shutdown: () => {
          state = "STOPPED";
          release();
        },
        run: async () => {
          if (fails) {
            state = "FAILED";
            throw new Error("poller failed");
          }
          await stopped;
        },
      };
    };
    const sessions = fake(true);
    const main = fake(false);
    await expect(runWorkers([main, sessions] as unknown as Worker[])).rejects.toThrow("poller failed");
    expect(main.getState()).toBe("STOPPED");
  });

  it("puts sessions on their own queue and has the documented defaults for the session knobs", () => {
    expect(sessionTaskQueue("foundmill")).toBe("foundmill-sessions");
    const env = loadOrchestratorEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" });
    expect(env).toMatchObject({ ORCHESTRATOR_MAX_ACTIVITIES: 32, ORCHESTRATOR_MAX_SESSIONS: 16, APPROVAL_WAIT_MINUTES: 30, SESSION_PAUSE_HOLD_MINUTES: 10 });
    const custom = loadOrchestratorEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock", ORCHESTRATOR_MAX_SESSIONS: "4", APPROVAL_WAIT_MINUTES: "5", SESSION_PAUSE_HOLD_MINUTES: "2" });
    expect(custom).toMatchObject({ ORCHESTRATOR_MAX_SESSIONS: 4, APPROVAL_WAIT_MINUTES: 5, SESSION_PAUSE_HOLD_MINUTES: 2 });
  });
});
