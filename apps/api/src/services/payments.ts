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
 * - **Plans** (Founder, Studio) are not on sale: no subscription is charged while sign-up is invite-only
 *   (`EARLY_ACCESS_STAGE`, packages/config; WP-14 T14) and there is no subscription checkout (WP-09 T16 builds it before
 *   sign-up opens), so choosing one is refused outside development and test (where seeded demos and tests switch
 *   freely). Moving down to Try is always allowed and is one action, as canceling must be (CLAUDE.md, Never).
 *   `assertSubscriptionChargingOpen` is the gate every subscription charge passes: nothing gets past it while the stage
 *   is `invite_only`. Partner is never chosen here: its only action is joining its waitlist (`billing.partner.join`).
 * - **The entry plan** (WP-09 T16; founder, 2026-11-17): while `PAID_ENTRY` is on, a project's AI runs (Continue, an
 *   approval's cycle, cycle 1 at commit, the overnight shift) need an owner with the $5-a-month plan, opened here as a
 *   subscription checkout (`startCreditCheckout` with `kind: "subscription"`) and settled only by the webhook (or the
 *   simulated payment where those are allowed). Top-ups are then sold as the credit packs (`CREDIT_PACKS_MINOR`). With
 *   the switch off nothing of this is offered and nothing is gated: sign-up is by invitation and free.
 */
import { APP_NAME, CREDIT_PACKS_MINOR, creditPackCreditsMinor, EARLY_ACCESS_STAGE, ENTRY_PLAN, planName, subscriptionChargingOpen, TIERS, tierIsPaid, TOP_UP_OPTIONS_MINOR, type EarlyAccessStage, type TierKey } from "@foundmill/config";
import { postEntryPlanRequest, repos, type BillingCheckout, type Db, type Executor } from "@foundmill/db";
import { allowMockPayments, AppError, paidEntryLive, platformBillingMode, type Env } from "@foundmill/shared";
import type { ApiGatewayClient } from "./gateway";

export const TOP_UP_MIN_MINOR = 500;
export const TOP_UP_MAX_MINOR = 1_000_000;
export { TOP_UP_OPTIONS_MINOR };
export const CHECKOUT_DESCRIPTION = `${APP_NAME} credits`;
export const ENTRY_PLAN_DESCRIPTION = `${APP_NAME} ${ENTRY_PLAN.name} plan`;

type PaymentsEnv = Pick<Env, "APP_ENV" | "MODEL_MODE" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS" | "ALLOW_MOCK_PAYMENTS"> & Partial<Pick<Env, "PAID_ENTRY">>;

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

/** Whether sign-up is paid entry (`PAID_ENTRY`): the entry plan is offered, AI runs need it and top-ups are the packs. */
export const paidEntry = (env: Partial<Pick<Env, "PAID_ENTRY">>): boolean => env.PAID_ENTRY === true;

/** What the AI runs say while the project's owners have no entry plan (402 `entry_plan_required`). */
export const ENTRY_PLAN_REQUIRED_MESSAGE = `Your team starts working once you subscribe to the ${ENTRY_PLAN.name} plan ($${(ENTRY_PLAN.priceMonthlyMinor / 100).toFixed(2)} a month, with $${(ENTRY_PLAN.includedCreditsMinor / 100).toFixed(2)} of AI included). Subscribe in Settings › Billing. Your page, plan and foundations stay as they are.`;

/** What the refusal carries for the screen that shows the request: what is bought, its price, and the one press. */
export interface EntryPlanRequest {
  kind: "entry_plan";
  name: string;
  priceMonthlyMinor: number;
  includedCreditsMinor: number;
  currency: "USD";
  /** The Inbox note that keeps the request while it is unpaid (said once), when the business has a Chief of Staff. */
  inboxItemId: string | null;
}

