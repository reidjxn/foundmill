import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { NOTION_BLOCKS, NOTION_INTERVIEWS, NOTION_PAGES } from "./fixtures/workspace";
import { mapBlock, mapPage, NOTION_KEY, NOTION_RATE_LIMITS, notionTools, type NotionBlock, type NotionPage } from "./tools";

const norm = (id: string) => id.replace(/-/g, "").toLowerCase();
const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

export function createNotionMock() {
  const pages = new Map<string, NotionPage>([...NOTION_PAGES, ...NOTION_INTERVIEWS].map((p) => [p.id, p]));
  const blocks = new Map<string, NotionBlock[]>(Object.entries(NOTION_BLOCKS).map(([k, v]) => [k, [...v]]));

  const connector = buildMockConnector({
    key: NOTION_KEY,
    displayName: "Notion",
    phase: 1,
    auth: { kind: "oauth", scopes: ["read_content", "insert_content", "update_content"] },
    tools: notionTools,
    rateLimits: NOTION_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      search: async ({ query, filter, pageSize }) => {
        const q = query.toLowerCase();
        const items = [...pages.values()].map(mapPage).filter((p) => (!filter || p.object === filter) && (!q || p.title.toLowerCase().includes(q))).slice(0, pageSize);
        return { items: items.map(({ properties: _p, ...rest }) => rest), nextCursor: null };
      },
      get_page: async ({ pageId }) => {
        const p = pages.get(norm(pageId));
        if (!p || p.object !== "page") throw notFound(`page ${pageId}`);
        return mapPage(p);
      },
      get_page_content: async ({ blockId, pageSize }) => {
        if (!pages.has(norm(blockId)) && !blocks.has(norm(blockId))) throw notFound(`block ${blockId}`);
        return { blocks: (blocks.get(norm(blockId)) ?? []).slice(0, pageSize).map(mapBlock), nextCursor: null };
      },
      query_data_source: async ({ dataSourceId, pageSize }) => {
        const ds = pages.get(norm(dataSourceId));
        if (!ds || ds.object !== "data_source") throw notFound(`data source ${dataSourceId}`);
        return { items: [...pages.values()].filter((p) => p.parent.type === "data_source_id" && norm(String(p.parent.data_source_id)) === norm(dataSourceId)).slice(0, pageSize).map(mapPage), nextCursor: null };
      },
      create_page: async ({ parentPageId, parentDataSourceId, title, paragraphs }) => {
        const parentId = norm(parentPageId ?? parentDataSourceId ?? "");
        if (!pages.has(parentId)) throw notFound(`parent ${parentId}`);
        const id = stableHash(["notion-page", parentId, title], 32);
        const page: NotionPage = { object: "page", id, url: `https://www.notion.so/${id}`, last_edited_time: MOCK_NOW.toISOString(), parent: parentPageId ? { type: "page_id", page_id: parentId } : { type: "data_source_id", data_source_id: parentId }, properties: { title: { type: "title", title: [{ plain_text: title }] } } };
        pages.set(id, page);
        blocks.set(id, paragraphs.map((text, i) => ({ id: stableHash([id, i], 32), type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: text }] } })));
        return { id, url: page.url ?? null };
      },
      append_paragraphs: async ({ blockId, paragraphs }) => {
        const id = norm(blockId);
        if (!pages.has(id) && !blocks.has(id)) throw notFound(`block ${blockId}`);
        const existing = blocks.get(id) ?? [];
        blocks.set(id, [...existing, ...paragraphs.map((text, i) => ({ id: stableHash([id, existing.length + i, text], 32), type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: text }] } }))]);
        return { appended: paragraphs.length };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(NOTION_KEY, businessId, { accountLabel: "Northwind workspace (mock)", scopes: ["read_content", "insert_content", "update_content"] }),
    healthcheck: async () => mockHealth(NOTION_KEY, { pages: pages.size }),
  });
  return connector;
}

export const notionMock = createNotionMock();
