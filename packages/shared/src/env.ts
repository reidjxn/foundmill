/** Single place that reads process.env (docs/ARCHITECTURE.md §3). */
import { z } from "zod";

const Env = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  INTEGRATIONS_MODE: z.enum(["mock", "live"]).default("mock"),
  /** Connectors that run live while INTEGRATIONS_MODE is mock, comma-separated (e.g. "github"). */
  LIVE_CONNECTORS: z.string().default(""),
  MODEL_MODE: z.enum(["mock", "live"]).default("mock"),
  /** packages/models: honour `speed: "fast"` on the routes that ask for it (Opus fast mode, beta, 2× price). Off unless "1" or "true". */
  MODEL_FAST_MODE: z.string().optional().transform((v) => v === "1" || v?.trim().toLowerCase() === "true"),
  /** Mock model client only: simulated wait before the first token / first streamed element, in ms (0 = instant, the default). */
  MOCK_MODEL_LATENCY_MS: z.coerce.number().int().min(0).max(600_000).catch(0).default(0),
  /** Mock model client only: simulated writing time per streamed element, in ms (0 = instant, the default). */
  MOCK_MODEL_STREAM_MS: z.coerce.number().int().min(0).max(600_000).catch(0).default(0),
  APP_URL: z.string().default("http://localhost:3000"),
  DATA_REGION: z.enum(["eu", "us"]).default("eu"),
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().optional(),
  API_PORT: z.coerce.number().default(4000),
  GATEWAY_PORT: z.coerce.number().default(4001),
  COMPOSER_PORT: z.coerce.number().default(4002),
  STREAM_PORT: z.coerce.number().default(4003),
  COLLAB_PORT: z.coerce.number().default(4004),
  INGEST_PORT: z.coerce.number().default(4005),
  SOCIAL_PORT: z.coerce.number().default(4006),
  GATEWAY_URL: z.string().default("http://localhost:4001"),
  COMPOSER_URL: z.string().default("http://localhost:4002"),
  INGEST_URL: z.string().default("http://localhost:4005"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  /** apps/api: longest wait at boot for the migration lock (and for table locks a migration needs) before exiting 1 (docs/DEPLOY.md §3). */
  MIGRATION_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).catch(60_000).default(60_000),
  /** Every Node service: time from SIGTERM to exit, draining requests, sockets and workers; keep below railway.toml `drainingSeconds`. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).catch(45_000).default(45_000),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("foundmill"),
  E2B_API_KEY: z.string().optional(),
  BROWSERBASE_API_KEY: z.string().optional(),
  KMS_KEY_ID: z.string().optional(),
  DEV_MASTER_KEY: z.string().optional(),
  SESSION_TOKEN_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * apps/ingest: signing secret of the platform Stripe endpoint for Foundmill's own billing (`POST /billing/stripe`:
   * credit top-ups paid through Checkout). Separate from STRIPE_WEBHOOK_SECRET (the businesses' own Stripe events) so
   * a delivery signed for one can never pass as the other; unset refuses every billing delivery.
   */
  STRIPE_BILLING_WEBHOOK_SECRET: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  /** The GitHub App's URL name (github.com/apps/<slug>): Connect opens its installation page. */
  GITHUB_APP_SLUG: z.string().optional(),
  /** The App's OAuth client: connecting exchanges the code GitHub sends after installing to check who installed it. */
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SEED_OWNER_EMAILS: z.string().optional(),
  /**
   * apps/api: who may use the app, comma-separated emails and `@domain`s (`founder@example.com, @example.org`). When set,
   * every signed-in request from any other account is refused (FORBIDDEN, `not_invited`); unset admits every account
   * that can sign in. Staging sets it while sign-up is open (docs/DEPLOY.md §4).
   */
  SIGNUP_ALLOWLIST: z.string().optional(),
  /** apps/api: build the demo businesses once at boot and give SEED_OWNER_EMAILS owner memberships (docs/DEPLOY.md §3). */
  SEED_ON_BOOT: z.string().optional(),
  /** Seed data volume multiplier (1 = the full two years of history). */
  SEED_VOLUME_SCALE: z.coerce.number().positive().optional(),
  DEV_AUTH_USER_ID: z.string().optional(),
});
export type Env = z.infer<typeof Env>;

let cached: Env | undefined;
export function loadEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = Env.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const env = parsed.data;
  if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    env.DEV_AUTH_USER_ID = undefined; // never honoured outside development/test (docs/DECISIONS.md)
    // Simulated model latency is a development knob: a deployed service's mock client (a live service without its key
    // falls back to it) never waits on purpose.
    env.MOCK_MODEL_LATENCY_MS = 0;
    env.MOCK_MODEL_STREAM_MS = 0;
  }
  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}
export const resetEnvCache = () => { cached = undefined; };
export const isMockIntegrations = (env = loadEnv()) => env.INTEGRATIONS_MODE === "mock";
/** Connectors named in LIVE_CONNECTORS. */
export const liveConnectorKeys = (env: Pick<Env, "LIVE_CONNECTORS">): string[] => env.LIVE_CONNECTORS.split(",").map((k) => k.trim()).filter(Boolean);
/** The mode one connector runs in: live everywhere in live mode, or when LIVE_CONNECTORS names it. */
export const connectorMode = (env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">, connectorKey: string): "mock" | "live" => (env.INTEGRATIONS_MODE === "live" || liveConnectorKeys(env).includes(connectorKey) ? "live" : "mock");
export const isMockModels = (env = loadEnv()) => env.MODEL_MODE === "mock";
export const servicePort = (env: Env, named: "API_PORT" | "GATEWAY_PORT" | "COMPOSER_PORT" | "STREAM_PORT" | "COLLAB_PORT" | "INGEST_PORT" | "SOCIAL_PORT"): number => env.PORT ?? env[named];
