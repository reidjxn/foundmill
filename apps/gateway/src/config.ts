/**
 * Gateway configuration (docs/ARCHITECTURE.md §3, §9). Read once from `loadEnv()`; nothing else in this
 * app touches `process.env`. The session-token secret is the only secret the gateway needs to start; vendor
 * secrets come from `platformSecretsFromEnv()` (packages/connectors) and per-business credentials from the vault.
 */
import { liveConnectorKeys, loadEnv, servicePort, type Env } from "@foundmill/shared";
import type { ConnectorMode } from "@foundmill/connectors";

export interface GatewayConfig {
  appEnv: Env["APP_ENV"];
  /** `PORT` first (Railway), then `GATEWAY_PORT` (4001). Tests pass 0 for an ephemeral port. */
  port: number;
  /** IPv6 wildcard: Railway's private network is IPv6-only (ARCHITECTURE §17). */
  host: string;
  integrationsMode: ConnectorMode;
  /** LIVE_CONNECTORS: connectors that run live while integrationsMode is mock. */
  liveConnectors: string[];
  sessionTokenSecret: string;
  /** Default lifetime of a minted session token. */
  sessionTokenTtlSeconds: number;
  /** Upper bound a caller may ask for. */
  sessionTokenMaxTtlSeconds: number;
  redisUrl: string | undefined;
}

/** Only accepted when APP_ENV is development or test; staging and production must set SESSION_TOKEN_SECRET. */
export const DEV_SESSION_TOKEN_SECRET = "foundmill-dev-session-token-secret-not-for-production";

export const GATEWAY_HOST = "::";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60; // one agent session, one hour
export const MAX_SESSION_TTL_SECONDS = 12 * 60 * 60;

export function gatewayConfig(env: Env = loadEnv()): GatewayConfig {
  const secret = env.SESSION_TOKEN_SECRET?.trim();
  const dev = env.APP_ENV === "development" || env.APP_ENV === "test";
  if (!secret && !dev) throw new Error("SESSION_TOKEN_SECRET is required when APP_ENV is staging or production");
  if (secret && secret.length < 16) throw new Error("SESSION_TOKEN_SECRET must be at least 16 characters");
  return {
    appEnv: env.APP_ENV,
    port: servicePort(env, "GATEWAY_PORT"),
    host: GATEWAY_HOST,
    integrationsMode: env.INTEGRATIONS_MODE,
    liveConnectors: liveConnectorKeys(env),
    sessionTokenSecret: secret ?? DEV_SESSION_TOKEN_SECRET,
    sessionTokenTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    sessionTokenMaxTtlSeconds: MAX_SESSION_TTL_SECONDS,
    redisUrl: env.REDIS_URL,
  };
}
