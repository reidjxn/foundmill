import { createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch, type FetchLike } from "../http";
import { isUntrusted } from "../quarantine";
import { describeConnectorContract, makeToolContext } from "../testing/contract-suite";
import { createMcpCustomConnector, assertPublicServer } from "./custom";
import { createRemoteMcpConnector, HARD_GATE_NAME, remoteToolList, toolName, UNLISTED_TOOL } from "./build";
import { discoverEndpoints, pkceFor } from "./oauth";
import { HUBSPOT_MCP, NOTION_MCP, REMOTE_MCP_SERVERS, SHOPIFY_MCP } from "./servers";

const SECRET = "x".repeat(40);
const secrets = { notionMcpClientId: "cid-notion", mcpOauthSecret: SECRET };

for (const server of REMOTE_MCP_SERVERS) {
  const connector = createRemoteMcpConnector(server);
  describeConnectorContract(`${server.key} (mock)`, {
    connector: connector.mock,
    mode: "mock",
    calls: [{ tool: toolName(server.tools.find((t) => !t.hints && !t.writes)!.remote), args: Object.fromEntries((server.tools.find((t) => !t.hints && !t.writes)!.inputSchema.required ?? []).map((k) => [k, "x"])) }],
  });
}

/** An in-process MCP server behind a fake fetch: records the bearer token and the calls it saw. */
function fakeServer(seen: { auth: string[]; calls: { name: string; args: unknown }[] }): FetchLike {
  return async (input, init) => {
    const req = new Request(input, init);
    seen.auth.push(req.headers.get("authorization") ?? "");
    const server = new Server({ name: "fake", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "notion-search", description: "search", inputSchema: { type: "object" as const } }] }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      seen.calls.push({ name: r.params.name, args: r.params.arguments });
      return { content: [{ type: "text", text: `ran ${r.params.name}` }] };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}

const live = (seen: ReturnType<typeof newSeen>, extra: Partial<Parameters<typeof createRemoteMcpConnector>[1]> = {}) => createRemoteMcpConnector(NOTION_MCP, { secrets, fetch: fakeServer(seen), now: () => new Date("2026-11-19T12:00:00Z"), ...extra });
const newSeen = () => ({ auth: [] as string[], calls: [] as { name: string; args: unknown }[] });
const credCtx = (c: ReturnType<typeof live>, credential = { kind: "oauth" as const, secret: "tok" }) => makeToolContext(c, { mode: "live", credential });

