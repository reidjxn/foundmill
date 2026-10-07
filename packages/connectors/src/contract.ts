/**
 * Connector contract — exactly BUILD §13.1 plus the record/result types the gateway and ingest need
 * (docs/ARCHITECTURE.md §8, §9). Everything a connector returns to an agent passes through the gateway,
 * which applies Cedar policy to `policyHints`, injects the decrypted credential into `ToolContext`, meters
 * `costMinor` and audits the call.
 */
import { AppError, type ConnectorAuthKind, type IntegrationStatus } from "@foundmill/shared";
import type { PlatformEvent } from "@foundmill/events/catalogue";

export type { PlatformEvent };

/** `INTEGRATIONS_MODE` (docs/ARCHITECTURE.md §3). The registry returns `connector.mock` in `mock`. */
export type ConnectorMode = "mock" | "live";
export type ConnectorPhase = 1 | 2 | 3;

export interface ConnectorAuth {
  kind: ConnectorAuthKind;
  scopes?: string[];
}

/**
 * One connected account of one business (table `integrations`, BUILD §7.2). Never holds a secret: the
 * ciphertext lives in `credentials`, referenced by `credentialRef`. `config` is non-secret per-business
 * configuration (shop domain, zone id, verified senders, repository allow-list...).
 */
export interface IntegrationRecord {
  id: string;
  businessId: string;
  connectorKey: string;
  status: IntegrationStatus;
  scopes: string[];
  accountLabel: string | null;
  /** Vendor-side account id: Stripe `acct_…`, GitHub installation id, Shopify shop domain, Tink user id... */
  externalAccountId: string | null;
  config: Record<string, unknown>;
  credentialRef: string | null;
  /** When the credential / consent lapses (ISO). Drives `credential.expiring`. */
  expiresAt: string | null;
  lastHealthAt: string | null;
  createdAt: string;
  /**
   * Transient. Set by `connect()` when the vendor handed back a secret (OAuth code exchange, Plaid public
   * token exchange). The gateway encrypts it into `credentials`, sets `credentialRef` and strips this field
   * before the record is persisted or returned to any client.
   */
  credentialToStore?: DecryptedCredential;
}

export interface HealthResult {
  ok: boolean;
  status: IntegrationStatus;
  checkedAt: string;
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

/** JSON Schema (draft-07) object schema, the shape MCP `Tool.inputSchema` / `outputSchema` require. */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
  description?: string;
  [key: string]: unknown;
}

/** MCP tool annotations (ToolAnnotations in @modelcontextprotocol/sdk). Hints only; policy comes from `policyHints`. */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Structurally compatible with MCP `Tool` so the gateway can list it from `/mcp/:connector` unchanged. */
export interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  annotations?: McpToolAnnotations;
}

/** BUILD §13.1 `policyHints` values — the `Tool` attributes Cedar reads (BUILD §9.5). */
export interface PolicyHint {
  spendsMoney?: boolean;
  contactsThirdParty?: boolean;
  requiresKitMode?: boolean;
  irreversible?: boolean;
  hardGate?: boolean;
}
export type PolicyHints = Record<string, PolicyHint>;

/**
 * The decrypted per-business secret the gateway injects for one call. `secret` is the primary secret
 * (API key, OAuth access token, GitHub installation token...). Never logged; never returned in a ToolResult.
 */
export interface DecryptedCredential {
  kind: ConnectorAuthKind;
  secret: string;
  refreshToken?: string;
  /** ISO. OAuth access-token expiry, so connectors can refresh before calling. */
  expiresAt?: string;
  /** Vendor account the secret belongs to, when it differs from `integration.externalAccountId`. */
  accountId?: string;
  /** Additional non-primary secrets (e.g. Plaid `item_id`, Tink `user_id`). */
  extra?: Record<string, string>;
}

/** Minimal structural logger; pino's `Logger` satisfies it. Connectors must never log secrets. */
export interface ToolLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ToolContext {
  businessId: string;
  agentId: string;
  sessionId: string;
  integration: IntegrationRecord;
  /** Decrypted secret for this integration; absent for `auth.kind === "none"` and for platform-key connectors. */
  credential?: DecryptedCredential;
  log: ToolLogger;
  mode: ConnectorMode;
}

