/**
 * Live Stripe connector over `stripe` 23 with a fetch-based HTTP client (injectable for tests). A founder connects their
 * own Stripe account one of two ways (founder, Nov 17, 2026):
 * - "Sign in with Stripe" (Stripe Connect OAuth, Standard accounts): Foundmill is the Connect platform. The account id
 *   comes only from Stripe's code exchange, which proves the founder signed in to it; calls then run on the platform's
 *   Connect key (STRIPE_CONNECT_SECRET_KEY, else STRIPE_SECRET_KEY) with `Stripe-Account`. Stripe's access token is
 *   dropped, never stored.
 * - A restricted key from the founder's own account (`ctx.credential.secret`), sealed by the gateway.
 * The platform key alone never acts for a business; the one exception is Foundmill's own billing (see `forCtx`).
 * Webhook secrets: per-business (`stripe_webhook_secret`) → platform (the Connect endpoint).
 *
 * Money only comes in (CLAUDE.md "Never"): no tool with a handler refunds, pays out, transfers or cancels; those stay
 * hard-gated cards the founder acts on in Stripe (`stripe.test.ts` "money never goes out" guards it).
 */
import Stripe from "stripe";
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, type Connector, type IntegrationRecord, type ToolContext } from "../../contract";
import { authorizeUrl, consentRecord, consentStartOf, hasAuthorizationCode } from "../_shared/oauth-consent";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { stripeMock } from "./mock";
import { mapAccount, mapBalance, mapCharge, mapCheckoutSession, mapCustomer, mapInvoice, mapPayout, STRIPE_API_VERSION, STRIPE_AUTH, STRIPE_CONNECT_AUTHORIZE_URL, STRIPE_CONNECT_FIELDS, STRIPE_KEY, STRIPE_RATE_LIMITS, stripeTools, type StAccount, type StBalance, type StCharge, type StCheckoutSession, type StCustomer, type StInvoice, type StPayout } from "./tools";
import { createStripeWebhook } from "./webhooks";

/**
 * The integration record of Foundmill's own billing on the platform Stripe account (credit top-ups, apps/gateway
 * billing.ts): the nil id, which no stored integration row has, and no credential.
 */
export const PLATFORM_BILLING_INTEGRATION_ID = "00000000-0000-0000-0000-000000000000";

export function isPlatformBillingIntegration(integration: IntegrationRecord): boolean {
  return integration.id === PLATFORM_BILLING_INTEGRATION_ID && integration.credentialRef === null && (integration.config as { kind?: unknown } | null)?.kind === "platform";
}

