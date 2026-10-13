/** Live Cloudflare DNS connector: API token (Bearer) scoped to Zone:Read + DNS:Edit, per business or platform. */
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { cloudflareDnsMock } from "./mock";
import { analyseEmailAuth, assertRecordIs, CLOUDFLARE_BASE_URL, CLOUDFLARE_KEY, CLOUDFLARE_RATE_LIMITS, cloudflareTools, mapRecord, mapZone, type CfEnvelope, type CfRecord, type CfZone } from "./tools";

export function createCloudflareDnsConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const http = (ctx?: ToolContext): HttpClient => {
    const token = ctx?.credential?.secret ?? secrets.cloudflareApiToken;
    if (!token) throw new ConfigError(CLOUDFLARE_KEY, "CLOUDFLARE_API_TOKEN or a per-business token", "create an API token with Zone:Read and DNS:Edit");
    return createHttp({ connectorKey: CLOUDFLARE_KEY, baseUrl: CLOUDFLARE_BASE_URL, fetch, headers: { authorization: `Bearer ${token}` } });
  };
  const unwrap = <T>(env: CfEnvelope<T>): T => {
    if (!env.success) throw Object.assign(new Error(env.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || "Cloudflare request failed"), { status: 400 });
    return env.result;
  };
  const listAll = async (h: HttpClient, zoneId: string, query: Record<string, string | undefined> = {}) => {
    const res = unwrap(await h.json<CfEnvelope<CfRecord[]>>("GET", `/zones/${zoneId}/dns_records`, { query: { per_page: 500, ...query } }));
    return res.map((r) => mapRecord(zoneId, r));
  };
  const zoneName = async (h: HttpClient, zoneId: string) => mapZone(unwrap(await h.json<CfEnvelope<CfZone>>("GET", `/zones/${zoneId}`))).name;

  return buildLiveConnector(
    {
      key: CLOUDFLARE_KEY,
      displayName: "Cloudflare DNS",
      phase: 1,
      auth: { kind: "api_key" },
      tools: cloudflareTools,
      rateLimits: CLOUDFLARE_RATE_LIMITS,
      now,
      handlers: {
        list_zones: async (_a, ctx) => ({ items: unwrap(await http(ctx).json<CfEnvelope<CfZone[]>>("GET", "/zones", { query: { per_page: 50 } })).map(mapZone) }),
        list_records: async ({ zoneId, type, name }, ctx) => ({ items: await listAll(http(ctx), zoneId, { type, name }) }),
        create_record: async ({ zoneId, ...fields }, ctx) => mapRecord(zoneId, unwrap(await http(ctx).json<CfEnvelope<CfRecord>>("POST", `/zones/${zoneId}/dns_records`, { body: fields }))),
        update_record: async ({ zoneId, recordId, type, recordName, ...patch }, ctx) => {
          const h = http(ctx);
          assertRecordIs(mapRecord(zoneId, unwrap(await h.json<CfEnvelope<CfRecord>>("GET", `/zones/${zoneId}/dns_records/${recordId}`))), { type, recordName });
          return mapRecord(zoneId, unwrap(await h.json<CfEnvelope<CfRecord>>("PATCH", `/zones/${zoneId}/dns_records/${recordId}`, { body: Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) })));
        },
        delete_record: async ({ zoneId, recordId, type, recordName }, ctx) => {
          const h = http(ctx);
          assertRecordIs(mapRecord(zoneId, unwrap(await h.json<CfEnvelope<CfRecord>>("GET", `/zones/${zoneId}/dns_records/${recordId}`))), { type, recordName });
          unwrap(await h.json<CfEnvelope<{ id: string }>>("DELETE", `/zones/${zoneId}/dns_records/${recordId}`));
          return { deleted: true as const, recordId };
        },
        check_email_auth: async ({ zoneId, domain, dkimSelectors }, ctx) => {
          const h = http(ctx);
          return analyseEmailAuth(domain ?? (await zoneName(h, zoneId)), await listAll(h, zoneId), dkimSelectors);
        },
      },
      connect: async (businessId, input) => {
        const token = typeof input === "object" && input && typeof (input as { apiToken?: unknown }).apiToken === "string" ? (input as { apiToken: string }).apiToken : undefined;
        const h = createHttp({ connectorKey: CLOUDFLARE_KEY, baseUrl: CLOUDFLARE_BASE_URL, fetch, headers: { authorization: `Bearer ${token ?? secrets.cloudflareApiToken ?? ""}` } });
        if (!token && !secrets.cloudflareApiToken) throw new ConfigError(CLOUDFLARE_KEY, "CLOUDFLARE_API_TOKEN");
        const zones = unwrap(await h.json<CfEnvelope<CfZone[]>>("GET", "/zones", { query: { per_page: 50 } })).map(mapZone);
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: CLOUDFLARE_KEY, status: "connected", scopes: ["zone:read", "dns:edit"], accountLabel: zones.map((z) => z.name).join(", ") || "Cloudflare", externalAccountId: null,
          config: { zoneIds: zones.map((z) => z.id) }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          ...(token ? { credentialToStore: { kind: "api_key" as const, secret: token } } : {}),
        };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          unwrap(await http().json<CfEnvelope<unknown>>("GET", "/user/tokens/verify"));
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    cloudflareDnsMock,
  );
}

export { cloudflareDnsMock, createCloudflareMock } from "./mock";
export { cloudflareTools, CLOUDFLARE_KEY } from "./tools";