export class EntryPlanRequiredError extends AppError {
  constructor(request: EntryPlanRequest | null = null) {
    super("entry_plan_required", ENTRY_PLAN_REQUIRED_MESSAGE, 402, request ? { request } : undefined);
  }
}

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/** The request's note (`postEntryPlanRequest`): what is bought, why now, what it costs, and what happens once it is paid. */
export const ENTRY_PLAN_REQUEST_BODY = `Your page, plan and foundations are drafted. For the team to start on the work itself, subscribe to the ${ENTRY_PLAN.name} plan: ${money(ENTRY_PLAN.priceMonthlyMinor)} a month, with ${money(ENTRY_PLAN.includedCreditsMinor)} of AI included each month. You pay on Stripe's secure page, and the team starts by itself as soon as the payment is confirmed: there is nothing more to press. Subscribe from Continue or in Settings › Billing.`;

/**
 * Continue's own refusal for paid entry: writes the request once (the pay-and-resume loop: the same note stays while the
 * checkout is unpaid, canceled or failed) and refuses with it, so the screen can offer the one press to Stripe.
 */
export async function requireEntryPlanForRun(db: Executor, env: PaymentsEnv, businessId: string): Promise<void> {
  if (await entryPlanOpen(db, env, businessId)) return;
  const item = await postEntryPlanRequest(db, businessId, ENTRY_PLAN_REQUEST_BODY);
  throw new EntryPlanRequiredError({ kind: "entry_plan", name: ENTRY_PLAN.name, priceMonthlyMinor: ENTRY_PLAN.priceMonthlyMinor, includedCreditsMinor: ENTRY_PLAN.includedCreditsMinor, currency: "USD", inboxItemId: item?.id ?? null });
}

/**
 * Whether the business may start AI runs: always with the switch off; with it on, when one of its founders holds an
 * active entry plan. A simulated plan counts only on a fully simulated stack (`paidEntryLive`): wherever billing, model
 * calls or integrations run live, or simulated payments are off, only a plan paid on Stripe opens work.
 */
export async function entryPlanOpen(db: Executor, env: PaymentsEnv, businessId: string): Promise<boolean> {
  if (!paidEntry(env)) return true;
  return repos.accountPlans.ownerHasActivePlan(db, businessId, { live: paidEntryLive(env) });
}

/** `entryPlanOpen` for an account before its project exists (commit): whether this person holds an active plan. */
export async function accountPlanOpen(db: Executor, env: PaymentsEnv, userId: string): Promise<boolean> {
  if (!paidEntry(env)) return true;
  const plan = await repos.accountPlans.forUser(db, userId);
  return plan?.status === "active" && (plan.mode === "live" || !paidEntryLive(env));
}

/** Refuses an AI run (402) while `entryPlanOpen` is false. */
export async function assertEntryPlan(db: Executor, env: PaymentsEnv, businessId: string): Promise<void> {
  if (!(await entryPlanOpen(db, env, businessId))) throw new EntryPlanRequiredError();
}

/** A top-up's price and the credits it grants: any amount in range with the switch off; one of the packs with it on. */
export function topUpCredits(env: PaymentsEnv, amountMinor: number): { creditsMinor: number | null } {
  if (!paidEntry(env)) return { creditsMinor: null };
  const credits = creditPackCreditsMinor(amountMinor);
  if (credits === null) throw new AppError("validation", `Credits come in packs of ${CREDIT_PACKS_MINOR.map((m) => `$${m / 100}`).join(", ")}.`, 400);
  return { creditsMinor: credits === amountMinor ? null : credits };
}

export interface TierAvailability {
  tier: TierKey;
  available: boolean;
  reason: string | null;
}

/** Why Founder and Studio cannot be chosen yet, true of the stage: nothing here promises a date or that anything stays free. */
export function plansClosedReason(stage: EarlyAccessStage = EARLY_ACCESS_STAGE): string {
  return stage === "open"
    ? `${planName("pro")} and ${planName("scale")} open once their checkout is ready. Until then your own Anthropic key works on every plan.`
    : `${APP_NAME} is free while in early access, so there is nothing to choose yet: every plan has everything listed here. ${planName("pro")} and ${planName("scale")} open when sign-up opens. Your own Anthropic key works on every plan.`;
}

