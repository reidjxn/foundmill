/**
 * The api's calls into apps/gateway for App connectors (GitHub): connecting an installation and checking its health run
 * in the gateway, the one service holding the App's keys (BUILD §2.1 rule 2), behind a one-minute service JWT of the
 * same shape as apps/gateway `signServiceToken` (`iss foundmill-gateway`, `aud foundmill-gateway/service`, `svc api`).
 * Credit top-ups open their Stripe Checkout session there too (`createCheckout`): STRIPE_SECRET_KEY lives only in the
 * gateway. The Commit screen's domain checks go there too (`checkDomains`): registries are reached only from the gateway.
 * So do the AI-generated faces of anthropomorphic agents (`generatePortrait`): the api sends a persona catalog key, never a
 * prompt, and OPENAI_API_KEY lives only in the gateway.
 */
import { randomUUID } from "node:crypto";
import { OPENAI_IMAGES_GENERATION_TIMEOUT_MS } from "@foundmill/connectors";
import { AppError, type IntegrationStatus } from "@foundmill/shared";
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

/**
 * A portrait takes 10 to 60 seconds to render, so its call waits longer than the others: longer than the connector waits
 * for OpenAI (`OPENAI_IMAGES_GENERATION_TIMEOUT_MS`, 120 s) plus room for the gateway's own work, so the api never gives
 * up on an image the gateway is still about to return (and pay for).
 */
export const PORTRAIT_TIMEOUT_MS = OPENAI_IMAGES_GENERATION_TIMEOUT_MS + 30_000;

export interface ApiGatewayClient {
  connect(businessId: string, connector: string, input: Record<string, unknown>): Promise<GatewayIntegrationRecord>;
  health(businessId: string, connector: string): Promise<GatewayHealth>;
  createCheckout(input: GatewayCheckoutRequest): Promise<GatewayCheckout>;
  /** Registry answers for up to eight domain names, on behalf of one founder (the gateway's rate-limit scope). */
  checkDomains(ownerKey: string, domains: string[]): Promise<GatewayDomainAnswer[]>;
  /**
   * The AI-generated face for one persona catalog key. The gateway builds the prompt from the key (a key outside the
   * catalog is a 400), so the api cannot send one. `businessId` only attributes the gateway's audit row.
   */
  generatePortrait(personaKey: string, businessId?: string): Promise<GatewayPortrait>;
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
    connect: async (businessId, connector, input) => (await post<{ record: GatewayIntegrationRecord }>("/v1/integrations/connect", { businessId, connector, input })).record,
    health: async (businessId, connector) => (await post<{ health: GatewayHealth }>("/v1/integrations/health", { businessId, connector })).health,
    createCheckout: (input) => post<GatewayCheckout>("/v1/billing/checkout-sessions", input),
    checkDomains: async (ownerKey, domains) => (await post<{ results: GatewayDomainAnswer[] }>("/v1/domains/check", { ownerKey, domains })).results,
    generatePortrait: (personaKey, businessId) => post<GatewayPortrait>("/v1/personas/portrait", { personaKey, ...(businessId ? { businessId } : {}) }, Math.max(timeoutMs, PORTRAIT_TIMEOUT_MS)),
  };
}
