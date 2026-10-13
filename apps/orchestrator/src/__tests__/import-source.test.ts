/**
 * Door B's importSource activity on PGlite with a scripted gateway (audit ARB-07, api-services-09, VGPC-X3, VSEC-X2,
 * ARB-06): each source is routed by the key the api stored on its row, every connector tool gets its own arguments, a
 * source counts as imported only when the tool answered ok, and every outcome (a refusal, a failed tool, a thrown
 * error) is written to the row so the import job can finish.
 */
import { createDefaultRegistry } from "@foundmill/connectors";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { repos } from "@foundmill/db";
import { IMPORT_SOURCE_KEYS, importCallFor } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMiscActivities, describeRead } from "../activities/misc";
import { createOfflineGatewayClient, type GatewayCallRequest, type GatewayCallResponse, type GatewayClient } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

type Answer = GatewayCallResponse | Error;

function scriptedGateway(answer: (req: GatewayCallRequest) => Answer): GatewayClient & { calls: GatewayCallRequest[]; minted: { allowedTools?: string[] }[] } {
  const offline = createOfflineGatewayClient();
  const calls: GatewayCallRequest[] = [];
  const minted: { allowedTools?: string[] }[] = [];
  return {
    ...offline,
    calls,
    minted,
    async mintSessionToken(input) {
      minted.push({ allowedTools: input.allowedTools });
      return offline.mintSessionToken(input);
    },
    async call(_token, req) {
      calls.push(req);
      const a = answer(req);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

const ok = (data: unknown): GatewayCallResponse => ({ outcome: "allow", result: { ok: true, data, untrusted: false, costMinor: 0 }, costMinor: 0 });

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "impsrc" });
}, 120_000);
afterAll(() => t?.close());

/** A source row the way the api writes it for a business import (`startImport`). */
async function sourceRow(key: string, value: string) {
  return repos.product.createSource(t.db, t.businessId, { kind: "doc", uri: null, title: `${key} import`, relevance: { import: { key, value, connector: key, readOnly: true } } });
}

function activities(gateway: GatewayClient) {
  return createMiscActivities({ ...t.deps, gateway });
}

