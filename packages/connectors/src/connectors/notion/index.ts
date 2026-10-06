/** Live Notion connector: per-business OAuth token (public integration) with Notion-Version 2025-09-03. */
import { uuid } from "@founder-manager/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { basicAuth, createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { notionMock } from "./mock";
import { mapBlock, mapPage, NOTION_BASE_URL, NOTION_KEY, NOTION_RATE_LIMITS, NOTION_VERSION, notionTools, paragraphBlock, type NotionBlock, type NotionList, type NotionPage } from "./tools";

export function createNotionConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const http = (token: string): HttpClient => createHttp({ connectorKey: NOTION_KEY, baseUrl: NOTION_BASE_URL, fetch, headers: { authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION } });
  const forCtx = (ctx: ToolContext): HttpClient => {
    if (!ctx.credential?.secret) throw new ConfigError(NOTION_KEY, "Notion OAuth token", "connect Notion in Settings → Integrations");
    return http(ctx.credential.secret);
  };

  return buildLiveConnector(
    {
      key: NOTION_KEY,
      displayName: "Notion",
      phase: 1,
      auth: { kind: "oauth", scopes: ["read_content", "insert_content", "update_content"] },
      tools: notionTools,
      rateLimits: NOTION_RATE_LIMITS,
      now,
      handlers: {
        search: async ({ query, filter, pageSize }, ctx) => {
          const res = await forCtx(ctx).json<NotionList<NotionPage>>("POST", "/search", { body: { query, page_size: pageSize, ...(filter ? { filter: { property: "object", value: filter } } : {}) } });
          return { items: res.results.map((p) => { const { properties: _p, ...rest } = mapPage(p); return rest; }), nextCursor: res.next_cursor };
        },
        get_page: async ({ pageId }, ctx) => mapPage(await forCtx(ctx).json<NotionPage>("GET", `/pages/${pageId}`)),
        get_page_content: async ({ blockId, pageSize, startCursor }, ctx) => {
          const res = await forCtx(ctx).json<NotionList<NotionBlock>>("GET", `/blocks/${blockId}/children`, { query: { page_size: pageSize, start_cursor: startCursor } });
          return { blocks: res.results.map(mapBlock), nextCursor: res.next_cursor };
        },
        query_data_source: async ({ dataSourceId, pageSize, startCursor }, ctx) => {
          const res = await forCtx(ctx).json<NotionList<NotionPage>>("POST", `/data_sources/${dataSourceId}/query`, { body: { page_size: pageSize, ...(startCursor ? { start_cursor: startCursor } : {}) } });
          return { items: res.results.map(mapPage), nextCursor: res.next_cursor };
        },
        create_page: async ({ parentPageId, parentDataSourceId, title, paragraphs }, ctx) => {
          const body = parentPageId
            ? { parent: { page_id: parentPageId }, properties: { title: { title: [{ text: { content: title } }] } }, children: paragraphs.map(paragraphBlock) }
            : { parent: { data_source_id: parentDataSourceId }, properties: { Name: { title: [{ text: { content: title } }] } }, children: paragraphs.map(paragraphBlock) };
          const page = await forCtx(ctx).json<NotionPage>("POST", "/pages", { body });
          return { id: page.id, url: page.url ?? null };
        },
        append_paragraphs: async ({ blockId, paragraphs }, ctx) => {
          const res = await forCtx(ctx).json<NotionList<NotionBlock>>("PATCH", `/blocks/${blockId}/children`, { body: { children: paragraphs.map(paragraphBlock) } });
          return { appended: res.results.length };
        },
      },
      connect: async (businessId, input) => {
        // OAuth code exchange (public integration): POST /oauth/token with Basic client credentials.
        const code = typeof input === "object" && input && typeof (input as { code?: unknown }).code === "string" ? (input as { code: string; redirectUri?: string }) : null;
        if (!code) throw new ConfigError(NOTION_KEY, "OAuth authorization code", "connect() expects { code, redirectUri } from the Notion OAuth redirect");
        if (!secrets.notionClientId || !secrets.notionClientSecret) throw new ConfigError(NOTION_KEY, "NOTION_CLIENT_ID / NOTION_CLIENT_SECRET");
        const res = await createHttp({ connectorKey: NOTION_KEY, baseUrl: NOTION_BASE_URL, fetch, headers: { authorization: basicAuth(secrets.notionClientId, secrets.notionClientSecret), "notion-version": NOTION_VERSION } }).json<{ access_token: string; workspace_name?: string; workspace_id?: string; bot_id?: string }>("POST", "/oauth/token", { body: { grant_type: "authorization_code", code: code.code, redirect_uri: code.redirectUri } });
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: NOTION_KEY, status: "connected", scopes: ["read_content", "insert_content", "update_content"], accountLabel: res.workspace_name ?? "Notion workspace", externalAccountId: res.workspace_id ?? null,
          config: { botId: res.bot_id ?? null }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt, credentialToStore: { kind: "oauth", secret: res.access_token },
        };
      },
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        // Per-business tokens are only available inside a call; health here checks platform configuration.
        if (!secrets.notionClientId) return healthResult("disconnected", startedAt, { now, message: "NOTION_CLIENT_ID not configured" });
        return healthResult(integration.status === "mock" ? "connected" : integration.status, startedAt, { now });
      },
    },
    notionMock,
  );
}

export { notionMock, createNotionMock } from "./mock";
export { notionTools, NOTION_KEY, NOTION_VERSION } from "./tools";
