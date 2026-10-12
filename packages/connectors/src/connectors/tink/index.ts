/**
 * Live Tink connector (continuous access). Platform credentials TINK_CLIENT_ID / TINK_CLIENT_SECRET mint a
 * client access token; the per-business credential carries the Tink `user_id` (`extra.userId`) created by
 * `connect()` plus the latest user access token (`secret`, short-lived) — when it has expired the connector
 * mints a fresh one through the authorization-grant flow. Consent itself is given by the founder in Tink
 * Link (hard gate); `connect()` returns the Tink Link URL the Settings page opens.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, reportRefreshedCredential, type Connector, type DecryptedCredential, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { addDays, isoDay } from "../../mock-utils";
import { bearer, createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { consentStatusFrom } from "../_shared/banking";
import { createClientCredentialsTokenSource } from "../_shared/oauth";
import { tinkMock } from "./mock";
import { mapTinkAccount, mapTinkTransaction, TINK_BASE_URL, TINK_KEY, TINK_LINK_ACTOR_CLIENT_ID, TINK_LINK_URL, TINK_PLATFORM_SCOPES, TINK_RATE_LIMITS, TINK_USER_SCOPES, tinkTools, type TkAccount, type TkProviderConsent, type TkTransaction } from "./tools";

export function createTinkConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const base = createHttp({ connectorKey: TINK_KEY, baseUrl: TINK_BASE_URL, fetch });

  const platformToken = () => {
    if (!secrets.tinkClientId || !secrets.tinkClientSecret) throw new ConfigError(TINK_KEY, "TINK_CLIENT_ID / TINK_CLIENT_SECRET", "create an app in the Tink console");
    return createClientCredentialsTokenSource({ http: base, tokenPath: "/api/v1/oauth/token", clientId: secrets.tinkClientId, clientSecret: secrets.tinkClientSecret, scope: TINK_PLATFORM_SCOPES, authStyle: "body", now });
  };

  /** A user access token for the business's Tink user: reuse the stored one when valid, otherwise mint. */
  const userToken = async (cred: DecryptedCredential | undefined): Promise<{ token: string; refreshed?: { accessToken: string; expiresAt: string } }> => {
    const userId = cred?.extra?.userId;
    if (!userId) throw new ConfigError(TINK_KEY, "Tink user", "connect the bank in Settings → Integrations → Tink");
    const expiresAt = cred.expiresAt ? Date.parse(cred.expiresAt) : 0;
    if (cred.secret && expiresAt - 60_000 > now().getTime()) return { token: cred.secret };
    const clientToken = await platformToken().get();
    const grant = await base.json<{ code: string }>("POST", "/api/v1/oauth/authorization-grant", { form: { user_id: userId, scope: TINK_USER_SCOPES }, headers: { authorization: bearer(clientToken) } });
    const tok = await base.json<{ access_token: string; expires_in: number }>("POST", "/api/v1/oauth/token", { form: { grant_type: "authorization_code", code: grant.code, client_id: secrets.tinkClientId, client_secret: secrets.tinkClientSecret } });
    const refreshedExpiry = new Date(now().getTime() + tok.expires_in * 1000).toISOString();
    return { token: tok.access_token, refreshed: { accessToken: tok.access_token, expiresAt: refreshedExpiry } };
  };

  const userHttp = async (ctx: ToolContext): Promise<HttpClient> => {
    const { token, refreshed } = await userToken(ctx.credential);
    if (refreshed && ctx.credential) {
      ctx.log.info({ connector: TINK_KEY, businessId: ctx.businessId }, "minted a fresh Tink user access token");
      await reportRefreshedCredential(ctx, { ...ctx.credential, secret: refreshed.accessToken, expiresAt: refreshed.expiresAt }, TINK_KEY);
    }
    return createHttp({ connectorKey: TINK_KEY, baseUrl: TINK_BASE_URL, fetch, headers: { authorization: bearer(token) } });
  };

  const consents = async (h: HttpClient) => (await h.json<{ providerConsents?: TkProviderConsent[] }>("GET", "/api/v1/provider-consents")).providerConsents ?? [];
  const consentExpiry = (list: TkProviderConsent[]): Date | null => {
    const times = list.map((c) => c.sessionExpiryDate).filter((t): t is number => typeof t === "number");
    return times.length ? new Date(Math.min(...times)) : null;
  };
  const accounts = async (h: HttpClient, institution: string | null) => ((await h.json<{ accounts?: TkAccount[] }>("GET", "/data/v2/accounts")).accounts ?? []).map((a) => mapTinkAccount(a, institution, now().toISOString()));
  const institutionOf = (ctx: ToolContext): string | null => (typeof (ctx.integration.config as { institution?: unknown }).institution === "string" ? ((ctx.integration.config as { institution: string }).institution) : null);

  return buildLiveConnector(
    {
      key: TINK_KEY,
      displayName: "Tink",
      phase: 2,
      auth: { kind: "oauth", scopes: TINK_USER_SCOPES.split(",") },
      tools: tinkTools,
      rateLimits: TINK_RATE_LIMITS,
      now,
      handlers: {
        list_accounts: async (_a, ctx) => ({ items: await accounts(await userHttp(ctx), institutionOf(ctx)) }),
        list_transactions: async ({ accountId, from, to, pageSize, pageToken }, ctx) => {
          const res = await (await userHttp(ctx)).json<{ transactions?: TkTransaction[]; nextPageToken?: string }>("GET", "/data/v2/transactions", { query: { accountIdIn: accountId, bookedDateGte: from ?? isoDay(addDays(now(), -90)), bookedDateLte: to, pageSize, pageToken } });
          return { items: (res.transactions ?? []).map(mapTinkTransaction), nextPageToken: res.nextPageToken || null };
        },
        sync: async ({ cursor }, ctx) => {
          const h = await userHttp(ctx);
          const since = cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) ? cursor : isoDay(addDays(now(), -30));
          const added: TkTransaction[] = [];
          let pageToken: string | undefined;
          do {
            const res = await h.json<{ transactions?: TkTransaction[]; nextPageToken?: string }>("GET", "/data/v2/transactions", { query: { bookedDateGte: since, pageSize: 500, pageToken } });
            added.push(...(res.transactions ?? []));
            pageToken = res.nextPageToken || undefined;
          } while (pageToken && added.length < 5_000);
          const list = await consents(h);
          return { accounts: await accounts(h, institutionOf(ctx)), newTransactions: added.map(mapTinkTransaction).filter((t) => t.bookedDate > since), cursor: isoDay(now()), hasMore: Boolean(pageToken), balanceAt: now().toISOString(), consentExpiresAt: consentExpiry(list)?.toISOString() ?? null };
        },
        get_consent_status: async (_a, ctx) => {
          const list = await consents(await userHttp(ctx));
          const revoked = list.length > 0 && list.every((c) => c.status === "SESSION_EXPIRED" || c.status === "DELETED");
          const status = consentStatusFrom(consentExpiry(list), now(), list[0]?.providerName ?? institutionOf(ctx), list.flatMap((c) => c.accountIds ?? []));
          return revoked ? { ...status, status: "revoked" as const } : status;
        },
      },
      /**
       * Step 1 (`{ market, locale }`): create the Tink user and return the Tink Link URL in `config.linkUrl` — the
       * founder opens it (hard gate). Step 2 (`{ userId }` after the redirect): mint the first user token.
       */
      connect: async (businessId, input) => {
        const i = typeof input === "object" && input ? (input as { market?: unknown; locale?: unknown; userId?: unknown; redirectUri?: unknown }) : {};
        const clientToken = await platformToken().get();
        const createdAt = now().toISOString();
        if (typeof i.userId !== "string") {
          const market = typeof i.market === "string" ? i.market : "SE";
          const user = await base.json<{ user_id: string }>("POST", "/api/v1/user/create", { body: { external_user_id: `fm:${businessId}`, market, locale: typeof i.locale === "string" ? i.locale : "en_US" }, headers: { authorization: bearer(clientToken) } });
          const delegate = await base.json<{ code: string }>("POST", "/api/v1/oauth/authorization-grant/delegate", { form: { user_id: user.user_id, id_hint: businessId, actor_client_id: TINK_LINK_ACTOR_CLIENT_ID, scope: "authorization:read,credentials:refresh,credentials:read,credentials:write,providers:read,user:read" }, headers: { authorization: bearer(clientToken) } });
          const linkUrl = `${TINK_LINK_URL}?client_id=${encodeURIComponent(secrets.tinkClientId!)}&redirect_uri=${encodeURIComponent(typeof i.redirectUri === "string" ? i.redirectUri : "")}&authorization_code=${encodeURIComponent(delegate.code)}&market=${encodeURIComponent(market)}`;
          return { id: uuid(), businessId, connectorKey: TINK_KEY, status: "disconnected", scopes: [], accountLabel: "Tink (awaiting consent)", externalAccountId: user.user_id, config: { market, linkUrl }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt, credentialToStore: { kind: "oauth", secret: "", extra: { userId: user.user_id } } };
        }
        const tok = await userToken({ kind: "oauth", secret: "", extra: { userId: i.userId } });
        const h = createHttp({ connectorKey: TINK_KEY, baseUrl: TINK_BASE_URL, fetch, headers: { authorization: bearer(tok.token) } });
        const list = await consents(h);
        const expiresAt = consentExpiry(list);
        return { id: uuid(), businessId, connectorKey: TINK_KEY, status: list.length ? "connected" : "degraded", scopes: TINK_USER_SCOPES.split(","), accountLabel: list[0]?.providerName ?? "Tink", externalAccountId: i.userId, config: { institution: list[0]?.providerName ?? null }, credentialRef: null, expiresAt: expiresAt?.toISOString() ?? null, lastHealthAt: createdAt, createdAt, credentialToStore: { kind: "oauth", secret: tok.token, expiresAt: tok.refreshed?.expiresAt, extra: { userId: i.userId } } };
      },
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        try {
          if (!integration.externalAccountId) return healthResult("disconnected", startedAt, { now, message: "no Tink user" });
          const tok = await userToken({ kind: "oauth", secret: "", extra: { userId: integration.externalAccountId } });
          const list = await consents(createHttp({ connectorKey: TINK_KEY, baseUrl: TINK_BASE_URL, fetch, headers: { authorization: bearer(tok.token) } }));
          const expiry = consentExpiry(list);
          return healthResult(expiry && expiry.getTime() < now().getTime() ? "expired" : list.length ? "connected" : "degraded", startedAt, { now, details: { consents: list.length, expiresAt: expiry?.toISOString() ?? null } });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    tinkMock,
  );
}

export { tinkMock, createTinkMock, tinkMockOptions } from "./mock";
export { tinkTools, TINK_KEY } from "./tools";