describe("remote MCP connector (live, against an in-process server)", () => {
  it("calls a listed tool with the sealed token and wraps the answer as untrusted", async () => {
    const seen = newSeen();
    const c = live(seen);
    const r = await c.callTool("notion_search", { query: "launch" }, credCtx(c));
    expect(r.ok).toBe(true);
    expect(isUntrusted(r.data)).toBe(true);
    expect(seen.calls).toEqual([{ name: "notion-search", args: { query: "launch" } }]);
    expect(new Set(seen.auth)).toEqual(new Set(["Bearer tok"]));
  });

  it("checks the list's required arguments before anything leaves", async () => {
    const seen = newSeen();
    const c = live(seen);
    const r = await c.callTool("notion_search", {}, credCtx(c));
    expect(r.error?.code).toBe("invalid_args");
    expect(seen.calls).toEqual([]);
  });

  it("an unlisted tool is reachable only through call_unlisted_tool, which always asks", async () => {
    expect(NOTION_MCP.tools.map((t) => t.remote)).not.toContain("notion-brand-new");
    const hints = createRemoteMcpConnector(NOTION_MCP).policyHints[UNLISTED_TOOL]!;
    expect(hints).toMatchObject({ contactsThirdParty: true, irreversible: true });
    const seen = newSeen();
    const c = live(seen);
    expect((await c.callTool(UNLISTED_TOOL, { tool: "notion-brand-new", arguments: { a: 1 } }, credCtx(c))).ok).toBe(true);
    expect(seen.calls).toEqual([{ name: "notion-brand-new", args: { a: 1 } }]);
  });

  it("refuses an unlisted tool whose name would cross a hard gate, and sends nothing", async () => {
    const seen = newSeen();
    const c = live(seen);
    for (const tool of ["delete_workspace", "refund-payment", "notion-sign-document", "update_billing", "accept_terms", "change_permissions"]) {
      const r = await c.callTool(UNLISTED_TOOL, { tool, arguments: {} }, credCtx(c));
      expect(r.error?.code, tool).toBe("hard_gate");
    }
    expect(seen.calls).toEqual([]);
    expect(HARD_GATE_NAME.test("notion-search")).toBe(false);
  });

  it("does not let call_unlisted_tool reach a listed tool around its own policy", async () => {
    const c = live(newSeen());
    expect((await c.callTool(UNLISTED_TOOL, { tool: "notion-update-page", arguments: { page_id: "p" } }, credCtx(c))).error?.code).toBe("use_listed_tool");
  });

  it("a hard-gated listed tool never runs", async () => {
    const seen = newSeen();
    const c = createRemoteMcpConnector(SHOPIFY_MCP, { secrets, fetch: fakeServer(seen) });
    const r = await c.callTool("complete_checkout", {}, credCtx(c as never));
    expect(r.error?.code).toBe("hard_gate");
    expect(seen.calls).toEqual([]);
  });

  it("refreshes an expired token once, seals the rotated refresh token, and uses the new access token", async () => {
    const seen = newSeen();
    const refreshes: string[] = [];
    const base = fakeServer(seen);
    const fetch: FetchLike = routedFetch({
      "GET https://mcp.notion.com/.well-known/oauth-protected-resource/mcp": () => jsonResponse({ authorization_servers: ["https://mcp.notion.com"] }),
      "GET https://mcp.notion.com/.well-known/oauth-authorization-server": () => jsonResponse({ authorization_endpoint: "https://mcp.notion.com/authorize", token_endpoint: "https://mcp.notion.com/token", code_challenge_methods_supported: ["S256"] }),
      "POST https://mcp.notion.com/token": async (req) => {
        refreshes.push(await req.text());
        return jsonResponse({ access_token: "new-access", refresh_token: "rotated", expires_in: 28800 });
      },
      "POST https://mcp.notion.com/mcp": (req) => base(req),
      "DELETE https://mcp.notion.com/mcp": () => new Response(null, { status: 200 }),
    });
    const c = createRemoteMcpConnector(NOTION_MCP, { secrets, fetch, now: () => new Date("2026-11-19T12:00:00Z") });
    const stored: unknown[] = [];
    const ctx = { ...credCtx(c as never, { kind: "oauth", secret: "old", refreshToken: "r1", expiresAt: "2026-11-19T11:00:00Z" } as never), onCredentialRefreshed: async (x: unknown) => void stored.push(x) };
    const [a, b] = await Promise.all([c.callTool("notion_search", { query: "a" }, ctx), c.callTool("notion_search", { query: "b" }, ctx)]);
    expect(a.ok && b.ok).toBe(true);
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]).toContain("grant_type=refresh_token");
    expect(refreshes[0]).toContain("refresh_token=r1");
    expect(stored).toEqual([expect.objectContaining({ secret: "new-access", refreshToken: "rotated" })]);
    expect(new Set(seen.auth)).toEqual(new Set(["Bearer new-access"]));
  });
});

