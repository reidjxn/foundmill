/**
 * The api's calls into apps/gateway, the one service that reaches vendors and holds their keys (BUILD §2.1 rule 2,
 * SEC-14), behind a one-minute service JWT of the same shape as apps/gateway `signServiceToken` (`iss foundmill-gateway`,
 * `aud foundmill-gateway/service`, `svc api`). Connecting an integration and checking its health run there for every
 * connector that runs live (`connect`, `health`: GitHub's installation check, an API key the founder entered, an OAuth
 * consent link or code exchange; the gateway seals any secret the vendor hands back). So do a founder's own Anthropic key
 * check (`validateKey`, live models only) and Legal › Import's registry lookups (`registryLookup`, live registries only).
 * Credit top-ups open their Stripe Checkout session there too (`createCheckout`): STRIPE_SECRET_KEY lives only in the
 * gateway. The Commit screen's domain checks go there too (`checkDomains`): registries are reached only from the gateway.
 * So do the AI-generated faces of anthropomorphic agents (`generatePortrait`): the api sends a persona catalog key and a character style, never a
 * prompt, and OPENAI_API_KEY lives only in the gateway. Choosing the Code tab's repository asks there whether the
 * installation reaches it and whether it is private (`repository`).
 */
import { randomUUID } from "node:crypto";
import { OPENAI_IMAGES_GENERATION_TIMEOUT_MS } from "@foundmill/connectors";
import { AppError, type AgentStyle, type IntegrationStatus, type NotificationKind } from "@foundmill/shared";
import { SignJWT } from "jose";

export const TOKEN_ISSUER = "foundmill-gateway";
export const SERVICE_AUDIENCE = "foundmill-gateway/service";

/** What the gateway's connect hands back: the connector's IntegrationRecord without any secret. */
export interface GatewayIntegrationRecord {
  status: IntegrationStatus;
  scopes: string[];
  accountLabel: string | null;
  externalAccountId: string | null;
  config: Record<string, unknown>;
  expiresAt: string | null;
}

/** What the gateway's connect answers: the record without any secret, and where a secret the vendor handed back was sealed. */
export interface GatewayConnectResult {
  /** The mode the gateway ran the connector in (it decides what the row's status becomes). */
  mode: "mock" | "live";
  record: GatewayIntegrationRecord;
  /** The integration row the gateway stored a credential with; null when it wrote nothing. */
  integrationId: string | null;
  /** The sealed credential: its row id and a four-character hint (`redactSecret`); null when there was none. */
  credential: { stored: true; credentialId: string; hint: string } | null;
}

/** A founder's own Anthropic key, checked by the gateway with Anthropic (apps/gateway keys.ts `ValidateKeyResponse`). */
export interface GatewayKeyValidation {
  mode: "live";
  valid: boolean;
  reason: string | null;
  routedModels: { key: string; modelId: string; available: boolean }[];
  checkedAt: string;
}

/** The registries Legal › Import looks companies up in; the gateway runs only their lookup tools (registry-lookup.ts). */
export type GatewayRegistryKey = "companies_house" | "bolagsverket" | "opencorporates";

export interface GatewayRegistryLookupRequest {
  businessId: string;
  connector: GatewayRegistryKey;
  tool: string;
  args: Record<string, unknown>;
}

export interface GatewayRegistryLookup {
  mode: "mock" | "live";
  ok: boolean;
  /** The untrusted envelope of the registry's answer (`{ untrusted: true, content, source, notice }`). */
  data?: unknown;
  /** The tool's code and the registry's HTTP status, never the registry's own words. */
  error?: { code: string; status: number | null };
  costMinor: number;
  simulated?: true;
}

export interface GatewayHealth {
  ok: boolean;
  status: string;
  message?: string;
  [k: string]: unknown;
}

