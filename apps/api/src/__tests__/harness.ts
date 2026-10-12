/**
 * Test harness: PGlite database (packages/db testing), two seeded businesses (A and B) from the RLS fixture, the mock
 * model client wired as in production (calls made for a business are booked to its usage ledger), in-process composer
 * fallback, a disabled Temporal service and a local vault. `caller(user)` is the in-process tRPC caller for that
 * signed-in user.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import type { Db } from "@foundmill/db";
import type { StreamRedis } from "@foundmill/events";
import { createDefaultRegistry } from "@foundmill/connectors";
import { loadEnv, resetEnvCache } from "@foundmill/shared";
import { createVault, generateMasterKey } from "@foundmill/shared/crypto";
import { createAuthVerifier } from "../auth";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { createComposerClient } from "../services/composer";
import { createApiModelClient } from "../services/models";
import type { ApiGatewayClient } from "../services/gateway";
import { silentLog } from "../services/log";
import { MemoryRateLimitStore } from "../services/rate-limit";
import type { RecordingResolver } from "../services/replay";
import { createIngestClient } from "../services/simulate";
import { createTemporalService, type TemporalClientLike } from "../services/temporal";

/** The `SESSION_TOKEN_SECRET` the test api mints simulate tokens with (never a real one). */
export const TEST_SESSION_TOKEN_SECRET = "api-test-session-token-secret";

export interface ApiHarness {
  h: TestHarness;
  db: Db;
  deps: ApiDeps;
  /** The deps' allowance windows (in memory): tests fill or reset them. */
  limits: MemoryRateLimitStore;
  A: BusinessFixture;
  B: BusinessFixture;
  caller(user: CallerUser | null): ReturnType<typeof createCaller>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  prefix: string;
  /** A fake Temporal client; when omitted Temporal is disabled (every call reports queued: false). */
  temporalClient?: TemporalClientLike;
  /** Session stream backend for replay tests (MemoryRedis from @foundmill/events); default none. */
  redis?: StreamRedis | null;
  /** Recording resolver for replay tests; default none. */
  recordings?: RecordingResolver | null;
  /** Stands in for apps/ingest in `dev.simulate` tests; default: every call fails as unreachable. */
  ingestFetch?: typeof globalThis.fetch;
  /** Stands in for apps/gateway (App connectors' connect and health); default: every call fails as unreachable. */
  gateway?: ApiGatewayClient;
  /** Env overrides (e.g. LIVE_CONNECTORS) on top of the test environment. */
  env?: Partial<NodeJS.ProcessEnv>;
}

export async function createApiHarness(options: HarnessOptions): Promise<ApiHarness> {
  resetEnvCache();
  const env = loadEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock", DEV_MASTER_KEY: generateMasterKey(), KMS_KEY_ID: undefined, DEV_AUTH_USER_ID: undefined, LOG_LEVEL: "silent", SESSION_TOKEN_SECRET: TEST_SESSION_TOKEN_SECRET, INGEST_URL: "http://ingest.test", ...options.env });
  const h = await createTestDb();
  const db = h.db as unknown as Db;
  const log = silentLog();
  // The production wiring: calls made for a business are booked to its usage ledger.
  const models = createApiModelClient(env, log, { db });
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
  const limits = new MemoryRateLimitStore();
  const deps: ApiDeps = {
    env,
    db,
    redis: options.redis ?? null,
    limits,
    temporal,
    models,
    composer,
    vault: createVault(env),
    connectors: createDefaultRegistry(),
    auth: createAuthVerifier({ appEnv: "test" }),
    log,
    recordings: options.recordings ?? null,
    ingest: createIngestClient({
      url: env.INGEST_URL,
      secret: env.SESSION_TOKEN_SECRET ?? null,
      fetch:
        options.ingestFetch ??
        (async () => {
          throw new Error("ingest service not running in tests");
        }),
    }),
    gateway: options.gateway ?? {
      connect: async () => {
        throw new Error("gateway not running in tests");
      },
      health: async () => {
        throw new Error("gateway not running in tests");
      },
      // What the gateway's Stripe connector answers in mock mode: a simulated session that returns to Billing.
      createCheckout: async (input) => ({ mode: "mock", session: { id: `cs_mock_${input.checkoutId.replace(/-/g, "").slice(0, 20)}`, url: input.successUrl, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), amountTotalMinor: input.amountMinor, currency: "USD" } }),
    },
    health: { db: async () => true, redis: async () => false, temporal: () => temporal.reachable() },
  };
  const [A, B] = await Promise.all([createBusinessFixture(h, `${options.prefix}-a`), createBusinessFixture(h, `${options.prefix}-b`)]);
  return {
    h,
    db,
    deps,
    limits,
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
