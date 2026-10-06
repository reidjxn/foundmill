import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { extractCandidateRecipients, isUntrusted } from "../../quarantine";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { NOTION_DS_INTERVIEWS, NOTION_PAGE_BRAND, NOTION_PAGE_LAUNCH, NOTION_PAGES } from "./fixtures/workspace";
import { createNotionConnector } from "./index";
import { createNotionMock, notionMock } from "./mock";

describeConnectorContract("notion (mock)", {
  connector: notionMock,
  mode: "mock",
  calls: [
    { tool: "search", args: { query: "launch" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([NOTION_PAGE_LAUNCH]) },
    { tool: "search", args: { filter: "data_source" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(1) },
    { tool: "get_page", args: { pageId: NOTION_PAGE_BRAND }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ title: "Northwind brand guidelines" }) },
    { tool: "get_page_content", args: { blockId: NOTION_PAGE_BRAND }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { blocks: { type: string }[] }).blocks.map((b) => b.type)).toEqual(["heading_2", "paragraph", "bulleted_list_item"]) },
    { tool: "query_data_source", args: { dataSourceId: NOTION_DS_INTERVIEWS }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { properties: Record<string, string> }[] }).items[0]?.properties).toMatchObject({ Segment: "Sensitive skin", "Would pay": "49" }) },
    { tool: "create_page", args: { parentPageId: NOTION_PAGE_BRAND, title: "Tone of voice examples", paragraphs: ["Hi — we made this for you."] }, check: (r) => expect(r.data).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{32}$/) }) },
    { tool: "create_page", args: { title: "no parent" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("notion untrusted content", () => {
  it("wraps page content so injected instructions stay data and surfaces embedded recipients", async () => {
    const r = await notionMock.callTool("get_page_content", { blockId: NOTION_PAGE_LAUNCH }, makeToolContext(notionMock));
    expect(r.untrusted).toBe(true);
    expect(isUntrusted(r.data)).toBe(true);
    if (!isUntrusted(r.data)) throw new Error("expected untrusted");
    expect(r.data.source).toEqual({ connector: "notion", kind: "document", ref: `blocks:${NOTION_PAGE_LAUNCH}` });
    expect(extractCandidateRecipients(r.data.content).emails).toEqual(["attacker@example.com"]);
  });
  it("appends paragraphs in memory", async () => {
    const mock = createNotionMock();
    const ctx = makeToolContext(mock);
    expect((await mock.callTool("append_paragraphs", { blockId: NOTION_PAGE_BRAND, paragraphs: ["a", "b"] }, ctx)).data).toEqual({ appended: 2 });
    const content = await mock.callTool("get_page_content", { blockId: NOTION_PAGE_BRAND }, ctx);
    expect(isUntrusted(content.data) && (content.data.content as { blocks: unknown[] }).blocks).toHaveLength(5);
  });
});

describe("notion live (canned)", () => {
  it("sends the OAuth token and Notion-Version header, and needs a credential", async () => {
    const connector = createNotionConnector({
      secrets: { notionClientId: "cid", notionClientSecret: "cs" },
      fetch: routedFetch({
        [`GET https://api.notion.com/v1/pages/${NOTION_PAGE_BRAND}`]: (req) => {
          expect(req.headers.get("authorization")).toBe("Bearer ntn_token");
          expect(req.headers.get("notion-version")).toBe("2025-09-03");
          return jsonResponse(NOTION_PAGES[0]);
        },
      }),
    });
    const ok = await connector.callTool("get_page", { pageId: NOTION_PAGE_BRAND }, makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "ntn_token" } }));
    expect(ok.ok).toBe(true);
    await expect(connector.callTool("get_page", { pageId: NOTION_PAGE_BRAND }, makeToolContext(connector, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});
