/**
 * Wire types of the gateway (docs/ARCHITECTURE.md §9). Shared by the Hono routes, the MCP bridge and the
 * client SDK so the orchestrator and the api speak exactly what the server validates.
 */
import { z } from "zod";
import { POLICY_OUTCOMES } from "@foundmill/shared";
import type { HumanActionDescriptor, ToolError, UntrustedSource } from "@foundmill/connectors";
import { SessionClaims } from "./tokens";

const Id = z.guid();

export const CallContextInput = z.object({
  /** Spend the call would commit, in minor units of `currency`. */
  amountMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  /** Explicit counterparty (email, URL or phone) when the tool arguments do not carry it. */
  recipient: z.string().min(1).max(500).optional(),
  recipientCountry: z.string().length(2).optional(),
  localTimeAtRecipient: z.string().min(1).max(40).optional(),
  /** Optional plan action this call executes; links the approval to the plan. */
  planActionId: Id.optional(),
});
export type CallContextInput = z.input<typeof CallContextInput>;

export const CallRequest = z.object({
  connector: z.string().min(1).max(60),
  tool: z.string().min(1).max(120),
  args: z.unknown().optional(),
  context: CallContextInput.prefault({}),
});
export type CallRequestInput = z.input<typeof CallRequest>;
export type CallRequestParsed = z.infer<typeof CallRequest>;

/** Most recipients a mint request may seed per kind; past it the orchestrator sends `all` instead. */
export const MAX_SEEDED_RECIPIENTS = 5_000;

/**
 * Recipients a session must treat as first seen in untrusted content from its first call: what the orchestrator found
 * in files an earlier session left in the workspace (a restored code task), which may have come from untrusted
 * content in that session. `all` marks every recipient of the session, for when there are too many to list.
 */
export const UntrustedSeed = z.object({
  emails: z.array(z.string().max(320)).max(MAX_SEEDED_RECIPIENTS).default([]),
  urls: z.array(z.string().max(2048)).max(MAX_SEEDED_RECIPIENTS).default([]),
  phones: z.array(z.string().max(40)).max(MAX_SEEDED_RECIPIENTS).default([]),
  all: z.boolean().default(false),
});
export type UntrustedSeed = z.input<typeof UntrustedSeed>;

/** Service call: connect an App connector (GitHub) for a business; its keys live only in the gateway. */
export const ConnectIntegrationRequest = z.object({
  businessId: z.uuid(),
  connector: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type ConnectIntegrationRequest = z.input<typeof ConnectIntegrationRequest>;

/** Service call: health of a business's App connector integration. */
export const IntegrationHealthRequest = z.object({ businessId: z.uuid(), connector: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/) });
export type IntegrationHealthRequest = z.input<typeof IntegrationHealthRequest>;

export const MintSessionTokenRequest = SessionClaims.extend({
  ttlSeconds: z.number().int().positive().optional(),
  untrusted: UntrustedSeed.optional(),
});
export type MintSessionTokenRequest = z.input<typeof MintSessionTokenRequest>;

export interface MintSessionTokenResponse {
  token: string;
  expiresAt: string;
  jti: string;
}

export const PolicyOutcome = z.enum(POLICY_OUTCOMES);

/** What an agent receives for third-party content: the quarantine envelope, never the raw wrapper internals. */
export interface UntrustedEnvelope<T = unknown> {
  untrusted: true;
  content: T;
  source: UntrustedSource;
  notice: string;
}

export interface CallResultPayload {
  ok: boolean;
  data?: unknown;
  error?: ToolError;
  untrusted: boolean;
  costMinor: number;
  /**
   * Set when the connector ran its mock: the call reached no vendor, so nothing was sent, published, charged or changed
   * outside the platform. Absent on a live call. An agent must never report a simulated result as an action it took.
   */
  simulated?: true;
  /** The sentence that travels with a simulated result, for the model that reads it. */
  notice?: string;
}

/** What an agent reads beside a mock connector's result (docs/THESIS_REVIEW.md, package 0.3). */
export const SIMULATED_NOTICE =
  "Simulated: this tool ran in practice mode and reached no outside service. Nothing was sent, published, charged, booked or changed outside the platform, and any data returned is sample data. Do not report this as done; say it was simulated and what is needed for it to happen for real.";

export interface AllowResponse {
  outcome: "allow";
  result: CallResultPayload;
  costMinor: number;
  auditId: string;
  reasons: string[];
  policyIds: string[];
}

export interface AskResponse {
  outcome: "ask";
  approvalId: string;
  reasons: string[];
  policyIds: string[];
  costMinor: 0;
  auditId: string;
}

export interface DenyResponse {
  outcome: "deny";
  reasons: string[];
  policyIds: string[];
  costMinor: 0;
  auditId: string;
  /** Set when the denial is a hard gate: the action was queued for the founder (BUILD §2.2). */
  approvalId?: string;
  humanAction?: HumanActionDescriptor;
}

export interface RateLimitedResponse {
  outcome: "rate_limited";
  reasons: string[];
  retryAfterSeconds: number;
  limit: number;
  /** `concurrent`: as many repository archives as one gateway serves at once are in flight (archive.ts). */
  scope: "minute" | "day" | "concurrent";
  costMinor: 0;
}

export type CallResponse = AllowResponse | AskResponse | DenyResponse | RateLimitedResponse;

export interface GatewayErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface HealthResponse {
  ok: boolean;
  service: "gateway";
  app: string;
  /** False when the database did not answer at boot (the service still runs; see db-boot.ts). */
  db: boolean;
  mode: "mock" | "live";
  /** The connectors switched live one by one (LIVE_CONNECTORS), by key; names only, never a credential. */
  liveConnectors: string[];
  connectors: number;
  policy: { cedar: string; policies: number };
  vault: "local" | "kms" | "none";
  rateLimitStore: "memory" | "redis";
  /** How the api's service token is checked (WP-11 T12): "shared", "legacy" (switching), "own". A word, never a value. */
  apiServiceToken: "shared" | "legacy" | "own";
  time: string;
}
