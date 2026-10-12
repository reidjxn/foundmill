/**
 * Process-wide dependencies for the orchestrator's activities (docs/ARCHITECTURE.md §10).
 *
 * Everything an activity touches comes through this object so tests can swap the database (PGlite), Redis (memory),
 * the model client (mock), the sandbox runner (replay), the gateway/composer (offline) and the clock (fake). Nothing
 * here is imported by workflow code.
 */
import { closeDb, createDb, type Db } from "@foundmill/db";
import { MemoryRedis, type StreamRedis } from "@foundmill/events";
import { createModelClient, effectiveModelMode, type ModelClient, type UsageEvent } from "@foundmill/models";
import { MockSandboxProvider, resolveSandboxProvider, type SandboxMode, type SandboxProvider } from "@foundmill/sandbox";
import { createLogger, type Logger } from "@foundmill/shared/logger";
import { createVault, type Vault } from "@foundmill/shared/crypto";
import { bookUsage } from "@foundmill/db";
import { createBusinessModelClient } from "./models";
import { systemClock, type Clock } from "./clock";
import { createComposerClient, createOfflineComposerClient, type ComposerClient } from "./composer-client";
import { MemoryControlBus, RedisControlBus, type SessionControlBus } from "./control-bus";
import { loadOrchestratorEnv, type OrchestratorEnv } from "./env";
import { createGatewayClient, createOfflineGatewayClient, type GatewayClient } from "./gateway-client";
import { createRedisClient } from "./redis";

export interface OrchestratorDeps {
  env: OrchestratorEnv;
  db: Db;
  /** Session streams `as:{sessionId}`; null disables streaming (never in production). */
  redis: StreamRedis;
  control: SessionControlBus;
  models: ModelClient;
  gateway: GatewayClient;
  composer: ComposerClient;
  /** Resolved lazily so a missing docker daemon is reported per session, not at boot. */
  sandbox: () => Promise<{ provider: SandboxProvider; mode: SandboxMode; fellBackFrom: string | null }>;
  vault: Vault | null;
  clock: Clock;
  log: Logger;
  /** Stop everything this process opened. */
  close(): Promise<void>;
}

export interface CreateDepsOptions {
  env?: OrchestratorEnv;
  db?: Db;
  redis?: StreamRedis;
  control?: SessionControlBus;
  models?: ModelClient;
  gateway?: GatewayClient;
  composer?: ComposerClient;
  sandboxProvider?: SandboxProvider;
  vault?: Vault | null;
  clock?: Clock;
  log?: Logger;
}

/**
 * Book every model call (tokens) to the usage ledger when it carries a business attribution (BUILD §9.3, §10.4): billed
 * to whoever's key answered (`event.billedTo`, byok for a business routed onto its own key by `createBusinessModelClient`)
 * and, for credits, charged to the period's balance through `bookUsage`.
 */
export function usageSink(db: Db, log: Logger): (event: UsageEvent) => Promise<void> {
  return async (event) => {
    const a = event.attribution;
    if (!a?.businessId) return;
    try {
      await bookUsage(db, a.businessId, {
        agentId: a.agentId ?? null,
        sessionId: a.sessionId ?? null,
        kind: "tokens",
        modelKey: event.modelKey,
        quantity: event.usage.inputTokens + event.usage.outputTokens,
        unit: "tokens",
        costMinor: Math.max(0, event.cost.costMinorInt),
        currency: event.cost.currency,
        billedTo: event.billedTo,
        occurredAt: event.occurredAt,
        // A call stopped in flight keeps `aborted`: its tokens are an Estimate as well as its price.
        details: { route: event.route, model: event.model, mode: event.mode, kind: a.kind ?? null, taskId: a.taskId ?? null, label: event.cost.label, attempt: event.attempt, ...(event.aborted ? { aborted: true } : {}) },
      });
    } catch (err) {
      log.warn({ err: (err as Error).message, route: event.route }, "usage ledger write failed");
    }
  };
}

