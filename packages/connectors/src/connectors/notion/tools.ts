/** Notion: search, read pages/blocks/data sources, create pages and append paragraphs (Notion-Version 2025-09-03). */
import { z } from "zod";
import { defineTool } from "../../define";

export const NOTION_KEY = "notion";
export const NOTION_BASE_URL = "https://api.notion.com/v1";
export const NOTION_VERSION = "2025-09-03";

export const NotionId = z.string().regex(/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Notion id (32 hex or UUID)");

export const PageSummary = z.object({ id: z.string(), object: z.enum(["page", "data_source"]), title: z.string(), url: z.string().nullable(), lastEditedTime: z.string(), parent: z.object({ type: z.string(), id: z.string().nullable() }) });
export const Block = z.object({ id: z.string(), type: z.string(), text: z.string(), hasChildren: z.boolean() });

export const notionTools = [
  defineTool({
    name: "search",
    description: "Search pages and data sources the integration can see.",
    input: z.object({ query: z.string().max(200).default(""), filter: z.enum(["page", "data_source"]).optional(), pageSize: z.number().int().min(1).max(100).default(20) }),
    output: z.object({ items: z.array(PageSummary), nextCursor: z.string().nullable() }),
    hints: {},
    untrusted: "document",
    untrustedRef: (a) => `search:${a.query}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "get_page", description: "Page metadata: title, parent, url, properties (flattened to text).", input: z.object({ pageId: NotionId }), output: PageSummary.extend({ properties: z.record(z.string(), z.string()) }), hints: {}, untrusted: "document", untrustedRef: (a) => `page:${a.pageId}`, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "get_page_content",
    description: "Child blocks of a page or block, flattened to plain text per block.",
    input: z.object({ blockId: NotionId, pageSize: z.number().int().min(1).max(100).default(100), startCursor: z.string().optional() }),
    output: z.object({ blocks: z.array(Block), nextCursor: z.string().nullable() }),
    hints: {},
    untrusted: "document",
    untrustedRef: (a) => `blocks:${a.blockId}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "query_data_source",
    description: "Rows of a data source (database) with properties flattened to text.",
    input: z.object({ dataSourceId: NotionId, pageSize: z.number().int().min(1).max(100).default(50), startCursor: z.string().optional() }),
    output: z.object({ items: z.array(PageSummary.extend({ properties: z.record(z.string(), z.string()) })), nextCursor: z.string().nullable() }),
    hints: {},
    untrusted: "document",
    untrustedRef: (a) => `data_source:${a.dataSourceId}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "create_page",
    description: "Create a page under a parent page (title + paragraphs) or as a row of a data source (title property).",
    input: z.object({ parentPageId: NotionId.optional(), parentDataSourceId: NotionId.optional(), title: z.string().min(1).max(200), paragraphs: z.array(z.string().max(2000)).max(100).default([]) }).refine((v) => Boolean(v.parentPageId) !== Boolean(v.parentDataSourceId), "exactly one of parentPageId / parentDataSourceId"),
    output: z.object({ id: z.string(), url: z.string().nullable() }),
    hints: {},
  }),
  defineTool({
    name: "append_paragraphs",
    description: "Append paragraph blocks to a page or block.",
    input: z.object({ blockId: NotionId, paragraphs: z.array(z.string().min(1).max(2000)).min(1).max(100) }),
    output: z.object({ appended: z.number().int() }),
    hints: {},
  }),
] as const;

export const NOTION_RATE_LIMITS = { perMinute: 150, perDay: 20_000 };

/* ---- Vendor shapes (subset) ---- */
export interface RichText { plain_text: string }
export interface NotionProperty { type: string; title?: RichText[]; rich_text?: RichText[]; number?: number | null; select?: { name: string } | null; multi_select?: { name: string }[]; date?: { start: string; end?: string | null } | null; checkbox?: boolean; url?: string | null; email?: string | null; status?: { name: string } | null; people?: { name?: string }[] }
export interface NotionPage { object: "page" | "data_source"; id: string; url?: string; last_edited_time: string; parent: Record<string, unknown> & { type: string }; properties?: Record<string, NotionProperty>; title?: RichText[] }
export interface NotionBlock { id: string; type: string; has_children: boolean; [type: string]: unknown }
export interface NotionList<T> { results: T[]; next_cursor: string | null; has_more: boolean }

export function propertyText(p: NotionProperty): string {
  switch (p.type) {
    case "title": return (p.title ?? []).map((t) => t.plain_text).join("");
    case "rich_text": return (p.rich_text ?? []).map((t) => t.plain_text).join("");
    case "number": return p.number === null || p.number === undefined ? "" : String(p.number);
    case "select": return p.select?.name ?? "";
    case "status": return p.status?.name ?? "";
    case "multi_select": return (p.multi_select ?? []).map((s) => s.name).join(", ");
    case "date": return p.date ? `${p.date.start}${p.date.end ? ` → ${p.date.end}` : ""}` : "";
    case "checkbox": return p.checkbox ? "true" : "false";
    case "url": return p.url ?? "";
    case "email": return p.email ?? "";
    case "people": return (p.people ?? []).map((x) => x.name ?? "").filter(Boolean).join(", ");
    default: return "";
  }
}

export function pageTitle(p: NotionPage): string {
  if (p.title) return p.title.map((t) => t.plain_text).join("");
  const titleProp = Object.values(p.properties ?? {}).find((x) => x.type === "title");
  return titleProp ? propertyText(titleProp) : "(untitled)";
}

export const mapPage = (p: NotionPage): z.infer<typeof PageSummary> & { properties: Record<string, string> } => {
  const parentId = (p.parent[`${p.parent.type}`] as string | undefined) ?? null;
  return { id: p.id, object: p.object, title: pageTitle(p), url: p.url ?? null, lastEditedTime: p.last_edited_time, parent: { type: p.parent.type, id: typeof parentId === "string" ? parentId : null }, properties: Object.fromEntries(Object.entries(p.properties ?? {}).map(([k, v]) => [k, propertyText(v)])) };
};

export function blockText(b: NotionBlock): string {
  const body = b[b.type] as { rich_text?: RichText[]; text?: RichText[]; caption?: RichText[]; url?: string; title?: string } | undefined;
  const rich = body?.rich_text ?? body?.text ?? body?.caption;
  if (rich) return rich.map((t) => t.plain_text).join("");
  if (body?.title) return body.title;
  if (body?.url) return body.url;
  return "";
}

export const mapBlock = (b: NotionBlock): z.infer<typeof Block> => ({ id: b.id, type: b.type, text: blockText(b), hasChildren: b.has_children });

export const paragraphBlock = (text: string) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } });
