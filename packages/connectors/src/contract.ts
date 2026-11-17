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
  /**
   * The live connector runs on the platform's own key (`PlatformSecrets`) for a business that connected it without
   * storing a credential of its own: the public registries, Voyage, E2B, Anthropic on credits, and Stripe Connect (the
   * platform key acting for the business's connected account). The gateway then needs a connected integration row, not
   * a stored secret. Absent or false: a live call needs the business's own credential.
   */
  platformKey?: boolean;
  /**
   * The live connect() runs the OAuth authorization-code flow (Google, Notion, Shopify): without `code` it answers the
   * vendor's consent page as `config.authorizeUrl` for the `state` and `redirectUri` the host passes, and stores
   * nothing; with the `code` the vendor sent back (and the same `redirectUri`) it exchanges it.
   */
  authorizationCode?: boolean;
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
  /** The agent session the call belongs to; null for a call the platform makes for the business outside one (a plan action, an import). */
  sessionId: string | null;
  integration: IntegrationRecord;
  /** Decrypted secret for this integration; absent for `auth.kind === "none"` and for platform-key connectors. */
  credential?: DecryptedCredential;
  log: ToolLogger;
  mode: ConnectorMode;
  /**
   * Set by the gateway: stores a credential the connector refreshed during this call (a new OAuth access token), sealed
   * in place of the old one, so the next call reuses it instead of refreshing again. Connectors call it best effort.
   */
  onCredentialRefreshed?: (credential: DecryptedCredential) => Promise<void>;
  /**
   * Set by the gateway for `platform_mail` only, after its guards ran (package 1.5): the project's Foundmill address and
   * what every message carries. Never an argument of the call, so an agent can neither choose the sender nor the
   * custom args that bind delivery events back to the project.
   */
  platformMail?: PlatformMailEnvelope;
  /**
   * Set by the gateway for a founder's own sender (`resend.send_mail`): Foundmill's signed one-click unsubscribe link for
   * this recipient and project, the one ingest turns into a suppression entry. Never an argument of the call, so an agent
   * cannot point an opt-out somewhere it is never recorded (security review, Nov 12, 2026). Absent: nothing is sent.
   */
  unsubscribeUrl?: string;
}

/** What the gateway hands `platform_mail.send_mail` (see `ToolContext.platformMail`). */
export interface PlatformMailEnvelope {
  /** `<local part>@<PLATFORM_MAIL_DOMAIN>` and `<project name> via <APP_NAME>`. Also the Reply-To: replies come back into Foundmill. */
  from: { email: string; name: string };
  /** The project's name as the footer says it ("Sent by <it> with <APP_NAME>"); never one containing APP_NAME. */
  projectName: string;
  /** The gateway's id for this message (uuid), signed into `customArgs`. */
  messageRef: string;
  /** One-click unsubscribe for this recipient (RFC 8058), signed for the project. */
  unsubscribeUrl: string;
  /** `fm_b` (business id), `fm_m` (message ref), `fm_s` (their signature): SendGrid echoes them in every delivery event. */
  customArgs: Record<string, string>;
  /**
   * The message is commercial (US CAN-SPAM; packages/shared `projectMailClass`): it must carry `postalAddress`, and the
   * connector sends nothing without it. False only for what the gateway proved transactional (a reply to a person who
   * wrote first, a receipt, the follow confirmation).
   */
  commercial: boolean;
  /** The founders' postal address for the footer (`project_postal_addresses`); set on every commercial message. */
  postalAddress?: string;
}

