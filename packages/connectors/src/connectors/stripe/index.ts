/**
 * Live Stripe connector over `stripe` 23 with a fetch-based HTTP client (injectable for tests). Secret
 * precedence: the business's own restricted key (`ctx.credential.secret`, BYO account) → platform
 * STRIPE_SECRET_KEY; a Connect integration (`config.kind === "connect"`) sends `Stripe-Account` with
 * `integration.externalAccountId`. Webhook secrets: per-business (`stripe_webhook_secret`) → platform.
 */
import Stripe from "stripe";
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type IntegrationRecord, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { stripeMock } from "./mock";
import { mapAccount, mapBalance, mapCheckoutSession, mapCustomer, mapInvoice, mapPayout, STRIPE_API_VERSION, STRIPE_KEY, STRIPE_BUSINESS_METADATA_KEY, STRIPE_RATE_LIMITS, stripeTools, type StAccount, type StBalance, type StCheckoutSession, type StCustomer, type StInvoice, type StPayout } from "./tools";
import { createStripeWebhook } from "./webhooks";

export function createStripeConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, getBusinessSecret, resolveBusinessId } = resolveLiveOptions(options);

  const client = (apiKey: string | undefined): Stripe => {
    if (!apiKey) throw new ConfigError(STRIPE_KEY, "STRIPE_SECRET_KEY or a per-business Stripe key", "paste the secret key from the Stripe dashboard");
    return new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, httpClient: Stripe.createFetchHttpClient(fetch), maxNetworkRetries: 1, timeout: 20_000, telemetry: false });
  };
  const requestOptions = (integration: IntegrationRecord): Stripe.RequestOptions => ((integration.config as { kind?: unknown }).kind === "connect" && integration.externalAccountId ? { stripeAccount: integration.externalAccountId } : {});
  const forCtx = (ctx: ToolContext) => ({ stripe: client(ctx.credential?.secret ?? secrets.stripeSecretKey), opts: requestOptions(ctx.integration) });

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
      auth: { kind: "oauth", scopes: ["read_write"] },
      tools: stripeTools,
      rateLimits: STRIPE_RATE_LIMITS,
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
          const { stripe, opts } = forCtx(ctx);
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
        list_payouts: async ({ limit }, ctx) => {
          const { stripe, opts } = forCtx(ctx);
          return { items: ((await stripe.payouts.list({ limit }, opts)).data as unknown as StPayout[]).map(mapPayout) };
        },
      },
      connect: async (businessId, input) => {
        const i = typeof input === "object" && input ? (input as { accountId?: unknown; apiKey?: unknown }) : {};
        const apiKey = typeof i.apiKey === "string" ? i.apiKey : undefined;
        const accountId = typeof i.accountId === "string" ? i.accountId : undefined;
        if (!apiKey && !accountId) throw new ConfigError(STRIPE_KEY, "account", "connect() expects { accountId } (Connect) or { apiKey } (own account); Connect onboarding itself is a hard gate the founder completes");
        const stripe = client(apiKey ?? secrets.stripeSecretKey);
        const acct = (accountId && !apiKey ? await stripe.accounts.retrieve(accountId) : await stripe.accounts.retrieve(null)) as unknown as StAccount;
        // An account id is a name, not a credential: the platform's own key can read any account connected to the platform, so
        // pasting an id proves nothing. The account must be one the platform created for this business (tagged with its id), or
        // the founder proves control with a key issued by the account itself (audit VGPC-X1: otherwise a founder could bind
        // another business's account and read its legal name, country and currency).
        if (accountId && !apiKey && acct.metadata?.[STRIPE_BUSINESS_METADATA_KEY] !== businessId) {
          throw new AppError("account_not_proven", "That Stripe account is not connected to this business. Connect it with a restricted API key from the account itself (Stripe dashboard → Developers → API keys); an account id alone does not prove the account is yours.", 403);
        }
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: STRIPE_KEY, status: "connected", scopes: ["read_write"], accountLabel: mapAccount(acct).businessName ?? acct.id, externalAccountId: acct.id,
          config: { kind: accountId && !apiKey ? "connect" : "own", country: acct.country ?? null, defaultCurrency: acct.default_currency?.toUpperCase() ?? null, chargesEnabled: acct.charges_enabled ?? false, payoutsEnabled: acct.payouts_enabled ?? false },
          credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          ...(apiKey ? { credentialToStore: { kind: "api_key" as const, secret: apiKey } } : {}),
        };
      },
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        try {
          const stripe = client(secrets.stripeSecretKey);
          const acct = (integration.externalAccountId ? await stripe.accounts.retrieve(integration.externalAccountId) : await stripe.accounts.retrieve(null)) as unknown as StAccount;
          return healthResult(acct.charges_enabled === false ? "degraded" : "connected", startedAt, { now, details: { chargesEnabled: acct.charges_enabled ?? null, payoutsEnabled: acct.payouts_enabled ?? null } });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    stripeMock,
  );
}

export { stripeMock, createStripeMock, signedStripeRequest, stripeEvent } from "./mock";
export { stripeTools, STRIPE_KEY } from "./tools";
export { createStripeWebhook, normaliseStripeEvent, stripeSignatureHeader, verifyStripeSignature, parseStripeSignature } from "./webhooks";
