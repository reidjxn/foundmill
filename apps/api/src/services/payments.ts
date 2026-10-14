/**
 * Paying Foundmill (BUILD §10.5; audit 2026-10-12 #22). Two things can cost the founder money here, and both are gated:
 *
 * - **Credit top-ups** go through a real checkout. `startCreditCheckout` opens a `billing_checkouts` row, asks the
 *   gateway (the one service holding STRIPE_SECRET_KEY) for a Stripe Checkout session on the platform account, records
 *   it and hands back the page to send the founder to. Nothing is granted here: the platform Stripe webhook in
 *   apps/ingest settles a paid session (`settleCreditCheckout`, packages/db), or, for a checkout opened in mock mode,
 *   the founder completes the simulated payment on the Billing tab (`billing.checkout.completeMock`, labeled; no money
 *   moves). The platform's billing is live where `INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` names `stripe_billing`
 *   (`platformBillingMode`, read alike by the gateway); a mock checkout calls no vendor, so it is simulated here without
 *   the gateway, as mock connectors run in the api. Simulated payments exist only where ALLOW_MOCK_PAYMENTS allows them
 *   (by default development and test), and the credits they grant never pay for a live model call: free credits must
 *   never pay for the platform's Anthropic spend (SEC2 S10).
 * - **Paid tiers** (Pro, Scale) are not on sale: their prices are still "to be announced" (§19) and there is no
 *   subscription checkout, so choosing one is refused outside development and test (where seeded demos and tests switch
 *   freely). Moving down to Free is always allowed.
 */
import { APP_NAME, PRICE_TBA_LABEL, TIERS, type TierKey } from "@foundmill/config";
import { repos, type BillingCheckout, type Db } from "@foundmill/db";
import { allowMockPayments, AppError, platformBillingMode, type Env } from "@foundmill/shared";
import type { ApiGatewayClient } from "./gateway";

export const TOP_UP_MIN_MINOR = 500;
export const TOP_UP_MAX_MINOR = 1_000_000;
/** The amounts the Billing tab offers (USD cents; credits are USD). */
export const TOP_UP_OPTIONS_MINOR = [2500, 5000, 10000, 25000] as const;
export const CHECKOUT_DESCRIPTION = `${APP_NAME} credits`;

type PaymentsEnv = Pick<Env, "APP_ENV" | "MODEL_MODE" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS" | "ALLOW_MOCK_PAYMENTS">;

const testMode = (env: Pick<Env, "APP_ENV">) => env.APP_ENV === "development" || env.APP_ENV === "test";

/** How a checkout opened here is paid: through Stripe (live) or simulated (mock); the gateway reads the same switch. */
export const checkoutModeFor = (env: PaymentsEnv): "mock" | "live" => platformBillingMode(env);

/** How long a simulated checkout stays open (Stripe's own sessions last 24 hours). */
const MOCK_CHECKOUT_TTL_MS = 24 * 60 * 60_000;

/**
 * Whether a top-up may be paid by simulation here: `ALLOW_MOCK_PAYMENTS`, which defaults to on only in development and
 * test (SEC2 S10). The api's own MODEL_MODE says nothing about the platform key's other spenders (the orchestrator runs
 * live sessions whenever its sandbox is live), so it is not the test. Wherever simulated payments are on, the credits
 * they grant are labeled and never pay for a live model call (packages/db `checkPlatformCredits`).
 */
export const mockPaymentsAllowed = (env: PaymentsEnv): boolean => allowMockPayments(env);

export const MOCK_PAYMENTS_OFF_MESSAGE = "Top-ups are not available on this server yet: payments are not set up, and simulated payments are off here. Use your own Anthropic key in Settings › Keys meanwhile.";

export interface TopUpAvailability {
  mode: "mock" | "live";
  available: boolean;
  /** Why it is not available, in words the founder can act on. */
  reason: string | null;
}

export function topUpAvailability(env: PaymentsEnv): TopUpAvailability {
  const mode = checkoutModeFor(env);
  if (mode === "mock" && !mockPaymentsAllowed(env)) return { mode, available: false, reason: MOCK_PAYMENTS_OFF_MESSAGE };
  return { mode, available: true, reason: null };
}

export interface TierAvailability {
  tier: TierKey;
  available: boolean;
  reason: string | null;
}

const isPaidTier = (tier: TierKey) => TIERS[tier].priceMonthly !== null;

/** Whether `tier` can be chosen here (see the module comment). */
export function tierAvailability(env: Pick<Env, "APP_ENV">, tier: TierKey): TierAvailability {
  if (!isPaidTier(tier) || testMode(env)) return { tier, available: true, reason: null };
  const price = TIERS[tier].priceMonthly as string | number | null;
  return {
    tier,
    available: false,
    reason: typeof price === "number" ? "Paid tiers open once their subscription checkout is ready." : `${PRICE_TBA_LABEL}: paid tiers open once their prices are set. Until then a business runs on Free, with your own Anthropic key.`,
  };
}

