import { describe, expect, it } from "vitest";
import { CONNECTOR_KEYS, createAllConnectors, createDefaultRegistry } from "../catalogue";
import { ConfigError, type Connector } from "../contract";
import { buildLiveConnector, buildMockConnector, defineTool, isMockConnector } from "../define";
import { createRegistry } from "../registry";
import { makeToolContext, TEST_BUSINESS_ID } from "../testing/contract-suite";
import { z } from "zod";

const EXPECTED_KEYS = ["anthropic", "voyage", "github", "google_drive", "gmail", "google_calendar", "notion", "cloudflare_dns", "opencorporates", "bolagsverket", "companies_house", "e2b", "dropbox_sign", "ecb_rates", "domains", "stripe", "sendgrid", "shopify", "tink", "plaid"];

describe("registry: mode switching", () => {
  const registry = createDefaultRegistry({ secrets: {} });

  it("ships every connector of the assignment, each with a mock", () => {
    expect(CONNECTOR_KEYS).toEqual(EXPECTED_KEYS);
    expect(registry.keys()).toEqual([...EXPECTED_KEYS].sort());
    for (const key of EXPECTED_KEYS) expect(isMockConnector(registry.get(key, "live").mock)).toBe(true);
  });
  it("get(key, 'mock') returns the mock and get(key, 'live') the live side; the env default is mock", () => {
    for (const key of EXPECTED_KEYS) {
      const live = registry.get(key, "live");
      const mock = registry.get(key, "mock");
      expect(isMockConnector(live)).toBe(false);
      expect(isMockConnector(mock)).toBe(true);
      expect(mock).toBe(live.mock);
      expect(registry.get(key)).toBe(mock); // INTEGRATIONS_MODE defaults to mock in tests
      expect(registry.getMock(key)).toBe(mock);
    }
  });
  it("list() and getByPhase() follow the mode; catalogue() carries policy hints, webhooks and simulations", () => {
    expect(registry.list("mock").every(isMockConnector)).toBe(true);
    expect(registry.list("live").some(isMockConnector)).toBe(false);
    expect(registry.getByPhase(1, "mock").map((c) => c.key).sort()).toEqual(["anthropic", "bolagsverket", "cloudflare_dns", "companies_house", "domains", "dropbox_sign", "e2b", "ecb_rates", "github", "gmail", "google_calendar", "google_drive", "notion", "opencorporates", "voyage"]);
    expect(registry.getByPhase(2, "mock").map((c) => c.key).sort()).toEqual(["plaid", "sendgrid", "shopify", "stripe", "tink"]);
    const entry = registry.catalogue("mock").find((c) => c.key === "stripe")!;
    expect(entry.webhookPaths).toEqual(["/webhooks/stripe/:businessId"]);
    expect(entry.simulations).toContain("payment.received");
    expect(Object.keys(entry.policyHints).sort()).toEqual(entry.tools.map((t) => t.name).sort());
    const paths = registry.webhooks("live").map((w) => w.path);
    expect(paths).toContain("/webhooks/github/:businessId");
    expect(paths).toContain("/webhooks/sendgrid-inbound/:businessId");
    expect(new Set(paths).size).toBe(paths.length);
  });
  it("throws NotFoundError for unknown keys and refuses duplicates or connectors without a proper mock", () => {
    expect(() => registry.get("nope")).toThrow(/connector/);
    const dup = createRegistry([registry.get("voyage", "live")]);
    expect(() => dup.register(registry.get("voyage", "live"))).toThrow(/already registered/);
    const fake = { ...registry.get("voyage", "live"), key: "fake", mock: { ...registry.get("voyage", "mock"), key: "fake", isMock: false } } as unknown as Connector;
    expect(() => createRegistry([fake])).toThrow(/buildMockConnector/);
  });
});