describe("importSource", () => {
  it("routes by the stored key and sends each tool its own arguments", async () => {
    const gateway = scriptedGateway((req) => ok(req.tool === "read_tree" ? { sha: "abc", truncated: false, entries: [{ path: "a" }, { path: "b" }] } : {}));
    const acts = activities(gateway);
    const github = await sourceRow("github", "acme/ledgerly");
    const website = await sourceRow("website", "https://ledgerlyhq.com");
    const registry = await sourceRow("registry", "12345678");
    const stripe = await sourceRow("stripe", "");
    for (const s of [github, website, registry, stripe]) expect((await acts.importSource({ businessId: t.businessId, sourceId: s.id })).ok).toBe(true);
    expect(gateway.calls).toEqual([
      { connector: "github", tool: "read_tree", args: { owner: "acme", repo: "ledgerly" } },
      { connector: "web", tool: "fetch", args: { url: "https://ledgerlyhq.com" } },
      { connector: "opencorporates", tool: "search_companies", args: { q: "12345678" } },
      { connector: "stripe", tool: "get_account", args: {} },
    ]);
    // The token is minted for exactly the tool the source needs.
    expect(gateway.minted.map((m) => m.allowedTools)).toEqual([["github:read_tree"], ["web:fetch"], ["opencorporates:search_companies"], ["stripe:get_account"]]);
    const row = await repos.product.getSource(t.db, t.businessId, github.id);
    expect(row.fetchedAt).not.toBeNull();
    expect(row.relevance).toMatchObject({ imported: true, connector: "github", tool: "read_tree", read: "2 entries" });
  });

  it("every source the picker offers either has a call that its tool accepts or is refused up front", () => {
    const values: Record<string, string> = { github: "acme/ledgerly", website: "https://ledgerlyhq.com", registry: "12345678" };
    for (const key of IMPORT_SOURCE_KEYS) {
      const call = importCallFor(key, values[key] ?? "");
      if (key === "linear" || key === "jira") expect(call).toBeNull();
      else expect(call, key).not.toBeNull();
    }
    expect(importCallFor("github", "not-a-repo")).toBeNull();
    expect(importCallFor("registry", "x")).toBeNull();
  });

  it("every call it builds passes the real tool's argument schema (the connector mocks answer invalid_args to arguments a tool rejects)", async () => {
    const registry = createDefaultRegistry();
    const values: Record<string, string> = { github: "acme/ledgerly", website: "https://ledgerlyhq.com", registry: "12345678" };
    for (const key of IMPORT_SOURCE_KEYS) {
      const call = importCallFor(key, values[key] ?? "");
      if (!call) continue;
      // The web reader is a gateway built-in, not in the connector registry (its tools are covered by the web connector's own tests).
      if (call.connector === "web") continue;
      const mock = registry.get(call.connector, "mock");
      expect(mock.tools.map((t) => t.name), `${call.connector} has the tool ${call.tool}`).toContain(call.tool);
      const result = await mock.callTool(call.tool, call.args, makeToolContext(mock));
      expect(result.error?.code, `${call.connector}.${call.tool}`).not.toBe("invalid_args");
    }
  });

  it("a tool that answered not ok is not imported, whatever the policy said", async () => {
    const gateway = scriptedGateway(() => ({ outcome: "allow", result: { ok: false, error: { code: "invalid_args", message: "github.read_tree: expected string at owner" }, untrusted: false, costMinor: 0 }, costMinor: 0 }));
    const s = await sourceRow("github", "acme/ledgerly");
    const res = await activities(gateway).importSource({ businessId: t.businessId, sourceId: s.id });
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/not read, the read failed: github\.read_tree: expected string at owner/);
    const row = await repos.product.getSource(t.db, t.businessId, s.id);
    expect(row.relevance).toMatchObject({ imported: false, reason: expect.stringContaining("the read failed") });
    expect(row.fetchedAt).toBeNull();
  });

  it("a refused call, a thrown error and a source with no connector all end on the row with a reason", async () => {
    const refused = await sourceRow("notion", "");
    expect((await activities(scriptedGateway(() => ({ outcome: "deny", reasons: ["policy"] }))).importSource({ businessId: t.businessId, sourceId: refused.id })).ok).toBe(false);
    expect((await repos.product.getSource(t.db, t.businessId, refused.id)).relevance).toMatchObject({ imported: false, reason: "the gateway refused the read (policy)" });

    const thrown = await sourceRow("google_drive", "");
    const res = await activities(scriptedGateway(() => new Error("Internal error"))).importSource({ businessId: t.businessId, sourceId: thrown.id });
    expect(res).toMatchObject({ ok: false, summary: expect.stringContaining("gateway error: Internal error") });
    expect((await repos.product.getSource(t.db, t.businessId, thrown.id)).relevance).toMatchObject({ imported: false, reason: "gateway error: Internal error" });

    const linear = await sourceRow("linear", "");
    const none = scriptedGateway(() => ok({}));
    expect((await activities(none).importSource({ businessId: t.businessId, sourceId: linear.id })).summary).toMatch(/the import has no reader for this source yet/);
    expect(none.calls).toHaveLength(0);
    expect((await repos.product.getSource(t.db, t.businessId, linear.id)).relevance).toMatchObject({ imported: false });
  });

  it("failImportSource marks an unfinished row failed and leaves a finished one alone", async () => {
    const acts = activities(scriptedGateway(() => ok({})));
    const open = await sourceRow("stripe", "");
    await acts.failImportSource({ businessId: t.businessId, sourceId: open.id, reason: "failed: boom" });
    expect((await repos.product.getSource(t.db, t.businessId, open.id)).relevance).toMatchObject({ imported: false, reason: "failed: boom", import: { status: "failed" } });
    const done = await sourceRow("shopify", "");
    await acts.importSource({ businessId: t.businessId, sourceId: done.id });
    await acts.failImportSource({ businessId: t.businessId, sourceId: done.id, reason: "later" });
    expect((await repos.product.getSource(t.db, t.businessId, done.id)).relevance).toMatchObject({ imported: true });
  });

  it("describeRead keeps counts, never the third-party content", () => {
    expect(describeRead({ items: [1, 2, 3], nextPageToken: null })).toBe("3 items");
    expect(describeRead({ untrusted: true, content: { entries: [{ path: "a" }] }, notice: "x" })).toBe("1 entries");
    expect(describeRead({ id: "acct_1", businessName: "Acme" })).toBeNull();
    expect(describeRead(null)).toBeNull();
  });
});
