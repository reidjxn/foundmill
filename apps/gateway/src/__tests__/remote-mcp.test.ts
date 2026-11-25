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
import { createHubspotMcpConnector, createNotionMcpConnector, createSentryMcpConnector, SENTRY_DEMO_INJECTION_ISSUE, type Connector } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { doneKeyOf } from "../pipeline";
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
const UPDATE = { connector: "notion_mcp", tool: "notion_update_page", args: { page_id: "p1", command: "update_properties", properties: { Status: "Done" } } } as const;
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

  // Founder, Nov 23, 2026: "They should never have to approve individual steps."
  for (const mode of ["augmented", "assisted", "automated"] as const) {
    it(`${mode}: a listed change to a page runs with no approval; an unlisted tool still asks and reaches no server`, async () => {
      const vendor = server();
      const g = (open = await setupGateway({ mode: "live", businessMode: mode, connectors: live(vendor.fetch) }));
      await connect(g);
      const token = await g.token({ allowedTools: ["notion_mcp:*"] });
      expect(asAllow(await g.client.call(token, UPDATE)).result.ok).toBe(true);
      const r = await g.client.call(token, unlisted("notion-brand-new"));
      expect(r.outcome, `${mode}: ${JSON.stringify(r)}`).toBe("ask");
      expect((r as AskResponse).approvalId).toBeTruthy();
      expect(vendor.calls.map((c) => c.name)).toEqual(["notion-update-page"]);
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

  it("on vacation: a listed change runs with no approval", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) }));
    await connect(g);
    const token = await g.token({ allowedTools: ["notion_mcp:*"] });
    const holiday = await repos.holidays.start(g.db, g.businessId, { untilAt: new Date(Date.now() + 86_400_000), budgetCeilingMinor: 50_000 });
    try {
      expect(asAllow(await g.client.call(token, { connector: "notion_mcp", tool: "notion_update_page", args: { page_id: "p2", command: "update_content", content_updates: [{ old_str: "Draft", new_str: "Final" }] } })).result.ok).toBe(true);
    } finally {
      await repos.holidays.end(g.db, g.businessId, holiday.id);
    }
    expect(vendor.calls.map((c) => c.name)).toEqual(["notion-update-page"]);
  });

  it("arguments that delete, trash or change access are denied before anyone is asked, also with the owner's approval in hand", async () => {
    const vendor = server();
    const g = (open = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) }));
    await connect(g);
    const token = await g.token({ allowedTools: ["notion_mcp:*"] });
    const destructive: { tool: string; args: Record<string, unknown> }[] = [
      { tool: "notion_update_page", args: { page_id: "p1", command: "update_properties", in_trash: true } },
      { tool: "notion_update_page", args: { page_id: "p1", archived: true } },
      // A command the documentation does not list (a whole-body replace) cannot show what it removes: fail closed.
      { tool: "notion_update_page", args: { page_id: "p1", command: "replace_content", new_str: "" } },
      { tool: "notion_update_page", args: { page_id: "p1" } },
      // Moved items inherit access from the new parent: an access change the arguments cannot rule out.
      { tool: "notion_move_pages", args: { page_or_database_ids: ["p1"], new_parent: { page_id: "p9" } } },
      // "Omitted options are removed", and a property set to null is removed with its values.
      { tool: "notion_update_database", args: { database_id: "d1", properties: { Status: { select: { options: [{ name: "Done" }] } } } } },
      { tool: "notion_update_database", args: { database_id: "d1", properties: { Notes: null } } },
      { tool: "notion_update_page", args: { page_id: "p1", command: "update_content", operation: { type: "delete_block" } } },
    ];
    for (const call of destructive) {
      // An owner already said yes to this very call (or a delegate did, before the founder-only rule): no matter.
      await repos.approvals.create(g.db, g.businessId, { agentId: g.agentId, sessionId: g.sessionId, connectorKey: "notion_mcp", tool: call.tool, args: call.args, reasons: ["asks"] }).then((a) => g.h.pg.query("update approvals set outcome = 'approved', by_kind = 'system', resolved_at = now() where id = $1", [a.id]));
      const r = await g.client.call(token, { connector: "notion_mcp", tool: call.tool, args: call.args });
      expect(r.outcome, `${call.tool} ${JSON.stringify(call.args)}: ${JSON.stringify(r)}`).toBe("deny");
      expect(JSON.stringify(r)).toContain("hard-gate");
      expect((r as { approvalId?: string }).approvalId).toBeUndefined();
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

describe("unasked HubSpot changes", () => {
  it("a repeat of the same manage call in one session is answered from the first run, not run again", () => {
    const hubspot = createHubspotMcpConnector({ secrets: {} });
    const session = { agentId: "a1", sessionId: "s1" };
    expect(doneKeyOf(hubspot, "manage_crm_objects", { objectType: "contacts" }, {}, session)).toBeTruthy();
    expect(doneKeyOf(hubspot, "search_crm_objects", {}, {}, session)).toBeNull();
  });
});

describe("Sentry error reports (founder, Nov 25, 2026)", () => {
  const sentry = (): Connector[] => [createSentryMcpConnector({ secrets: {} })];
  const READ = { connector: "sentry_mcp", tool: "get_issue_details", args: { issueId: SENTRY_DEMO_INJECTION_ISSUE } } as const;

  it("mock: a report comes back untrusted and simulated, the instruction inside it only as data", async () => {
    const g = (open = await setupGateway({ mode: "mock", businessMode: "automated", connectors: sentry() }));
    const token = await g.token({ allowedTools: ["sentry_mcp:get_issue_details"] });
    const r = asAllow(await g.client.call(token, READ));
    expect(r.result).toMatchObject({ ok: true, untrusted: true, simulated: true, notice: SIMULATED_NOTICE });
  });

  it("changing an issue runs unasked; a note asks in augmented mode; keys and access are denied", async () => {
    const g = (open = await setupGateway({ mode: "mock", businessMode: "augmented", connectors: sentry() }));
    const token = await g.token({ allowedTools: ["sentry_mcp:*"] });
    expect(asAllow(await g.client.call(token, { connector: "sentry_mcp", tool: "update_issue", args: { issueId: "BOOKING-42", status: "resolved" } })).result.ok).toBe(true);
    expect((await g.client.call(token, { connector: "sentry_mcp", tool: "add_issue_note", args: { issueId: "BOOKING-42", text: "Fixed in PR 12" } })).outcome).toBe("ask");
    for (const tool of ["create_dsn", "add_team_to_project"]) {
      const r = await g.client.call(token, { connector: "sentry_mcp", tool, args: {} });
      expect(r.outcome, tool).toBe("deny");
      expect(JSON.stringify(r), tool).toContain("hard-gate");
    }
    expect((await g.client.call(token, { connector: "sentry_mcp", tool: "call_unlisted_tool", args: { tool: "delete_alert_rule", arguments: {} } })).outcome).toBe("deny");
  });
});