describe("remote MCP sign-in", () => {
  const meta = {
    "GET https://mcp.notion.com/.well-known/oauth-protected-resource/mcp": () => jsonResponse({ authorization_servers: ["https://mcp.notion.com"] }),
    "GET https://mcp.notion.com/.well-known/oauth-authorization-server": () => jsonResponse({ authorization_endpoint: "https://mcp.notion.com/authorize", token_endpoint: "https://mcp.notion.com/token", revocation_endpoint: "https://mcp.notion.com/revoke", code_challenge_methods_supported: ["S256"] }),
  };
  const state = "eyJ1IjoxfQ.c2ln";
  const redirectUri = "https://app.example.com/integrations/oauth/callback";

  it("sends the founder to the vendor's consent page with PKCE S256 and the resource, then finishes with the derived verifier", async () => {
    let form = "";
    const fetch = routedFetch({ ...meta, "POST https://mcp.notion.com/token": async (req) => ((form = await req.text()), jsonResponse({ access_token: "A", refresh_token: "R", expires_in: 3600, workspace_name: "Northwind", workspace_id: "w1" })) });
    const c = createRemoteMcpConnector(NOTION_MCP, { secrets, fetch, now: () => new Date("2026-11-19T12:00:00Z") });
    const first = await c.connect("b1", { state, redirectUri });
    expect(first.status).toBe("disconnected");
    const url = new URL(String(first.config.authorizeUrl));
    expect(url.origin + url.pathname).toBe("https://mcp.notion.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "cid-notion", code_challenge_method: "S256", resource: "https://mcp.notion.com/mcp", state, redirect_uri: redirectUri });
    expect(first.credentialToStore).toBeUndefined();

    const done = await c.connect("b1", { code: "abc", redirectUri, state });
    const verifier = new URLSearchParams(form).get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    expect(done).toMatchObject({ status: "connected", accountLabel: "Northwind", externalAccountId: "w1", credentialToStore: { kind: "oauth", secret: "A", refreshToken: "R" } });
  });

  it("a flow started for one state cannot be finished with another's verifier", () => {
    expect(pkceFor(SECRET, "notion_mcp", "s1").verifier).not.toBe(pkceFor(SECRET, "notion_mcp", "s2").verifier);
    expect(() => pkceFor("short", "notion_mcp", "s1")).toThrow(/MCP_OAUTH_SECRET/);
  });

  it("is not configured without Foundmill's client, and a server not confirmed live cannot be connected", async () => {
    await expect(createRemoteMcpConnector(NOTION_MCP, { secrets: {}, fetch: routedFetch(meta) }).connect("b", { state, redirectUri })).rejects.toThrow(/NOTION_MCP_CLIENT_ID/);
    await expect(createRemoteMcpConnector(SHOPIFY_MCP, { secrets: { shopifyMcpClientId: "x" } }).connect("b", { state, redirectUri })).rejects.toThrow(/not confirmed/);
  });

  it("refuses metadata that is not https or lacks S256", async () => {
    await expect(discoverEndpoints("http://evil.example/mcp", routedFetch({}))).rejects.toThrow(/https/);
    const noPkce = routedFetch({ "GET https://s.example/.well-known/oauth-authorization-server": () => jsonResponse({ authorization_endpoint: "https://s.example/a", token_endpoint: "https://s.example/t", code_challenge_methods_supported: ["plain"] }) });
    await expect(discoverEndpoints("https://s.example/mcp", noPkce)).rejects.toThrow(/PKCE/);
    const plainToken = routedFetch({ "GET https://s.example/.well-known/oauth-authorization-server": () => jsonResponse({ authorization_endpoint: "https://s.example/a", token_endpoint: "http://s.example/t" }) });
    await expect(discoverEndpoints("https://s.example/mcp", plainToken)).rejects.toThrow(/https/);
  });

  it("disconnecting revokes both tokens at the vendor", async () => {
    const revoked: string[] = [];
    const fetch = routedFetch({ ...meta, "POST https://mcp.notion.com/revoke": async (req) => (revoked.push(new URLSearchParams(await req.text()).get("token")!), new Response(null, { status: 200 })) });
    const c = createRemoteMcpConnector(NOTION_MCP, { secrets, fetch });
    expect(await c.disconnect!(makeToolContext(c).integration, { kind: "oauth", secret: "A", refreshToken: "R" })).toBe(true);
    expect(revoked.sort()).toEqual(["A", "R"]);
  });
});

describe("policy lists", () => {
  it("every listed tool that is not a pure read says why, and a hard gate has a human action and no handler", async () => {
    for (const s of REMOTE_MCP_SERVERS) for (const t of s.tools) {
      if (t.hints?.hardGate) expect(t.humanAction, t.remote).toBeDefined();
      expect(HARD_GATE_NAME.test(t.remote) && !t.hints?.hardGate, `${s.key}.${t.remote} sounds like a hard gate but is listed as allowed`).toBe(false);
    }
    expect(remoteToolList(HUBSPOT_MCP).find((t) => t.name === "manage_crm_objects")?.hints).toMatchObject({ contactsThirdParty: true, irreversible: true });
  });
});

describe("custom MCP server", () => {
  const resolveHost = async (h: string) => (h === "mcp.example.com" ? ["93.184.216.34"] : h === "internal.example.com" ? ["10.0.0.5"] : []);

  it("accepts only a public https address with no sign-in inside it", async () => {
    await expect(assertPublicServer("https://mcp.example.com/mcp", resolveHost)).resolves.toBeInstanceOf(URL);
    for (const bad of ["http://mcp.example.com/mcp", "https://internal.example.com/mcp", "https://169.254.169.254/", "https://user:pw@mcp.example.com/", "https://nowhere.example/mcp"]) await expect(assertPublicServer(bad, async (h) => (/^\d/.test(h) ? [h] : resolveHost(h))), bad).rejects.toThrow();
  });

  it("connects with a token the server accepts, seals it, and asks first for every call", async () => {
    const seen = newSeen();
    const c = createMcpCustomConnector({ fetch: fakeServer(seen), resolveHost });
    const rec = await c.connect("b", { serverUrl: "https://mcp.example.com/mcp", apiKey: "secret-token" });
    expect(rec).toMatchObject({ status: "connected", config: { server: "https://mcp.example.com/mcp" }, credentialToStore: { kind: "api_key", secret: "secret-token" } });
    expect(JSON.stringify({ ...rec, credentialToStore: undefined })).not.toContain("secret-token");
    expect(c.policyHints.call_unlisted_tool).toMatchObject({ contactsThirdParty: true, irreversible: true });
    const ctx = makeToolContext(c, { mode: "live", credential: { kind: "api_key", secret: "secret-token" }, integration: { ...makeToolContext(c).integration, status: "connected", config: rec.config } });
    const ran = await c.callTool("call_unlisted_tool", { tool: "lookup_order", arguments: { id: 1 } }, ctx);
    expect(ran.error).toBeUndefined();
    expect((await c.callTool("call_unlisted_tool", { tool: "delete_all", arguments: {} }, ctx)).error?.code).toBe("hard_gate");
    expect(seen.calls.map((x) => x.name)).toEqual(["lookup_order"]);
  });
});