/** Hand a refreshed credential to the host (`ctx.onCredentialRefreshed`); a failure to store it never fails the call. */
export async function reportRefreshedCredential(ctx: ToolContext, credential: DecryptedCredential, connectorKey: string): Promise<void> {
  if (!ctx.onCredentialRefreshed) return;
  try {
    await ctx.onCredentialRefreshed(credential);
  } catch (e) {
    ctx.log.warn({ connector: connectorKey, businessId: ctx.businessId, reason: e instanceof Error ? e.name : "unknown" }, "refreshed credential could not be stored; the next call refreshes again");
  }
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
  /**
   * The vendor account a delivery says it comes from (Stripe `event.account`, the Shopify shop domain, the GitHub
   * installation id), or null when it names none. `apps/ingest` compares it with the account the business in the URL
   * connected, so a validly signed delivery for one business is never accepted at another business's URL
   * (SECURITY_REVIEW SEC-10). Reads a clone, like `verify`. Absent: the vendor's scheme names no account.
   */
  accountOf?(req: Request): Promise<string | null>;
  /**
   * The vendor account a delivery says withdrew the platform's access (Stripe `account.application.deauthorized`), or
   * null for any other delivery. `apps/ingest` marks that business's connection expired, after `verify` and the same
   * account check as `accountOf`. Absent: the vendor sends no such notice.
   */
  revokedAccount?(req: Request): Promise<string | null>;
}

/**
 * One value the founder enters in Settings › Integrations to connect a connector live: a field of its `connect()` input,
 * typically a key the vendor issued to the founder's own account, so the vendor bills the founder (BUILD §10), never
 * the platform. The web renders the connect dialog from these; the api refuses a live connect that lacks a required one.
 */
export interface ConnectField {
  /** Key in the `connect()` input (`apiKey`, `apiToken`...). */
  name: string;
  /** Label in the dialog ("API key"). */
  label: string;
  /** Masked while typed; `connect()` hands it back only as `credentialToStore` (sealed), never in settings or logs. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** What the key must allow and who is billed, one sentence. */
  hint?: string;
}

export interface Connector<Cfg = unknown> {
  key: string; // e.g. "sendgrid"
  displayName: string;
  phase: ConnectorPhase;
  auth: ConnectorAuth;
  /** What the founder enters to connect it live (see ConnectField); absent when connecting needs no input or is an OAuth/App flow. */
  connectFields?: ConnectField[];
  connect(businessId: string, input: unknown): Promise<IntegrationRecord>;
  /**
   * Checks the connection. `credential` is the business's own decrypted credential when the host has one (the gateway
   * passes it for a live check); an API-key connector checks with it and never with a platform key.
   */
  healthcheck(integration: IntegrationRecord, credential?: DecryptedCredential): Promise<HealthResult>;
  /**
   * Withdraws the platform's access at the vendor when the founder disconnects (Stripe Connect: `oauth.deauthorize`).
   * The gateway calls it before the api revokes the stored credentials; absent, disconnecting is local only. True when
   * access was withdrawn, false when this connection had none at the vendor to withdraw (a pasted key).
   */
  disconnect?(integration: IntegrationRecord): Promise<boolean>;
  tools: McpToolDefinition[]; // JSON-schema inputs/outputs
  callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult>;
  webhooks?: ConnectorWebhook[];
  rateLimits: { perMinute?: number; perDay?: number };
  costModel?: (name: string, args: unknown) => number; // minor units
  /**
   * What a call would cost in minor units, from the tool's own cost function or the connector's `costModel`, before it
   * runs; null when the connector declares none or the arguments do not parse. The gateway's spend policy reads this, not
   * a number the calling agent reports.
   */
  estimateCostMinor?: (name: string, args: unknown) => number | null;
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

/** Thrown by a live `connect()` when the founder did not enter a field it needs (400; the message is shown as is). */
export class ConnectInputError extends AppError {
  constructor(connectorKey: string, field: string, message: string) {
    super("connect_input_required", message, 400, { connectorKey, field });
    this.name = "ConnectInputError";
  }
}

/** A non-empty string field of a `connect()` input, trimmed; undefined when absent. */
export function connectInputValue(input: unknown, name: string): string | undefined {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>)[name] : undefined;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

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