export interface ToolError {
  /** Stable machine code: `hard_gate`, `unknown_tool`, `invalid_args`, `invalid_output`, `vendor_error`, `rate_limited`, `not_found`, `tool_failed`, or a connector-specific code. */
  code: string;
  message: string;
  retryable?: boolean;
  /** Upstream HTTP status when the vendor answered. */
  status?: number;
  details?: unknown;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
  /** True when `data` is third-party content wrapped by `wrapUntrusted` (BUILD §9.8). */
  untrusted?: boolean;
  /** Metered cost of this call in minor units (estimate). */
  costMinor: number;
}

/**
 * What a hard-gated tool returns instead of executing (BUILD §2.2): the gateway turns it into a
 * `request_human_action` plan action / founder task with these instructions attached.
 */
export interface HumanActionDescriptor {
  connector: string;
  tool: string;
  title: string;
  instructions: string;
  /** Where the founder performs the action (vendor dashboard, signing URL...). */
  url?: string;
  args: unknown;
  reason: string;
}

export interface ConnectorWebhook {
  /** Mount path for `apps/ingest`; `:businessId` is the integration-scoped segment. */
  path: string;
  /** Signature (and replay) verification over the raw body. Reads a clone; the same Request can be passed to `normalise`. */
  verify(req: Request): Promise<boolean>;
  /** Vendor payload → zero or more validated platform events. Assumes `verify` passed. */
  normalise(req: Request): Promise<PlatformEvent[]>;
}

export interface Connector<Cfg = unknown> {
  key: string; // e.g. "sendgrid"
  displayName: string;
  phase: ConnectorPhase;
  auth: ConnectorAuth;
  connect(businessId: string, input: unknown): Promise<IntegrationRecord>;
  healthcheck(integration: IntegrationRecord): Promise<HealthResult>;
  tools: McpToolDefinition[]; // JSON-schema inputs/outputs
  callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult>;
  webhooks?: ConnectorWebhook[];
  rateLimits: { perMinute?: number; perDay?: number };
  costModel?: (name: string, args: unknown) => number; // minor units
  policyHints: PolicyHints;
  mock: Connector<Cfg>; // same surface, deterministic fixtures
}

/** The `simulate` facility every mock exposes (docs/ARCHITECTURE.md §8, BUILD §13.3). */
export interface MockConnector<Cfg = unknown> extends Connector<Cfg> {
  readonly isMock: true;
  /** Names this mock can simulate; the dev Simulate panel lists them. */
  readonly simulations: readonly string[];
  simulate(eventName: string, params: SimulateParams): Promise<PlatformEvent[]>;
}

export interface SimulateParams {
  businessId: string;
  /** Any string; the same seed always yields the same events. */
  seed?: string;
  occurredAt?: Date;
  /** Event-specific overrides (amounts, emails, counts...). */
  [key: string]: unknown;
}

/** Thrown (never returned) when a live connector is called without the keys it needs. */
export class ConfigError extends AppError {
  constructor(connectorKey: string, what: string, hint?: string) {
    super("connector_unconfigured", `${connectorKey}: ${what} is not configured${hint ? ` — ${hint}` : ""}`, 503, { connectorKey, what });
    this.name = "ConfigError";
  }
}

export const isConfigError = (e: unknown): e is ConfigError => e instanceof ConfigError || (e instanceof AppError && e.code === "connector_unconfigured");

/** Vendor HTTP failure surfaced by the shared http client; mapped to `ToolError` by the builder. */
export class VendorError extends AppError {
  constructor(connectorKey: string, public readonly httpStatus: number, message: string, public readonly body?: unknown) {
    super("vendor_error", `${connectorKey}: ${message}`, httpStatus >= 500 ? 502 : httpStatus, { connectorKey, httpStatus, body });
    this.name = "VendorError";
  }
  get retryable(): boolean {
    return this.httpStatus === 429 || this.httpStatus >= 500;
  }
}
