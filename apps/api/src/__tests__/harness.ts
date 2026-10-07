/**
 * Test harness: PGlite database (packages/db testing), two seeded businesses (A and B) from the RLS fixture, mock
 * model client, in-process composer fallback, a disabled Temporal service and a local vault. `caller(user)` is the
 * in-process tRPC caller for that signed-in user.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import type { Db } from "@foundmill/db";
import { createDefaultRegistry } from "@foundmill/connectors";
import { createModelClient } from "@foundmill/models";
import { createVault, generateMasterKey, loadEnv, resetEnvCache } from "@foundmill/shared";
import { createAuthVerifier } from "../auth";
import type { ApiDeps } from "../context";
import { createCaller } from "../router";
import { createComposerClient } from "../services/composer";
import { silentLog } from "../services/log";
import { createTemporalService, type TemporalClientLike } from "../services/temporal";

export interface ApiHarness {
  h: TestHarness;
  db: Db;
  deps: ApiDeps;
  A: BusinessFixture;
  B: BusinessFixture;
  caller(user: { userId: string; email?: string | null } | null): ReturnType<typeof createCaller>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  prefix: string;
  /** A fake Temporal client; when omitted Temporal is disabled (every call reports queued: false). */
  temporalClient?: TemporalClientLike;
}

export async function createApiHarness(options: HarnessOptions): Promise<ApiHarness> {
  resetEnvCache();
  const env = loadEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock", DEV_MASTER_KEY: generateMasterKey(), KMS_KEY_ID: undefined, DEV_AUTH_USER_ID: undefined, LOG_LEVEL: "silent" });
  const h = await createTestDb();
  const db = h.db as unknown as Db;
  const log = silentLog();
  const models = createModelClient({ mode: "mock", logger: log });
  const temporal = createTemporalService({ address: "127.0.0.1:1", namespace: "default", taskQueue: "test", log, disabled: !options.temporalClient, connect: options.temporalClient ? async () => options.temporalClient! : undefined });
  const composer = createComposerClient({
    url: "http://127.0.0.1:1",
    db,
    models,
    log,
    allowFallback: true,
    fetch: async () => {
      throw new Error("composer service not running in tests");
    },
  });
  const deps: ApiDeps = {
    env,
    db,
    redis: null,
    temporal,
    models,
    composer,
    vault: createVault(env),
    connectors: createDefaultRegistry(),
    auth: createAuthVerifier({ appEnv: "test" }),
    log,
    health: { db: async () => true, redis: async () => false, temporal: () => temporal.reachable() },
  };
  const [A, B] = await Promise.all([createBusinessFixture(h, `${options.prefix}-a`), createBusinessFixture(h, `${options.prefix}-b`)]);
  return {
    h,
    db,
    deps,
    A,
    B,
    caller: (user) => createCaller(deps, user),
    close: () => h.close(),
  };
}

/** A fake Temporal client that records starts and signals (and can be told to fail). */
export function fakeTemporalClient(): TemporalClientLike & { starts: { type: string; workflowId: string; args: unknown[] }[]; signals: { workflowId: string; signal: string; args: unknown[] }[] } {
  const starts: { type: string; workflowId: string; args: unknown[] }[] = [];
  const signals: { workflowId: string; signal: string; args: unknown[] }[] = [];
  return {
    starts,
    signals,
    workflow: {
      async start(type, options) {
        starts.push({ type, workflowId: options.workflowId, args: options.args ?? [] });
        return { workflowId: options.workflowId };
      },
      getHandle(workflowId) {
        return {
          async signal(signal, ...args) {
            signals.push({ workflowId, signal, args });
          },
        };
      },
    },
    connection: { close: async () => undefined },
  };
}