export function createStripeConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, getBusinessSecret, resolveBusinessId } = resolveLiveOptions(options);

  const client = (apiKey: string | undefined): Stripe => {
    if (!apiKey) throw new ConfigError(STRIPE_KEY, "STRIPE_SECRET_KEY or a per-business Stripe key", "paste the secret key from the Stripe dashboard");
    return new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, httpClient: Stripe.createFetchHttpClient(fetch), maxNetworkRetries: 1, timeout: 20_000, telemetry: false });
  };
  /** The platform key that acts for connected accounts: the Connect key of the client id's mode, else the platform key. */
  const connectKey = (): string | undefined => secrets.stripeConnectSecretKey ?? secrets.stripeSecretKey;
  const connectAccountOf = (integration: IntegrationRecord): string | null => ((integration.config as { kind?: unknown } | null)?.kind === "connect" && integration.externalAccountId ? integration.externalAccountId : null);
  /**
   * Which Stripe account a call reaches, and with what key. The platform key acts for a business only through the account
   * the business signed in with (Stripe-Account); alone it would reach Foundmill's own Stripe account, which no business
   * may use. The one exception is Foundmill's own billing: the gateway opens a credit top-up checkout on the platform
   * account (apps/gateway billing.ts), with the platform integration record no stored row can be
   * (`PLATFORM_BILLING_INTEGRATION_ID`), and only for a checkout.
   */
  const stripeFor = (integration: IntegrationRecord, secret: string | undefined, use: { platformBilling?: boolean } = {}) => {
    if (use.platformBilling === true && isPlatformBillingIntegration(integration)) return { stripe: client(secrets.stripeSecretKey), opts: {} as Stripe.RequestOptions };
    const account = connectAccountOf(integration);
    if (account) return { stripe: client(connectKey()), opts: { stripeAccount: account } as Stripe.RequestOptions };
    if (secret) return { stripe: client(secret), opts: {} as Stripe.RequestOptions };
    throw new ConfigError(STRIPE_KEY, "a Stripe sign-in or a restricted key for this business", "connect Stripe in Settings → Integrations");
  };
  const forCtx = (ctx: ToolContext, use: { platformBilling?: boolean } = {}) => stripeFor(ctx.integration, ctx.credential?.secret, use);

  const accountRecord = (businessId: string, acct: StAccount, kind: "own" | "connect", credential: { kind: "api_key"; secret: string } | null): IntegrationRecord => {
    const createdAt = now().toISOString();
    return {
      id: uuid(), businessId, connectorKey: STRIPE_KEY, status: "connected", scopes: ["read_write"], accountLabel: mapAccount(acct).businessName ?? acct.id, externalAccountId: acct.id,
      config: { kind, country: acct.country ?? null, defaultCurrency: acct.default_currency?.toUpperCase() ?? null, chargesEnabled: acct.charges_enabled ?? false, payoutsEnabled: acct.payouts_enabled ?? false },
      credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
      ...(credential ? { credentialToStore: credential } : {}),
    };
  };

  const webhook = createStripeWebhook({
    secretFor: async (businessId) => (businessId && getBusinessSecret ? await getBusinessSecret(businessId, "stripe_webhook_secret") : null) ?? secrets.stripeWebhookSecret ?? null,
    resolveBusinessId,
    now,
  });

  return buildLiveConnector(
    {
      key: STRIPE_KEY,
      displayName: "Stripe",
      phase: 2,
      auth: STRIPE_AUTH,
      tools: stripeTools,
      rateLimits: STRIPE_RATE_LIMITS,
      connectFields: STRIPE_CONNECT_FIELDS,
      now,
      webhooks: [webhook],
      handlers: {
        get_account: async (_a, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const acct = opts.stripeAccount ? await stripe.accounts.retrieve(opts.stripeAccount) : await stripe.accounts.retrieve(null);
          return mapAccount(acct as unknown as StAccount);
        },
        get_balance: async (_a, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          return mapBalance((await stripe.balance.retrieve({}, opts)) as unknown as StBalance);
        },
        list_customers: async ({ email, limit, startingAfter }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const res = await stripe.customers.list({ email, limit, starting_after: startingAfter }, opts);
          return { items: (res.data as unknown as StCustomer[]).map(mapCustomer), hasMore: res.has_more };
        },
        get_customer: async ({ customerId }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const c = (await stripe.customers.retrieve(customerId, {}, opts)) as unknown as StCustomer;
          if (c.deleted) throw Object.assign(new Error(`customer ${customerId} is deleted`), { status: 404 });
          return mapCustomer(c);
        },
        create_customer: async ({ email, name, metadata }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const existing = await stripe.customers.list({ email, limit: 1 }, opts);
          if (existing.data[0]) return mapCustomer(existing.data[0] as unknown as StCustomer);
          return mapCustomer((await stripe.customers.create({ email, name, metadata }, opts)) as unknown as StCustomer);
        },
        list_invoices: async ({ customerId, status, limit }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const res = await stripe.invoices.list({ customer: customerId, status, limit }, opts);
          return { items: (res.data as unknown as StInvoice[]).map(mapInvoice), hasMore: res.has_more };
        },
        get_invoice: async ({ invoiceId }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          return mapInvoice((await stripe.invoices.retrieve(invoiceId, {}, opts)) as unknown as StInvoice);
        },
        create_invoice: async ({ customerId, currency, lines, daysUntilDue, memo }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const draft = await stripe.invoices.create({ customer: customerId, collection_method: "send_invoice", days_until_due: daysUntilDue, currency: currency.toLowerCase(), description: memo, auto_advance: false }, opts);
          for (const l of lines) await stripe.invoiceItems.create({ customer: customerId, invoice: draft.id, amount: l.amountMinor * l.quantity, currency: currency.toLowerCase(), description: l.description }, opts);
          return mapInvoice((await stripe.invoices.finalizeInvoice(draft.id, {}, opts)) as unknown as StInvoice);
        },
        send_invoice: async ({ invoiceId }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          return mapInvoice((await stripe.invoices.sendInvoice(invoiceId, {}, opts)) as unknown as StInvoice);
        },
        create_checkout_session: async ({ mode, priceId, lines, successUrl, cancelUrl, customerEmail, customerId, metadata }, ctx) => {
          const { stripe, opts } = forCtx(ctx, { platformBilling: true });
          const session = await stripe.checkout.sessions.create(
            {
              mode,
              success_url: successUrl,
              cancel_url: cancelUrl,
              customer: customerId,
              customer_email: customerId ? undefined : customerEmail,
              metadata,
              line_items: priceId ? [{ price: priceId, quantity: 1 }] : lines.map((l) => ({ quantity: l.quantity, price_data: { currency: l.currency.toLowerCase(), unit_amount: l.amountMinor, product_data: { name: l.description } } })),
            },
            opts,
          );
          return mapCheckoutSession(session as unknown as StCheckoutSession);
        },
        // A founder's own Stripe account only (never the platform key): the key makes a retry return the same link.
        create_payment_link: async ({ key, label, amountMinor, currency, afterPaymentMessage }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const price = await stripe.prices.create({ currency: currency.toLowerCase(), unit_amount: amountMinor, product_data: { name: label } }, { ...opts, idempotencyKey: `paylink:${ctx.businessId}:${key}:price` });
          const link = await stripe.paymentLinks.create(
            { line_items: [{ price: price.id, quantity: 1 }], ...(afterPaymentMessage ? { custom_text: { submit: { message: afterPaymentMessage } } } : {}) },
            { ...opts, idempotencyKey: `paylink:${ctx.businessId}:${key}` },
          );
          return { id: link.id, url: link.url };
        },
        // Only on the platform account, for Foundmill's own subscribers: never on a business's connected account.
        create_billing_portal_session: async ({ customerId, returnUrl }, ctx) => {
          if (!isPlatformBillingIntegration(ctx.integration)) throw Object.assign(new Error("The billing portal is for the platform's own billing only"), { status: 403 });
          const { stripe, opts } = forCtx(ctx, { platformBilling: true });
          const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl }, opts);
          return { id: session.id, url: session.url };
        },
        list_charges: async ({ customerId, limit }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          const page = await stripe.charges.list({ limit, ...(customerId ? { customer: customerId } : {}) }, opts);
          return { items: (page.data as unknown as StCharge[]).map(mapCharge), hasMore: page.has_more };
        },
        list_payouts: async ({ limit }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          return { items: ((await stripe.payouts.list({ limit }, opts)).data as unknown as StPayout[]).map(mapPayout) };
        },
      },
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        // An account id alone proves nothing: Stripe's code exchange, or a key issued by the account itself, is the proof
        // (audit VGPC-X1: otherwise a founder could bind another business's account and read its name and currency).
        if (!apiKey && connectInputValue(input, "accountId")) throw new ConnectInputError(STRIPE_KEY, "accountId", "An account id alone does not prove the Stripe account is yours. Sign in with Stripe, or use a restricted key from the account itself.");
        if (apiKey) {
          const acct = (await client(apiKey).accounts.retrieve(null)) as unknown as StAccount;
          return accountRecord(businessId, acct, "own", { kind: "api_key" as const, secret: apiKey });
        }
        const clientId = secrets.stripeConnectClientId;
        if (!clientId) throw new ConfigError(STRIPE_KEY, "STRIPE_CONNECT_CLIENT_ID", "register the platform with Stripe Connect (docs/DEPLOY.md §5.5)");
        // First step: Stripe's sign-in page for the account the founder chooses. Nothing is stored yet.
        if (!hasAuthorizationCode(input)) {
          const start = consentStartOf(input, "Stripe");
          return consentRecord(STRIPE_KEY, businessId, authorizeUrl(STRIPE_CONNECT_AUTHORIZE_URL, { response_type: "code", client_id: clientId, scope: "read_write", redirect_uri: start.redirectUri, state: start.state }), { now, newId: uuid });
        }
        // Second step: the code Stripe sent back names the account the founder signed in to. Stripe's access token is
        // dropped: calls run on the platform's Connect key with that account's Stripe-Account header.
        const stripe = client(connectKey());
        const token = await stripe.oauth.token({ grant_type: "authorization_code", code: (input as { code: string }).code });
        const accountId = token.stripe_user_id;
        if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new AppError("stripe_sign_in_failed", "Stripe did not name the account you signed in to. Sign in with Stripe again.", 502);
        const acct = (await stripe.accounts.retrieve(accountId)) as unknown as StAccount;
        return accountRecord(businessId, acct, "connect", null);
      },
      healthcheck: async (integration, credential) => {
        const startedAt = now().getTime();
        try {
          const { stripe, opts } = stripeFor(integration, credential?.secret);
          const acct = (opts.stripeAccount ? await stripe.accounts.retrieve(opts.stripeAccount) : await stripe.accounts.retrieve(null)) as unknown as StAccount;
          return healthResult(acct.charges_enabled === false ? "degraded" : "connected", startedAt, { now, details: { chargesEnabled: acct.charges_enabled ?? null, payoutsEnabled: acct.payouts_enabled ?? null } });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
      // Disconnecting a sign-in withdraws Foundmill's access in Stripe too; a pasted key is only forgotten (the founder
      // can delete it in their Stripe dashboard).
      disconnect: async (integration) => {
        const account = connectAccountOf(integration);
        if (!account) return false;
        if (!secrets.stripeConnectClientId) throw new ConfigError(STRIPE_KEY, "STRIPE_CONNECT_CLIENT_ID");
        await client(connectKey()).oauth.deauthorize({ client_id: secrets.stripeConnectClientId, stripe_user_id: account });
        return true;
      },
    },
    stripeMock,
  );
}

export { stripeMock, createStripeMock, signedStripeRequest, stripeEvent } from "./mock";
export { stripeTools, STRIPE_KEY } from "./tools";
export { createStripeWebhook, normaliseStripeEvent, stripeSignatureHeader, verifyStripeSignature, parseStripeSignature } from "./webhooks";
