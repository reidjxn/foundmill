import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { createE2bConnector } from "./index";
import { createE2bMock, e2bMock } from "./mock";

describeConnectorContract("e2b (mock)", {
  connector: e2bMock,
  mode: "mock",
  calls: [
    { tool: "create_sandbox", args: { templateId: "fm-node-22", timeoutSeconds: 600, metadata: { sessionId: "s1" } }, check: (r) => { expect(r.data).toMatchObject({ templateId: "fm-node-22", state: "running" }); expect(r.costMinor).toBe(10); } },
    { tool: "list_sandboxes", args: { metadata: "sessionId=s1" }, check: (r) => expect((r.data as { items: unknown[] }).items).toHaveLength(1) },
    { tool: "get_sandbox", args: { sandboxId: "idoesnotexist0000" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "create_sandbox", args: { timeoutSeconds: 0 }, expectOk: false },
  ],
});

describe("e2b mock lifecycle", () => {
  it("runs create → pause → resume → timeout → kill", async () => {
    const mock = createE2bMock();
    const ctx = makeToolContext(mock);
    const created = await mock.callTool("create_sandbox", { metadata: { taskId: "t1" } }, ctx);
    const id = (created.data as { sandboxId: string }).sandboxId;
    expect((await mock.callTool("pause_sandbox", { sandboxId: id }, ctx)).data).toEqual({ sandboxId: id, state: "paused" });
    expect((await mock.callTool("list_sandboxes", { state: ["running"] }, ctx)).data).toEqual({ items: [] });
    const resumed = await mock.callTool("resume_sandbox", { sandboxId: id, timeoutSeconds: 120 }, ctx);
    expect(resumed.data).toMatchObject({ state: "running" });
    expect(resumed.costMinor).toBe(2);
    const killed = await mock.callTool("kill_sandbox", { sandboxId: id }, ctx);
    expect(killed.data).toEqual({ sandboxId: id, state: "killed" });
    expect((await mock.callTool("get_sandbox", { sandboxId: id }, ctx)).error?.code).toBe("not_found");
  });
});

describe("e2b live (canned)", () => {
  it("creates via POST /v2/sandboxes with X-API-Key and kills via DELETE", async () => {
    const calls: string[] = [];
    const connector = createE2bConnector({
      secrets: { e2bApiKey: "e2b_test" },
      fetch: routedFetch({
        "POST https://api.e2b.app/v2/sandboxes": async (req) => {
          calls.push("create");
          expect(req.headers.get("x-api-key")).toBe("e2b_test");
          expect(await req.json()).toMatchObject({ templateID: "base", timeout: 300 });
          return jsonResponse({ sandboxID: "iabc123def456ghi78", templateID: "base", clientID: "c1" }, { status: 201 });
        },
        "GET https://api.e2b.app/sandboxes/iabc123def456ghi78": () => jsonResponse({ sandboxID: "iabc123def456ghi78", templateID: "base", startedAt: "2026-10-05T09:00:00Z", endAt: "2026-10-05T09:05:00Z", state: "running", cpuCount: 2, memoryMB: 512 }),
        "DELETE https://api.e2b.app/sandboxes/iabc123def456ghi78": () => (calls.push("kill"), new Response(null, { status: 204 })),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    const created = await connector.callTool("create_sandbox", {}, ctx);
    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({ sandboxId: "iabc123def456ghi78", cpuCount: 2 });
    expect(created.costMinor).toBe(5);
    expect((await connector.callTool("kill_sandbox", { sandboxId: "iabc123def456ghi78" }, ctx)).ok).toBe(true);
    expect(calls).toEqual(["create", "kill"]);
  });
  it("throws ConfigError without E2B_API_KEY", async () => {
    const c = createE2bConnector({ secrets: {} });
    await expect(c.callTool("list_sandboxes", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("E2B_API_KEY"))("e2b (live)", () => {
  describeConnectorContract("e2b live", { connector: createE2bConnector(), mode: "live", deterministic: false, calls: [{ tool: "list_sandboxes", args: {} }] });
});
