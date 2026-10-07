/**
 * Live Plaid connector. Platform credentials PLAID_CLIENT_ID / PLAID_SECRET (+ PLAID_ENV) go in every request
 * body; the per-business credential is the Item `access_token` from `connect({ publicToken })` after the
 * founder completes Plaid Link (hard gate). `connect({ redirectUri })` first returns a `link_token` in
 * `config.linkToken` for the Settings page to open Link with.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { addDays, isoDay } from "../../mock-utils";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { consentStatusFrom } from "../_shared/banking";
import { plaidMock } from "./mock";
import { mapPlaidAccount, mapPlaidTransaction, PLAID_ENV_URLS, PLAID_KEY, PLAID_PRODUCTS, PLAID_RATE_LIMITS, plaidTools, type PlAccount, type PlItem, type PlSyncResponse, type PlTransaction } from "./tools";

export function createPlaidConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);

  const http = (): HttpClient => {
    if (!secrets.plaidClientId || !secrets.plaidSecret) throw new ConfigError(PLAID_KEY, "PLAID_CLIENT_ID / PLAID_SECRET", "create the keys in the Plaid dashboard");
    return createHttp({ connectorKey: PLAID_KEY, baseUrl: PLAID_ENV_URLS[secrets.plaidEnv ?? "sandbox"], fetch, headers: { "plaid-version": "2020-09-14" } });
  };
  const auth = () => ({ client_id: secrets.plaidClientId, secret: secrets.plaidSecret });
  const accessToken = (ctx: ToolContext): string => {
    if (!ctx.credential?.secret) throw new ConfigError(PLAID_KEY, "Plaid access token", "connect the bank in Settings → Integrations → Plaid");
    return ctx.credential.secret;
  };
  const post = <T>(h: HttpClient, path: string, body: Record<string, unknown>) => h.json<T>("POST", path, { body: { ...auth(), ...body } });

  const item = async (h: HttpClient, token: string) => (await post<{ item: PlItem }>(h, "/item/get", { access_token: token })).item;
  const institutionOf = (ctx: ToolContext, it?: PlItem): string | null => it?.institution_name ?? (typeof (ctx.integration.config as { institution?: unknown }).institution === "string" ? (ctx.integration.config as { institution: string }).institution : null);
  const accounts = async (h: HttpClient, token: string, institution: string | null) => (await post<{ accounts: PlAccount[] }>(h, "/accounts/balance/get", { access_token: token })).accounts.map((a) => mapPlaidAccount(a, institution, now().toISOString()));

  return buildLiveConnector(
    {
      key: PLAID_KEY,
      displayName: "Plaid",
      phase: 2,
      auth: { kind: "oauth", scopes: PLAID_PRODUCTS },
      tools: plaidTools,
      rateLimits: PLAID_RATE_LIMITS,
      now,
      handlers: {
        list_accounts: async (_a, ctx) => ({ items: await accounts(http(), accessToken(ctx), institutionOf(ctx)) }),
        list_transactions: async ({ accountId, from, to, pageSize, pageToken }, ctx) => {
          const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;
          const res = await post<{ transactions: PlTransaction[]; total_transactions: number }>(http(), "/transactions/get", { access_token: accessToken(ctx), start_date: from ?? isoDay(addDays(now(), -90)), end_date: to ?? isoDay(now()), options: { count: pageSize, offset, ...(accountId ? { account_ids: [accountId] } : {}) } });
          return { items: res.transactions.map(mapPlaidTransaction), nextPageToken: offset + pageSize < res.total_transactions ? String(offset + pageSize) : null };
        },
        sync: async ({ cursor }, ctx) => {
          const h = http();
          const token = accessToken(ctx);
          const added: PlTransaction[] = [];
          let next = cursor ?? "";
          let hasMore = true;
          let pages = 0;
          while (hasMore && pages < 20) {
            const res = await post<PlSyncResponse>(h, "/transactions/sync", { access_token: token, cursor: next || undefined, count: 500 });
            added.push(...res.added);
            next = res.next_cursor;
            hasMore = res.has_more;
            pages += 1;
          }
          const it = await item(h, token);
          return { accounts: await accounts(h, token, institutionOf(ctx, it)), newTransactions: added.map(mapPlaidTransaction), cursor: next, hasMore, balanceAt: now().toISOString(), consentExpiresAt: it.consent_expiration_time ?? null };
        },
        get_consent_status: async (_a, ctx) => {
          const h = http();
          const token = accessToken(ctx);
          const it = await item(h, token);
          const status = consentStatusFrom(it.consent_expiration_time ? new Date(it.consent_expiration_time) : null, now(), institutionOf(ctx, it), (await post<{ accounts: PlAccount[] }>(h, "/accounts/get", { access_token: token })).accounts.map((a) => a.account_id));
          return it.error?.error_code === "ITEM_LOGIN_REQUIRED" ? { ...status, status: "revoked" as const } : status;
        },
      },
      connect: async (businessId, input) => {
        const i = typeof input === "object" && input ? (input as { publicToken?: unknown; redirectUri?: unknown; countryCodes?: unknown }) : {};
        const h = http();
        const createdAt = now().toISOString();
        if (typeof i.publicToken !== "string") {
          const link = await post<{ link_token: string; expiration: string }>(h, "/link/token/create", { user: { client_user_id: businessId }, client_name: "Founder Manager", products: PLAID_PRODUCTS, country_codes: Array.isArray(i.countryCodes) ? i.countryCodes : ["US"], language: "en", redirect_uri: typeof i.redirectUri === "string" ? i.redirectUri : undefined });
          return { id: uuid(), businessId, connectorKey: PLAID_KEY, status: "disconnected", scopes: [], accountLabel: "Plaid (awaiting Link)", externalAccountId: null, config: { env: secrets.plaidEnv ?? "sandbox", linkToken: link.link_token, linkTokenExpiresAt: link.expiration }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
        }
        const ex = await post<{ access_token: string; item_id: string }>(h, "/item/public_token/exchange", { public_token: i.publicToken });
        const it = await item(h, ex.access_token);
        return { id: uuid(), businessId, connectorKey: PLAID_KEY, status: "connected", scopes: PLAID_PRODUCTS, accountLabel: it.institution_name ?? "Plaid", externalAccountId: ex.item_id, config: { env: secrets.plaidEnv ?? "sandbox", institution: it.institution_name ?? null, institutionId: it.institution_id ?? null }, credentialRef: null, expiresAt: it.consent_expiration_time ?? null, lastHealthAt: createdAt, createdAt, credentialToStore: { kind: "oauth", secret: ex.access_token, extra: { itemId: ex.item_id } } };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          // The Item access token is a per-business secret the host injects per call; the platform keys are checked here.
          await post<{ categories: unknown[] }>(http(), "/categories/get", {});
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    plaidMock,
  );
}

export { plaidMock, createPlaidMock, plaidMockOptions } from "./mock";
export { plaidTools, PLAID_KEY } from "./tools";
