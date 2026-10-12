/**
 * Shared Temporal test rig: one time-skipping test server per suite file (the binary is cached after the first
 * download), a worker on an ephemeral task queue bundling the real workflow code, and whatever activities the test
 * supplies (mocks or the real ones on PGlite). As in production, `runAgentSession` runs only on a second worker on the
 * sessions task queue (`<queue>-sessions`); the main worker does not register it, so a session run that lands on the
 * main queue never completes and the test shows it. Nothing listens on a fixed port.
 */
import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import type { Client } from "@temporalio/client";
import { WORKFLOWS_PATH } from "../../index";
import { sessionTaskQueue } from "../../session-contract";

// Keep the worker's bundle/state chatter out of the test output; warnings and errors still show.
let runtimeInstalled = false;
function quietRuntime(): void {
  if (runtimeInstalled) return;
  runtimeInstalled = true;
  try {
    Runtime.install({ logger: new DefaultLogger("WARN"), telemetryOptions: { logging: { forward: {}, filter: "WARN" } } });
  } catch {
    /* already installed by another rig in this process */
  }
}

export interface RigOptions {
  /** Slots on the main worker (default 8). */
  maxActivities?: number;
  /** Slots on the sessions worker (default 8). */
  maxSessions?: number;
}

export interface TemporalRig {
  env: TestWorkflowEnvironment;
  client: Client;
  /** Run `fn` while a worker with these activities polls a fresh task queue (and a sessions worker its sessions queue). */
  run<T>(activities: object, fn: (client: Client, taskQueue: string) => Promise<T>, options?: RigOptions): Promise<T>;
  teardown(): Promise<void>;
}

export async function createTemporalRig(): Promise<TemporalRig> {
  quietRuntime();
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  return {
    env,
    client: env.client,
    async run(activities, fn, options = {}) {
      const taskQueue = `test-${randomUUID().slice(0, 8)}`;
      const { runAgentSession, ...rest } = activities as { runAgentSession?: unknown } & Record<string, unknown>;
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowsPath: WORKFLOWS_PATH,
        activities: rest,
        maxConcurrentActivityTaskExecutions: options.maxActivities ?? 8,
        maxConcurrentWorkflowTaskExecutions: 8,
        reuseV8Context: true,
      });
      if (!runAgentSession) return worker.runUntil(fn(env.client, taskQueue));
      const sessions = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: sessionTaskQueue(taskQueue),
        activities: { runAgentSession },
        maxConcurrentActivityTaskExecutions: options.maxSessions ?? 8,
      });
      return worker.runUntil(sessions.runUntil(fn(env.client, taskQueue)));
    },
    teardown: () => env.teardown(),
  };
}

export const wfId = (prefix: string) => `${prefix}:${randomUUID()}`;