/** Refuses a paid tier that is not on sale (412). */
export function assertTierAvailable(env: Pick<Env, "APP_ENV">, tier: TierKey): void {
  const a = tierAvailability(env, tier);
  if (!a.available) throw new AppError("tier_unavailable", a.reason ?? "This tier is not available", 412);
}

export interface StartCheckoutDeps {
  db: Db;
  env: PaymentsEnv & Pick<Env, "APP_URL">;
  gateway: ApiGatewayClient;
}

export interface StartedCheckout {
  checkout: BillingCheckout;
  /** Where to send the founder: Stripe's page (live) or the Billing tab's simulated checkout (mock). */
  checkoutUrl: string;
  mode: "mock" | "live";
}

/** The Billing tab of `businessId`, where Stripe sends the founder back (`{ checkout }` names the row). */
export function billingReturnUrls(appUrl: string, businessId: string, checkoutId: string): { successUrl: string; cancelUrl: string } {
  const base = new URL(`/b/${businessId}/settings/billing`, appUrl);
  base.searchParams.set("checkout", checkoutId);
  const cancel = new URL(base);
  cancel.searchParams.set("canceled", "1");
  return { successUrl: base.toString(), cancelUrl: cancel.toString() };
}

const gatewayFailureMessage = (err: unknown): string => {
  const code = err instanceof AppError ? err.code : null;
  if (code === "payments_unconfigured") return "Payments are not set up on this server yet. Use your own Anthropic key in Settings › Keys meanwhile.";
  if (code === "gateway_unreachable" || code === "config") return "The payment service did not answer. Try again in a minute.";
  return err instanceof AppError ? err.message : "Stripe could not open the checkout. Try again in a minute.";
};

/** Opens a top-up of `amountMinor` USD cents for `businessId` (see the module comment). The caller checked the owner. */
export async function startCreditCheckout(deps: StartCheckoutDeps, input: { businessId: string; userId: string; email: string | null; amountMinor: number }): Promise<StartedCheckout> {
  const availability = topUpAvailability(deps.env);
  if (!availability.available) throw new AppError("payments_unavailable", availability.reason ?? MOCK_PAYMENTS_OFF_MESSAGE, 412);
  const row = await repos.checkouts.create(deps.db, input.businessId, { mode: availability.mode, amountMinor: input.amountMinor, createdBy: input.userId });
  const { successUrl, cancelUrl } = billingReturnUrls(deps.env.APP_URL, input.businessId, row.id);
  if (availability.mode === "mock") {
    // Simulated: no vendor is called, so the gateway is not needed. The checkout page is the Billing tab itself.
    const checkout = await repos.checkouts.attachSession(deps.db, input.businessId, row.id, { mode: "mock", externalId: `cs_mock_${row.id.replace(/-/g, "")}`, checkoutUrl: successUrl, expiresAt: new Date(Date.now() + MOCK_CHECKOUT_TTL_MS) });
    return { checkout, checkoutUrl: successUrl, mode: "mock" };
  }
  let created;
  try {
    created = await deps.gateway.createCheckout({ businessId: input.businessId, checkoutId: row.id, kind: "credits", amountMinor: input.amountMinor, currency: "USD", description: CHECKOUT_DESCRIPTION, successUrl, cancelUrl, ...(input.email ? { customerEmail: input.email } : {}) });
  } catch (err) {
    const message = gatewayFailureMessage(err);
    await repos.checkouts.markFailed(deps.db, input.businessId, row.id, message);
    throw new AppError("payments_unavailable", message, err instanceof AppError && err.status === 412 ? 412 : 503);
  }
  // A gateway that runs the platform's billing as mock (its switch differs from the api's) is held to the same rule.
  if (created.mode === "mock" && !mockPaymentsAllowed(deps.env)) {
    await repos.checkouts.markFailed(deps.db, input.businessId, row.id, MOCK_PAYMENTS_OFF_MESSAGE);
    throw new AppError("payments_unavailable", MOCK_PAYMENTS_OFF_MESSAGE, 412);
  }
  const checkout = await repos.checkouts.attachSession(deps.db, input.businessId, row.id, { mode: created.mode, externalId: created.session.id, checkoutUrl: created.session.url, expiresAt: created.session.expiresAt });
  return { checkout, checkoutUrl: created.session.url, mode: created.mode };
}

/** What the Billing tab shows of a checkout (never the Stripe ids). */
export function checkoutView(c: BillingCheckout) {
  return { id: c.id, status: c.status, mode: c.mode, amountMinor: Number(c.amountMinor), currency: c.currency, createdAt: c.createdAt, paidAt: c.paidAt, expiresAt: c.expiresAt, failure: c.failure };
}
