/**
 * A vendor's remote MCP server through the gateway pipeline (founder, 2026-11-19), Notion's as the example:
 * - a listed read runs with the founder's sealed token, answers inside the untrusted envelope and is metered and audited;
 * - a listed write that changes the founder's pages asks first in augmented and assisted mode, and reaches no server;
 * - a tool on no list (`call_unlisted_tool`) asks first in every mode (automated included, policy 46), and a name that would cross a hard
 *   gate is denied before anyone is asked;
 * - a session sees only the tools its token names, so a server's definitions reach an agent only through its skill;
 * - mock mode answers from the recorded mock and says it was simulated; live with no sign-in is 409 and reaches no server.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createNotionMcpConnector, type Connector } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { SIMULATED_NOTICE, type AllowResponse, type AskResponse, type CallResponse } from "../types";
import { setupGateway, type GatewayFixture } from "./harness";

const TOKEN = "notion-mcp-access-token-0123456789";

function server() {
  const calls: { name: string; auth: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const auth = req.headers.get("authorization") ?? "";
    const s = new Server({ name: "fake", version: "1" }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    s.setRequestHandler(CallToolRequestSchema, async (r) => (calls.push({ name: r.params.name, auth }), { content: [{ type: "text", text: `ran ${r.params.name}` }] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(transport);
    return transport.handleRequest(req);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const live = (fetch: typeof globalThis.fetch): Connector[] => [createNotionMcpConnector({ secrets: {}, fetch })];

async function connect(g: GatewayFixture) {
  const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "notion_mcp", status: "connected", authKind: "oauth", settings: { config: { server: "https://mcp.notion.com/mcp" } } });
  await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "oauth", secret: TOKEN });
}

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome, JSON.stringify(r)).toBe("allow");
  return r as AllowResponse;
};

let open: GatewayFixture | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

const SEARCH = { connector: "notion_mcp", tool: "notion_search", args: { query: "launch" } } as const;
const UPDATE = { connector: "notion_mcp", tool: "notion_update_page", args: { page_id: "p1" } } as const;
const unlisted = (tool: string) => ({ connector: "notion_mcp", tool: "call_unlisted_tool", args: { tool, arguments: {} } }) as const;

describe("live", () => {
  it("a listed read runs on the founder's token and comes back untrusted, with no token in the answer", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "assisted", connectors: live(vendor.fetch) }));
    await connect(g);
    const token = await g.token({ allowedTools: ["notion_mcp:notion_search"] });
    const r = asAllow(await g.client.call(token, SEARCH));
    expect(r.result.ok).toBe(true);
    expect(r.result.untrusted).toBe(true);
    expect(r.result).not.toHaveProperty("simulated");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(vendor.calls).toEqual([{ name: "notion-search", auth: `Bearer ${TOKEN}` }]);
  });

  it("automated: an unlisted tool still asks first and reaches no server", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) }));
    await connect(g);
    const token = await g.token({ allowedTools: ["notion_mcp:*"] });
    expect((await g.client.call(token, unlisted("notion-brand-new"))).outcome).toBe("ask");
    expect(vendor.calls).toEqual([]);
  });

  for (const mode of ["augmented", "assisted"] as const) {
    it(`${mode}: a listed write that changes pages, and an unlisted tool, ask first and reach no server`, async () => {
      const vendor = server();
      const g = (open = await setupGateway({ mode: "live", businessMode: mode, connectors: live(vendor.fetch) }));
      await connect(g);
      const token = await g.token({ allowedTools: ["notion_mcp:*"] });
      for (const call of [UPDATE, unlisted("notion-brand-new")]) {
        const r = await g.client.call(token, call);
        expect(r.outcome, `${mode} ${call.tool}: ${JSON.stringify(r)}`).toBe("ask");
        expect((r as AskResponse).approvalId).toBeTruthy();
      }
      expect(vendor.calls).toEqual([]);
    });
  }

  it("a hard-gated name on an unlisted tool is denied before anyone is asked", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) }));
    await connect(g);
    const token = await g.token({ allowedTools: ["notion_mcp:*"] });
    for (const name of ["notion-delete-workspace", "refund_payment", "accept-terms"]) {
      const r = await g.client.call(token, unlisted(name));
      expect(r.outcome, name).toBe("deny");
      expect(JSON.stringify(r)).toContain("hard-gate");
    }
    expect(vendor.calls).toEqual([]);
  });

  it("a session reaches only the tools its token names", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) }));
    await connect(g);
    const token = await g.token({ allowedTools: ["notion_mcp:notion_search"] });
    expect((await g.client.call(token, UPDATE)).outcome).toBe("deny");
    expect((await g.client.call(token, unlisted("notion-brand-new"))).outcome).toBe("deny");
    expect(vendor.calls).toEqual([]);
  });

  it("with no stored sign-in it is 409 integration_not_connected and reaches no server", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) }));
    const token = await g.token({ allowedTools: ["notion_mcp:*"] });
    await expect(g.client.call(token, SEARCH)).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    expect(vendor.calls).toEqual([]);
  });
});

describe("mock", () => {
  it("answers from the recorded mock and says it was simulated", async () => {
    const g = (open = await setupGateway({ mode: "mock", businessMode: "automated", connectors: live(server().fetch) }));
    const token = await g.token({ allowedTools: ["notion_mcp:notion_search"] });
    const r = asAllow(await g.client.call(token, SEARCH));
    expect(r.result).toMatchObject({ ok: true, simulated: true, notice: SIMULATED_NOTICE });
  });
});
