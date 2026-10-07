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
  /** Overrides the session's kit-mode flag for this call (only upwards: a kit-mode session stays kit mode). */
  kitMode: z.boolean().optional(),
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

export const MintSessionTokenRequest = SessionClaims.extend({
  ttlSeconds: z.number().int().positive().optional(),
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
}

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
  scope: "minute" | "day";
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
  mode: "mock" | "live";
  connectors: number;
  policy: { cedar: string; policies: number };
  vault: "local" | "kms" | "none";
  rateLimitStore: "memory" | "redis";
  time: string;
}
