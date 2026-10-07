/**
 * `/mcp/:connector` through the official MCP client over streamable HTTP, on an ephemeral port.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { repos } from "@foundmill/db";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway();
}, 120_000);
afterAll(async () => {
  await g.close();
});

async function connect(token: string, connector = "test"): Promise<Client> {
  const client = new Client({ name: "gateway-test-client", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(new URL(g.client.mcpUrl(connector)), { requestInit: { headers: g.client.sessionHeaders(token) } });
  await client.connect(transport);
  return client;
}

describe("MCP endpoint", () => {
  it("lists only the tools the session token allows", async () => {
    const all = await connect(await g.token({ allowedTools: ["test:*"] }));
    try {
      const { tools } = await all.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["delete_everything", "note", "pay_out", "read_inbox", "send_message", "spend"]);
      const note = tools.find((t) => t.name === "note")!;
      expect(note.inputSchema).toMatchObject({ type: "object" });
      expect(note.outputSchema).toBeUndefined();
    } finally {
      await all.close();
    }
    const scoped = await connect(await g.token({ allowedTools: ["test:note", "test:read_inbox"] }));
    try {
      const { tools } = await scoped.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["note", "read_inbox"]);
    } finally {
      await scoped.close();
    }
  });

  it("tools/call runs the same pipeline: allow is metered and audited, a hard gate is denied", async () => {
    const client = await connect(await g.token());
    try {
      const ok = await client.callTool({ name: "note", arguments: { text: "from mcp" } });
      expect(ok.isError).toBeFalsy();
      const body = ok.structuredContent as { outcome: string; auditId: string; costMinor: number; result: { data: unknown } };
      expect(body).toMatchObject({ outcome: "allow", costMinor: 3, result: { data: { saved: true } } });
      const audit = await repos.audit.get(g.db, g.businessId, body.auditId);
      expect(audit.details).toMatchObject({ outcome: "allow", costMinor: 3 });
      expect(g.seen.at(-1)).toMatchObject({ tool: "note", args: { text: "from mcp" } });

      const gated = await client.callTool({ name: "pay_out", arguments: { amountMinor: 5 } });
      expect(gated.isError).toBe(true);
      expect(gated.structuredContent).toMatchObject({ outcome: "deny", policyIds: ["hard-gate"] });
      const text = (gated.content as { type: string; text: string }[])[0]!.text;
      expect(JSON.parse(text)).toMatchObject({ outcome: "deny" });

      const unknown = await client.callTool({ name: "nope", arguments: {} });
      expect(unknown.isError).toBe(true);
      expect(unknown.structuredContent).toMatchObject({ outcome: "error", error: { code: "unknown_tool", status: 404 } });
    } finally {
      await client.close();
    }
  });

  it("untrusted content read over MCP registers recipients for the session like /v1/call does", async () => {
    const sessionId = await g.newSession();
    const client = await connect(await g.token({ sessionId }));
    try {
      const read = await client.callTool({ name: "read_inbox", arguments: { id: "m-9" } });
      expect(read.structuredContent).toMatchObject({ outcome: "allow", result: { untrusted: true, data: { untrusted: true } } });
      const send = await client.callTool({ name: "send_message", arguments: { to: "supplier@untrusted.example" } });
      expect(send.isError).toBe(true);
      expect(send.structuredContent).toMatchObject({ outcome: "deny", policyIds: ["untrusted-recipient"] });
    } finally {
      await client.close();
    }
  });

  it("rejects requests without a valid session token and unknown connectors", async () => {
    const anon = new Client({ name: "anon", version: "0" });
    await expect(anon.connect(new StreamableHTTPClientTransport(new URL(g.client.mcpUrl("test"))))).rejects.toThrow(/session Bearer token is required/);
    const res = await fetch(g.client.mcpUrl("nope"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${await g.token()}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "unknown_connector" } });
  });
});