/** A credit top-up's checkout, as the api asks for it (apps/gateway billing.ts `CreateCheckoutRequest`). */
export interface GatewayCheckoutRequest {
  businessId: string;
  checkoutId: string;
  kind: "credits";
  amountMinor: number;
  currency: "USD";
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/** The session the gateway opened: Stripe's hosted page in live mode, the success URL itself in mock mode. */
export interface GatewayCheckout {
  mode: "mock" | "live";
  session: { id: string; url: string; expiresAt: string | null; amountTotalMinor: number; currency: "USD" };
}

/** One domain's answer, as the `domains` connector gives it (packages/connectors `DomainAnswer`). */
export interface GatewayDomainAnswer {
  domain: string;
  status: "available" | "taken" | "unknown";
  provenance: "Registry" | "DNS" | "Mock";
  /** True for the DNS fallback, which is an estimate. */
  estimate: boolean;
  checkedAt: string;
  registrar?: string;
  expires?: string;
  reason?: string;
}

/** One generated portrait, as the gateway answers (apps/gateway portraits.ts `PortraitResponse`). */
export interface GatewayPortrait {
  mime: "image/webp" | "image/png";
  /** The image bytes, base64. */
  base64: string;
  /** The image model that made it ("mock-portrait" for the placeholder). */
  model: string;
}

/** A GitHub repository as the business's installation sees it (apps/gateway code-repository.ts `RepoMetadata`). */
export interface GatewayRepository {
  /** GitHub's numeric id: what the Code tab pins. */
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

/**
 * A portrait takes 10 to 60 seconds to render, so its call waits longer than the others: longer than the connector waits
 * for OpenAI (`OPENAI_IMAGES_GENERATION_TIMEOUT_MS`, 120 s) plus room for the gateway's own work, so the api never gives
 * up on an image the gateway is still about to return (and pay for).
 */
export const PORTRAIT_TIMEOUT_MS = OPENAI_IMAGES_GENERATION_TIMEOUT_MS + 30_000;

/** One push notification to registered phones, as the api's notifier asks for it (apps/gateway push.ts `SendPushRequest`). */
export interface GatewayPushRequest {
  businessId: string;
  kind: NotificationKind;
  /** OneSignal subscription ids (`founder_devices.token`), at most 2,000. */
  subscriptionIds: string[];
  title: string;
  body: string;
  /** What the app routes on when the notification is tapped. */
  data: Record<string, string | number | boolean>;
  collapseKey?: string;
}

export interface GatewayPushResult {
  mode: "mock" | "live";
  /** The provider's notification id; empty when it accepted nothing. */
  id: string;
  /** Subscriptions the provider accepted it for (Estimate). */
  recipients: number;
  errors: string[];
}

export interface ApiGatewayClient {
  /** Connects a live integration: an App installation verified, a vendor's secret sealed by the gateway and never returned. */
  connect(businessId: string, connector: string, input: Record<string, unknown>): Promise<GatewayConnectResult>;
  health(businessId: string, connector: string): Promise<GatewayHealth>;
  /** A founder's own Anthropic key, checked with Anthropic (a one-token call, then the routed models); asked only with live models. */
  validateKey(businessId: string, apiKey: string): Promise<GatewayKeyValidation>;
  /** A company-registry lookup for Legal › Import; asked only when the registry runs live. */
  registryLookup(input: GatewayRegistryLookupRequest): Promise<GatewayRegistryLookup>;
  createCheckout(input: GatewayCheckoutRequest): Promise<GatewayCheckout>;
  /** Registry answers for up to eight domain names, on behalf of one founder (the gateway's rate-limit scope). */
  checkDomains(ownerKey: string, domains: string[]): Promise<GatewayDomainAnswer[]>;
  /**
   * The AI-generated face for one persona catalog key in one character style (humans when not given). The gateway builds
   * the prompt from the style and the key (a key outside the catalog is a 400 `unknown_persona`, a style outside
   * `AGENT_STYLES` a 400 `unknown_style`), so the api cannot send one. `businessId` only attributes the gateway's audit row.
   */
  generatePortrait(personaKey: string, businessId?: string, style?: AgentStyle): Promise<GatewayPortrait>;
  /**
   * Whether the business's GitHub installation reaches `owner/repo`, and its id and visibility (before it is chosen on
   * Development › Code). 404 when the installation cannot reach it, 409 when GitHub is not connected.
   */
  repository(businessId: string, owner: string, repo: string): Promise<{ mode: "mock" | "live"; repository: GatewayRepository }>;
  /** One push notification to the mobile app's phones (docs/mobile): the gateway holds the OneSignal keys and runs the connector. */
  sendPush(input: GatewayPushRequest): Promise<GatewayPushResult>;
}

export interface CreateApiGatewayClientOptions {
  url: string;
  /** `SESSION_TOKEN_SECRET`; null makes every call fail with 412 `config`. */
  secret: string | null;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export async function signApiServiceToken(secret: string): Promise<string> {
  return new SignJWT({ svc: "api" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(TOKEN_ISSUER).setAudience(SERVICE_AUDIENCE).setIssuedAt().setExpirationTime("60s").setJti(randomUUID()).sign(new TextEncoder().encode(secret));
}

export function createApiGatewayClient(opts: CreateApiGatewayClientOptions): ApiGatewayClient {
  const baseUrl = opts.url.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const post = async <T>(path: string, body: unknown, callTimeoutMs = timeoutMs): Promise<T> => {
    if (!opts.secret || opts.secret.length < 16) throw new AppError("config", "SESSION_TOKEN_SECRET is not set on the api, so it cannot call the gateway", 412);
    const token = await signApiServiceToken(opts.secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      throw new AppError("gateway_unreachable", `The gateway did not answer: ${(e as Error).message}`, 503);
    } finally {
      clearTimeout(timer);
    }
    const parsed = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok) {
      // The gateway's own refusals (forbidden installation, unconfigured App, GitHub unreachable) pass through as-is.
      const status = res.status >= 400 && res.status < 600 ? res.status : 502;
      throw new AppError(parsed?.error?.code ?? "gateway_error", parsed?.error?.message ?? `The gateway answered ${res.status}`, status);
    }
    if (!parsed) throw new AppError("gateway_error", "The gateway sent no body", 502);
    return parsed;
  };

  return {
    connect: (businessId, connector, input) => post<GatewayConnectResult>("/v1/integrations/connect", { businessId, connector, input }),
    health: async (businessId, connector) => (await post<{ health: GatewayHealth }>("/v1/integrations/health", { businessId, connector })).health,
    createCheckout: (input) => post<GatewayCheckout>("/v1/billing/checkout-sessions", input),
    checkDomains: async (ownerKey, domains) => (await post<{ results: GatewayDomainAnswer[] }>("/v1/domains/check", { ownerKey, domains })).results,
    generatePortrait: (personaKey, businessId, style) => post<GatewayPortrait>("/v1/personas/portrait", { personaKey, ...(style ? { style } : {}), ...(businessId ? { businessId } : {}) }, Math.max(timeoutMs, PORTRAIT_TIMEOUT_MS)),
    repository: (businessId, owner, repo) => post<{ mode: "mock" | "live"; repository: GatewayRepository }>("/v1/github/repository", { businessId, owner, repo }),
    sendPush: (input) => post<GatewayPushResult>("/v1/push/send", input),
    validateKey: (businessId, apiKey) => post<GatewayKeyValidation>("/v1/keys/validate", { businessId, apiKey }),
    registryLookup: (input) => post<GatewayRegistryLookup>("/v1/registry/lookup", input),
  };
}