/** Whether `tier` can be chosen here (see the module comment). */
export function tierAvailability(env: Pick<Env, "APP_ENV">, tier: TierKey, stage: EarlyAccessStage = EARLY_ACCESS_STAGE): TierAvailability {
  if (!tierIsPaid(tier) || testMode(env)) return { tier, available: true, reason: null };
  return { tier, available: false, reason: plansClosedReason(stage) };
}

export const SUBSCRIPTIONS_CLOSED_MESSAGE = `No subscription is charged while ${APP_NAME} is in early access.`;

/**
 * The gate every subscription charge passes, whatever opens it (WP-09 T16's checkout, a webhook, a renewal): refused
 * (412) while sign-up is invite-only. There is no way around it in configuration: the stage is a constant in code.
 */
export function assertSubscriptionChargingOpen(stage: EarlyAccessStage = EARLY_ACCESS_STAGE): void {
  if (!subscriptionChargingOpen(stage)) throw new AppError("subscriptions_closed", SUBSCRIPTIONS_CLOSED_MESSAGE, 412);
}

/** Refuses Founder or Studio while it is not on sale (412). */
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
export function billingReturnUrls(appUrl: string, businessId: string, checkoutId: string, tab: "billing" | "integrations" = "billing"): { successUrl: string; cancelUrl: string } {
  const base = new URL(`/b/${businessId}/settings/${tab}`, appUrl);
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
export async function startCreditCheckout(
  deps: StartCheckoutDeps,
  input: { businessId: string; userId: string; email: string | null; amountMinor: number; kind?: "credits" | "subscription" | "domain"; creditsMinor?: number | null; resume?: "continue" | null; domainName?: string },
): Promise<StartedCheckout> {
  const availability = topUpAvailability(deps.env);
  if (!availability.available) throw new AppError("payments_unavailable", availability.reason ?? MOCK_PAYMENTS_OFF_MESSAGE, 412);
  const kind = input.kind ?? "credits";
  const row = await repos.checkouts.create(deps.db, input.businessId, { kind, mode: availability.mode, amountMinor: input.amountMinor, createdBy: input.userId, ...(input.creditsMinor ? { creditsMinor: input.creditsMinor } : {}), ...(input.resume ? { resume: input.resume } : {}), ...(input.domainName ? { domainName: input.domainName } : {}) });
  // A domain's payment returns to Settings › Integrations, where its registration finishes.
  const { successUrl, cancelUrl } = billingReturnUrls(deps.env.APP_URL, input.businessId, row.id, kind === "domain" ? "integrations" : "billing");
  if (availability.mode === "mock") {
    // Simulated: no vendor is called, so the gateway is not needed. The checkout page is the Billing tab itself.
    const checkout = await repos.checkouts.attachSession(deps.db, input.businessId, row.id, { mode: "mock", externalId: `cs_mock_${row.id.replace(/-/g, "")}`, checkoutUrl: successUrl, expiresAt: new Date(Date.now() + MOCK_CHECKOUT_TTL_MS) });
    return { checkout, checkoutUrl: successUrl, mode: "mock" };
  }
  let created;
  try {
    created = await deps.gateway.createCheckout({ businessId: input.businessId, checkoutId: row.id, kind, amountMinor: input.amountMinor, currency: "USD", description: kind === "subscription" ? ENTRY_PLAN_DESCRIPTION : kind === "domain" ? `${input.domainName} for one year` : CHECKOUT_DESCRIPTION, successUrl, cancelUrl, ...(input.email ? { customerEmail: input.email } : {}) });
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
  return { id: c.id, kind: c.kind, status: c.status, mode: c.mode, creditsMinor: c.creditsMinor === null ? null : Number(c.creditsMinor), resume: c.resume, amountMinor: Number(c.amountMinor), currency: c.currency, createdAt: c.createdAt, paidAt: c.paidAt, expiresAt: c.expiresAt, failure: c.failure };
}