describe("registry: every tool has policy hints and hard gates never execute", () => {
  const connectors = createAllConnectors({ secrets: {} });
  const gated: string[] = [];
  for (const live of connectors) {
    for (const side of [live, live.mock]) {
      it(`${side.key} (${isMockConnector(side) ? "mock" : "live"}) declares a hint per tool`, () => {
        expect(side.tools.length).toBeGreaterThan(0);
        for (const t of side.tools) expect(side.policyHints, `${side.key}.${t.name}`).toHaveProperty(t.name);
        expect(Object.keys(side.policyHints).sort()).toEqual(side.tools.map((t) => t.name).sort());
      });
    }
    for (const t of live.tools.filter((t) => live.policyHints[t.name]?.hardGate)) {
      gated.push(`${live.key}.${t.name}`);
      it(`${live.key}.${t.name} refuses to run on both sides, even unconfigured`, async () => {
        for (const side of [live, live.mock]) {
          const r = await side.callTool(t.name, {}, makeToolContext(side));
          expect(r.ok).toBe(false);
          expect(r.error?.code).toBe("hard_gate");
          expect(r.costMinor).toBe(0);
          expect(r.data).toMatchObject({ connector: live.key, tool: t.name, reason: "hard_gate" });
        }
      });
    }
  }
  it("the hard-gated set is exactly what BUILD §2.2 requires of these connectors", () => {
    expect(gated.sort()).toEqual(["dropbox_sign.sign_as_founder", "plaid.start_consent", "shopify.refund_order", "stripe.create_payout", "stripe.create_transfer", "stripe.refund_payment", "stripe.start_connect_onboarding", "tink.start_consent"]);
    // Money movement is always gated; metered platform spend (sandbox compute, embeddings) is "spendsMoney" for the policy engine but not a gate.
    for (const c of connectors) for (const [name, hint] of Object.entries(c.policyHints)) if (/^(create_payout|create_transfer|refund_\w+|sign_as_founder|start_consent|start_connect_onboarding)$/.test(name)) expect(hint.hardGate, `${c.key}.${name} must be hard-gated`).toBe(true);
  });
  it("live connectors typecheck and construct without keys, and throw ConfigError when called", async () => {
    for (const c of connectors) {
      const first = c.tools.find((t) => !c.policyHints[t.name]?.hardGate && (t.inputSchema.required ?? []).length === 0);
      if (!first) continue;
      const outcome = await c.callTool(first.name, {}, makeToolContext(c, { mode: "live" })).then((r) => ({ r }), (e: unknown) => ({ e }));
      if ("e" in outcome) expect(outcome.e, `${c.key}.${first.name}`).toBeInstanceOf(ConfigError);
      // Only static, read-only catalogue data (e.g. voyage.list_models) may answer without a vendor call.
      else if (outcome.r.ok) expect(first.annotations?.readOnlyHint, `${c.key}.${first.name} must not succeed without configuration`).toBe(true);
      else expect(outcome.r.ok).toBe(false);
    }
  });
});

describe("define: builder invariants", () => {
  it("rejects a hard-gated tool with a handler and a non-gated tool without one", () => {
    const gatedTool = defineTool({ name: "pay", description: "moves money", input: z.object({}), hints: { hardGate: true }, humanAction: () => ({ title: "Pay", instructions: "Do it yourself in the dashboard." }) });
    const readTool = defineTool({ name: "read", description: "reads things", input: z.object({}), hints: {} });
    expect(() => buildMockConnector({ key: "xx", displayName: "X", phase: 1, auth: { kind: "none" }, tools: [gatedTool], rateLimits: {}, handlers: { pay: async () => ({}) } as never, connect: async () => ({}) as never, healthcheck: async () => ({}) as never })).toThrow(/must not have a handler/);
    expect(() => buildMockConnector({ key: "xx", displayName: "X", phase: 1, auth: { kind: "none" }, tools: [readTool], rateLimits: {}, handlers: {}, connect: async () => ({}) as never, healthcheck: async () => ({}) as never })).toThrow(/has no handler/);
    expect(() => defineTool({ name: "pay2", description: "moves money", input: z.object({}), hints: { hardGate: true } })).toThrow(/human action/);
    expect(() => defineTool({ name: "Bad-Name", description: "x", input: z.object({}), hints: {} })).toThrow(/snake_case/);
  });
  it("live side must wrap a mock with the same key", async () => {
    const mock = buildMockConnector({ key: "aa", displayName: "A", phase: 1, auth: { kind: "none" }, tools: [defineTool({ name: "ping", description: "returns pong", input: z.object({}), output: z.object({ pong: z.literal(true) }), hints: {} })], rateLimits: {}, handlers: { ping: async () => ({ pong: true as const }) }, connect: async () => ({}) as never, healthcheck: async () => ({}) as never });
    expect(() => buildLiveConnector({ key: "bb", displayName: "B", phase: 1, auth: { kind: "none" }, tools: mock.tools as never, rateLimits: {}, handlers: {} as never, connect: async () => ({}) as never, healthcheck: async () => ({}) as never }, mock)).toThrow(/does not match/);
    expect(mock.simulations).toEqual([]);
    await expect(mock.simulate("anything", { businessId: TEST_BUSINESS_ID })).rejects.toMatchObject({ code: "unknown_simulation" });
  });
});
