/** Single place that reads process.env (docs/ARCHITECTURE.md §3). */
import { z } from "zod";

const Env = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  INTEGRATIONS_MODE: z.enum(["mock", "live"]).default("mock"),
  /** Connectors that run live while INTEGRATIONS_MODE is mock, comma-separated (e.g. "github"). */
  LIVE_CONNECTORS: z.string().default(""),
  MODEL_MODE: z.enum(["mock", "live"]).default("mock"),
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
  if (env.DEV_AUTH_USER_ID && env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    env.DEV_AUTH_USER_ID = undefined; // never honoured outside development/test (docs/DECISIONS.md)
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
