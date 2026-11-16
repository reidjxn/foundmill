/**
 * Gateway configuration (docs/ARCHITECTURE.md §3, §9). Read once from `loadEnv()` (and NODE_ENV); nothing else in
 * this app touches `process.env`. The session-token secret is the only secret the gateway needs to start; vendor
 * secrets come from `platformSecretsFromEnv()` (packages/connectors) and per-business credentials from the vault.
 */
import { randomBytes } from "node:crypto";
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
  /** API_SERVICE_TOKEN_SECRET: the api's own; null while it signs with the shared one (WP-11 T12). */
  apiServiceTokenSecret: string | null;
  /** API_SERVICE_TOKEN_LEGACY=1: the api may still sign with the shared secret during the switch. */
  apiServiceTokenLegacy: boolean;
  /** Default lifetime of a minted session token. */
  sessionTokenTtlSeconds: number;
  /** Upper bound a caller may ask for. */
  sessionTokenMaxTtlSeconds: number;
  redisUrl: string | undefined;
}

/**
 * The key an explicit local or test run without SESSION_TOKEN_SECRET verifies tokens with: random, for this process
 * only, so no token signed elsewhere is accepted (the api, the orchestrator and ingest do not call without the secret
 * anyway). Until Nov 13, 2026 this was a fixed string in the repository.
 */
const PROCESS_SESSION_TOKEN_SECRET = randomBytes(32).toString("base64url");

export const GATEWAY_HOST = "::";
export const API_SERVICE_TOKEN_MIN_LENGTH = 32;
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60; // one agent session, one hour
export const MAX_SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * `nodeEnv` is the process's NODE_ENV: the image sets `production`, and a deployed process needs the secret whatever its
 * APP_ENV says. Only an explicit local or test run (APP_ENV development or test, NODE_ENV not production) starts
 * without it.
 */
export function gatewayConfig(env: Env = loadEnv(), nodeEnv: string | undefined = process.env.NODE_ENV): GatewayConfig {
  const secret = env.SESSION_TOKEN_SECRET?.trim();
  const localRun = (env.APP_ENV === "development" || env.APP_ENV === "test") && nodeEnv !== "production";
  if (!secret && !localRun) throw new Error("SESSION_TOKEN_SECRET is required unless APP_ENV is development or test in a local run (NODE_ENV not production)");
  if (secret && secret.length < 16) throw new Error("SESSION_TOKEN_SECRET must be at least 16 characters");
  const apiSecret = env.API_SERVICE_TOKEN_SECRET?.trim() || null;
  if (apiSecret && apiSecret.length < API_SERVICE_TOKEN_MIN_LENGTH) throw new Error(`API_SERVICE_TOKEN_SECRET must be at least ${API_SERVICE_TOKEN_MIN_LENGTH} characters`);
  // The same value as the shared secret would let every holder of it pass as the api, and refuse everyone else.
  if (apiSecret && apiSecret === secret) throw new Error("API_SERVICE_TOKEN_SECRET must differ from SESSION_TOKEN_SECRET");
  return {
    appEnv: env.APP_ENV,
    port: servicePort(env, "GATEWAY_PORT"),
    host: GATEWAY_HOST,
    integrationsMode: env.INTEGRATIONS_MODE,
    liveConnectors: liveConnectorKeys(env),
    sessionTokenSecret: secret || PROCESS_SESSION_TOKEN_SECRET,
    apiServiceTokenSecret: apiSecret,
    apiServiceTokenLegacy: env.API_SERVICE_TOKEN_LEGACY?.trim() === "1",
    sessionTokenTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    sessionTokenMaxTtlSeconds: MAX_SESSION_TTL_SECONDS,
    redisUrl: env.REDIS_URL,
  };
}
