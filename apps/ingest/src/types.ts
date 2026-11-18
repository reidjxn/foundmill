/**
 * Shared types for the ingest service (docs/ARCHITECTURE.md §1 "apps/ingest", BUILD §13.1, §14).
 */
import type { Db } from "@foundmill/db";
import type { ConnectorMode, ConnectorRegistry } from "@foundmill/connectors";
import type { IngestFollowups } from "./followups";
import type { NonceStore } from "./nonce-store";
import type { IngestPlatformMailConfig } from "./platform-mail";

/** Minimal structural logger; pino's `Logger` satisfies it, tests pass a silent one. */
export interface IngestLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const silentLogger: IngestLogger = { debug() {}, info() {}, warn() {}, error() {} };

export interface IngestDeps {
  db: Db;
  registry: ConnectorRegistry;
  /** `INTEGRATIONS_MODE`: which side of every connector the webhooks come from. */
  mode: ConnectorMode;
  /** `LIVE_CONNECTORS`: connectors whose live webhook is mounted while `mode` is mock. */
  liveConnectors: readonly string[];
  nonces: NonceStore;
  log: IngestLogger;
  /** Injectable clock (the mock connectors sign deliveries at `MOCK_NOW`; tests pin the ingest clock to it too). */
  now: () => Date;
  /** Seconds a delivery's own timestamp may differ from `now` before it is refused as stale (BUILD §14 "timestamp window"). */
  replayWindowSeconds: number;
  /** How long a verified delivery id is remembered (nonce TTL). */
  nonceTtlMs: number;
  /** `PAID_ENTRY` (WP-09 T16): sign-up is paid entry, so an owner's credit pack also removes the "Built on" mark. */
  paidEntry?: boolean;
  /** Environment facts the routes need (the Simulate gate reads these). */
  env: { APP_ENV: "development" | "test" | "staging" | "production" };
  /** Whether the dev-only Simulate panel is enabled (`FLAGS.devSimulatePanel` and APP_ENV development/staging). */
  simulateEnabled: boolean;
  /**
   * `SESSION_TOKEN_SECRET`: every Simulate request must carry a service JWT apps/api minted with it
   * (docs/SECURITY_REVIEW.md SEC-2). Null means the routes refuse every request (401), never that they open up.
   */
  simulateTokenSecret: string | null;
  /**
   * `STRIPE_BILLING_WEBHOOK_SECRET`: the platform Stripe endpoint for Foundmill's own billing (`POST /billing/stripe`,
   * billing.ts) verifies with it. Null (or absent) refuses every billing delivery (503), in every mode.
   */
  billingWebhookSecret?: string | null;
  /** After-commit work: narrating a customer won, journeyBuild, playbooks (`followups.ts`). */
  followups: IngestFollowups;
  /** A project's Foundmill sending address: replies, delivery events and unsubscribes (`platform-mail.ts`). Absent = off. */
  platformMail?: IngestPlatformMailConfig;
}

export const INGEST_SERVICE = "ingest";
