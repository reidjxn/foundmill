/**
 * Service-only connectors (packages/connectors `SERVICE_ONLY_CONNECTORS`: `openai_images`): the platform calls them from its
 * own service routes (POST /v1/personas/portrait), never an agent. `/v1/call` and `/mcp/:connector` refuse them with a 403
 * `service_only_connector` even when the session token names the connector and the registry serves it, and nothing runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  // The test connector registered under the key `openai_images` too: without the refusal, the call would run.
  g = await setupGateway({ extraConnectorKeys: ["openai_images"] });
}, 120_000);
afterAll(async () => {
  await g?.close();
});

const call = async (token: string, connector: string, tool = "note") =>
  fetch(`${g.server.url}/v1/call`, { method: "POST", headers: { "content-type": "application/json", ...g.client.sessionHeaders(token) }, body: JSON.stringify({ connector, tool, args: { text: "hello" } }) });

describe("service-only connectors on the agent paths", () => {
  it("/v1/call refuses openai_images with a 403, whatever the token allows, and runs nothing", async () => {
    const token = await g.token({ allowedTools: ["openai_images:*", "test:*"] });
    const before = g.seen.length;
    const res = await call(token, "openai_images");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "service_only_connector", details: { connector: "openai_images" } } });
    expect(g.seen.length).toBe(before);
    // The same token still reaches an ordinary connector.
    expect((await call(token, "test")).status).toBe(200);
  });

  it("/mcp/openai_images is a 403 before any MCP server is built", async () => {
    const token = await g.token({ allowedTools: ["openai_images:*"] });
    const res = await fetch(g.client.mcpUrl("openai_images"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...g.client.sessionHeaders(token) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "service_only_connector" } });
  });
});
