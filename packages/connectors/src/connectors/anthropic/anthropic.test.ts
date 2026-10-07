import { describe, expect, it } from "vitest";
import { MODELS } from "@foundmill/models/routing";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { createAnthropicConnector } from "./index";
import { anthropicMock } from "./mock";

const live = createAnthropicConnector();

describeConnectorContract("anthropic (mock)", {
  connector: anthropicMock,
  mode: "mock",
  calls: [
    { tool: "list_models", args: {}, check: (r) => expect((r.data as { models: { id: string; routed: boolean }[] }).models.filter((m) => m.routed).map((m) => m.id).sort()).toEqual(Object.values(MODELS).sort()) },
    { tool: "get_model", args: { modelId: MODELS.opus }, check: (r) => expect(r.data).toMatchObject({ id: MODELS.opus, routed: true }) },
    { tool: "get_model", args: { modelId: "claude-nonexistent" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "validate_key", args: {}, check: (r) => expect(r.data).toMatchObject({ valid: true, reason: null }) },
  ],
});

describe("anthropic mock BYOK validation", () => {
  it("rejects keys that are not Anthropic keys without leaking them", async () => {
    const ctx = makeToolContext(anthropicMock, { credential: { kind: "api_key", secret: "sk-live-not-anthropic" } });
    const r = await anthropicMock.callTool("validate_key", {}, ctx);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ valid: false });
    expect(JSON.stringify(r)).not.toContain("sk-live-not-anthropic");
  });
  it("simulates a credential expiry event", async () => {
    const events = await anthropicMock.simulate("credential.expiry", { businessId: "6a1f4b2c-0d9e-5f3a-8b7c-1d2e3f4a5b6c", daysRemaining: 3 });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("credential.expiring");
    expect(events[0]!.payload).toMatchObject({ connectorKey: "anthropic", daysRemaining: 3, expired: false });
  });
});

describe("anthropic (live, unconfigured)", () => {
  it("throws a clear ConfigError when no key is configured", async () => {
    const connector = createAnthropicConnector({ secrets: {} });
    await expect(connector.callTool("list_models", {}, makeToolContext(connector, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const health = await connector.healthcheck(makeToolContext(connector, { mode: "live" }).integration);
    expect(health.status).toBe("disconnected");
  });
});

describe.skipIf(!envKeysPresent("ANTHROPIC_API_KEY"))("anthropic (live)", () => {
  describeConnectorContract("anthropic live", {
    connector: live,
    mode: "live",
    skipConnect: true,
    deterministic: false,
    calls: [{ tool: "validate_key", args: {}, check: (r) => expect(r.data).toMatchObject({ valid: true }) }],
  });
});
