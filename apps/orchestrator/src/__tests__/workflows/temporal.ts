/**
 * Shared Temporal test rig: one time-skipping test server per suite file (the binary is cached after the first
 * download), a worker on an ephemeral task queue bundling the real workflow code, and whatever activities the test
 * supplies (mocks or the real ones on PGlite). Nothing listens on a fixed port.
 */
import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";
import type { Client } from "@temporalio/client";
import { WORKFLOWS_PATH } from "../../index";

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

export interface TemporalRig {
  env: TestWorkflowEnvironment;
  client: Client;
  /** Run `fn` while a worker with these activities polls a fresh task queue. */
  run<T>(activities: object, fn: (client: Client, taskQueue: string) => Promise<T>): Promise<T>;
  teardown(): Promise<void>;
}

export async function createTemporalRig(): Promise<TemporalRig> {
  quietRuntime();
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  return {
    env,
    client: env.client,
    async run(activities, fn) {
      const taskQueue = `test-${randomUUID().slice(0, 8)}`;
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowsPath: WORKFLOWS_PATH,
        activities,
        maxConcurrentActivityTaskExecutions: 8,
        maxConcurrentWorkflowTaskExecutions: 8,
        reuseV8Context: true,
      });
      return worker.runUntil(fn(env.client, taskQueue));
    },
    teardown: () => env.teardown(),
  };
}

export const wfId = (prefix: string) => `${prefix}:${randomUUID()}`;
