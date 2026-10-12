/**
 * Foundmill's own billing (audit 2026-10-12 #22): a Stripe Checkout session on the platform's Stripe account for a
 * credit top-up. The api asks (`POST /v1/billing/checkout-sessions`, service token `svc: api`) after its owner check;
 * the gateway is the service that holds STRIPE_SECRET_KEY (BUILD §2.1 rule 2), so the session is created here through
 * the Stripe connector's own `create_checkout_session` tool, with no stored credential (the platform key) and no
 * `Stripe-Account` header.
 *
 * Mock mode (Stripe not live: `INTEGRATIONS_MODE=mock` without `LIVE_CONNECTORS=stripe`) runs the mock connector's
 * tool, so the arguments are checked exactly as live, and answers with a simulated checkout: its URL is the success URL
 * the api gave (the Billing tab, where the founder completes the simulated payment). Nothing is ever paid or granted
 * here: credits arrive from the platform Stripe webhook (apps/ingest) or the api's labeled mock completion.
 */
import { z } from "zod";
import { isConfigError, STRIPE_KEY, type ConnectorMode, type IntegrationRecord, type ToolContext } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { GatewayError, modeFor, type GatewayDeps } from "./pipeline";

/** Stripe's own limits for one Checkout line are far above this; a top-up is at most $10,000. */
export const MAX_TOP_UP_MINOR = 1_000_000;
export const MIN_TOP_UP_MINOR = 100;

export const CreateCheckoutRequest = z.object({
  businessId: z.guid(),
  /** The api's `billing_checkouts` row: it travels in the session's metadata and comes back on the webhook. */
  checkoutId: z.guid(),
  kind: z.literal("credits"),
  amountMinor: z.number().int().min(MIN_TOP_UP_MINOR).max(MAX_TOP_UP_MINOR),
  currency: z.literal("USD"),
  description: z.string().trim().min(1).max(200),
  successUrl: z.url(),
  cancelUrl: z.url(),
  customerEmail: z.email().optional(),
});
export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequest>;

export interface CheckoutSessionView {
  id: string;
  /** Where the founder pays: Stripe's hosted page (live), or the success URL itself (mock). */
  url: string;
  expiresAt: string | null;
  amountTotalMinor: number;
  currency: "USD";
}

export interface CreateCheckoutResponse {
  mode: ConnectorMode;
  session: CheckoutSessionView;
}

/** Metadata keys the platform webhook reads back (apps/ingest billing.ts). */
export const CHECKOUT_METADATA = { checkoutId: "foundmill_checkout_id", businessId: "foundmill_business_id", kind: "foundmill_kind" } as const;

const NIL_ID = "00000000-0000-0000-0000-000000000000";

/** The platform account as an integration record: no credential (the platform key), no connected account. */
function platformIntegration(businessId: string, now: Date): IntegrationRecord {
  const at = now.toISOString();
  return { id: NIL_ID, businessId, connectorKey: STRIPE_KEY, status: "connected", scopes: [], accountLabel: "Platform account", externalAccountId: null, config: { kind: "platform" }, credentialRef: null, expiresAt: null, lastHealthAt: at, createdAt: at };
}

const CreatedSession = z.object({ id: z.string().min(1), url: z.string().nullable(), expiresAt: z.string().nullable(), amountTotalMinor: z.number().int().nullable(), currency: z.string().nullable() });

export async function createPlatformCheckout(deps: GatewayDeps, input: CreateCheckoutRequest, service: string): Promise<CreateCheckoutResponse> {
  const now = deps.now?.() ?? new Date();
  await repos.businesses.get(deps.db, input.businessId).catch(() => {
    throw new GatewayError("business_not_found", `business ${input.businessId} is not available to this gateway`, 404);
  });
  const mode = modeFor(deps, STRIPE_KEY);
  const connector = deps.registry.get(STRIPE_KEY, mode);
  const ctx: ToolContext = { businessId: input.businessId, agentId: NIL_ID, sessionId: input.checkoutId, integration: platformIntegration(input.businessId, now), log: deps.log, mode };
  const args = {
    mode: "payment" as const,
    lines: [{ description: input.description, amountMinor: input.amountMinor, quantity: 1, currency: input.currency }],
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    customerEmail: input.customerEmail,
    metadata: { [CHECKOUT_METADATA.checkoutId]: input.checkoutId, [CHECKOUT_METADATA.businessId]: input.businessId, [CHECKOUT_METADATA.kind]: input.kind },
  };
  let result;
  try {
    result = await connector.callTool("create_checkout_session", args, ctx);
  } catch (e) {
    if (isConfigError(e)) throw new GatewayError("payments_unconfigured", "Payments are not set up on this server yet (STRIPE_SECRET_KEY is missing on the gateway)", 503);
    throw e;
  }
  if (!result.ok) {
    deps.log.warn({ businessId: input.businessId, checkoutId: input.checkoutId, code: result.error?.code, status: result.error?.status }, "platform checkout refused");
    throw new GatewayError("payments_unavailable", `Stripe could not open the checkout: ${result.error?.message ?? "unknown error"}`, 502);
  }
  const created = CreatedSession.parse(result.data);
  // The simulated checkout is the success page itself: the founder completes it on the Billing tab (labeled, no money).
  const url = mode === "live" ? created.url : input.successUrl;
  if (!url) throw new GatewayError("payments_unavailable", "Stripe opened the checkout without a payment page", 502);
  await repos.audit.append(deps.db, input.businessId, {
    actorKind: "system",
    action: "gateway.billing.checkout_created",
    target: { kind: "billing_checkout", id: input.checkoutId },
    details: { service, mode, sessionId: created.id, amountMinor: input.amountMinor, currency: input.currency },
  });
  return { mode, session: { id: created.id, url, expiresAt: created.expiresAt, amountTotalMinor: created.amountTotalMinor ?? input.amountMinor, currency: "USD" } };
}