export function createDeps(options: CreateDepsOptions = {}): OrchestratorDeps {
  const env = options.env ?? loadOrchestratorEnv();
  const log = options.log ?? createLogger("orchestrator", env.LOG_LEVEL);
  const closers: (() => Promise<unknown>)[] = [];

  let db: Db;
  if (options.db) db = options.db;
  else if (env.DATABASE_URL) {
    // postgres.js or PGlite, decided by the URL (`pglite:<dir>`); closeDb ends either. Readiness (boot, migrations on
    // PGlite, a locked directory) is settled once in main() through prepareDb (./db-boot).
    const service = createDb(env.DATABASE_URL, { max: 10 });
    db = service;
    closers.push(() => closeDb(service));
  } else {
    log.error({}, "DATABASE_URL is not set; activities that touch the database will fail");
    db = createDb("postgres://invalid@127.0.0.1:1/invalid", { max: 1 }) as unknown as Db;
  }

  let redis: StreamRedis;
  let control: SessionControlBus;
  if (options.redis) {
    redis = options.redis;
    control = options.control ?? new MemoryControlBus();
  } else if (env.APP_ENV === "test") {
    redis = new MemoryRedis();
    control = options.control ?? new MemoryControlBus();
  } else {
    // main() probes Redis first and passes the memory pair when it is unreachable in development (./redis).
    const client = createRedisClient(env.REDIS_URL, log);
    redis = client as unknown as StreamRedis;
    control = options.control ?? new RedisControlBus(client);
    closers.push(() => client.quit().catch(() => undefined));
  }

  let vault: Vault | null = options.vault === undefined ? null : options.vault;
  if (options.vault === undefined) {
    try {
      vault = createVault(env);
    } catch (err) {
      log.warn({ err: (err as Error).message }, "vault not configured; businesses on their own key are refused until one is set");
    }
  }

  // The platform client (platform key, books to credits), wrapped so a business on its own key runs on that key.
  const modelMode = options.models?.mode ?? effectiveModelMode(env.MODEL_MODE, env.ANTHROPIC_API_KEY, log);
  const onUsage = usageSink(db, log);
  const platformModels =
    options.models ??
    createModelClient({
      mode: modelMode,
      apiKey: env.ANTHROPIC_API_KEY,
      onUsage,
      logger: log,
    });
  const models = createBusinessModelClient(platformModels, { db, vault, mode: modelMode, onUsage, logger: log });

  const gateway =
    options.gateway ??
    (env.SESSION_TOKEN_SECRET
      ? createGatewayClient({ baseUrl: env.GATEWAY_URL, serviceSecret: env.SESSION_TOKEN_SECRET, serviceName: "orchestrator" })
      : (() => {
          if (env.INTEGRATIONS_MODE === "live") log.error({}, "SESSION_TOKEN_SECRET is not set; live sessions cannot mint gateway tokens");
          return createOfflineGatewayClient(env.GATEWAY_URL);
        })());

  const composer = options.composer ?? (env.COMPOSER_URL ? createComposerClient({ baseUrl: env.COMPOSER_URL, timeoutMs: env.COMPOSER_TIMEOUT_MS }) : createOfflineComposerClient());

  let resolved: Promise<{ provider: SandboxProvider; mode: SandboxMode; fellBackFrom: string | null }> | null = null;
  const sandbox = () => {
    if (!resolved) {
      resolved = options.sandboxProvider
        ? Promise.resolve({ provider: options.sandboxProvider, mode: options.sandboxProvider.mode, fellBackFrom: null })
        : resolveSandboxProvider({
            mode: env.SANDBOX_MODE,
            env: { INTEGRATIONS_MODE: env.INTEGRATIONS_MODE, E2B_API_KEY: env.E2B_API_KEY },
            providers: { mock: new MockSandboxProvider({ speed: env.mockSessionSpeed, autoplay: false, holds: "as_recorded" }) },
          }).then((r) => ({ provider: r.provider, mode: r.mode, fellBackFrom: r.fellBackFrom }));
      resolved.catch(() => {
        resolved = null; // retry next session
      });
    }
    return resolved;
  };

  return {
    env,
    db,
    redis,
    control,
    models,
    gateway,
    composer,
    sandbox,
    vault,
    clock: options.clock ?? systemClock,
    log,
    async close() {
      for (const c of closers.reverse()) {
        try {
          await c();
        } catch {
          /* best effort */
        }
      }
    },
  };
}
