/**
 * integrations.connect for a live API-key connector (audits GPC-05 / VMLSL-X2 and MLSL-24): the key the founder enters in
 * Settings › Integrations reaches `connect()` in the gateway (SEC-14: never in the api), is sealed there under the
 * credential kind the gateway loads (INTEGRATION_CREDENTIAL_KIND, the auth kind stays inside the payload), and is never
 * echoed. A live connect without the key is refused with the connector's own message instead of falling back to the
 * platform's key. The last test runs the whole path: connect through the api and the gateway, then a tool call through
 * another live gateway over the same database and vault.
 */
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTEGRATION_CREDENTIAL_KIND, repos } from "@foundmill/db";
import { buildAad, decryptJson } from "@foundmill/shared/crypto";
import { buildLiveConnector, buildMockConnector, ConnectInputError, connectInputValue, createRegistry, defineTool, mockHealth, mockIntegrationRecord, type ConnectField } from "@foundmill/connectors";
import { createGatewayApp } from "../../../gateway/src/app";
import { MemoryRateLimitStore } from "../../../gateway/src/rate-limit";
import { UntrustedRecipientRegistry } from "../../../gateway/src/recipients";
import { mintSessionToken } from "../../../gateway/src/tokens";
import { guardLiveCalls, inProcessGateway } from "./gateway-double";
import { createApiHarness, type ApiHarness } from "./harness";

const KEY = "keyed";
const FIELDS: ConnectField[] = [{ name: "apiKey", label: "API key", secret: true, required: true, hint: "Billed to your own account." }];

/** Stands in for SendGrid, Dropbox Sign, Cloudflare DNS: a live connect that needs the founder's own key. `seen` collects the key each tool call was handed. */
function keyedConnector(seen: (string | null)[] = []) {
  const tools = [defineTool({ name: "ping", description: "Checks the account answers.", input: z.object({}), output: z.object({ ok: z.literal(true) }), hints: {} })] as const;
  const spec = {
    key: KEY,
    displayName: "Keyed vendor",
    phase: 1 as const,
    auth: { kind: "api_key" as const },
    tools,
    rateLimits: {},
    handlers: {
      ping: async (_args: unknown, ctx: { credential?: { secret: string } }) => {
        seen.push(ctx.credential?.secret ?? null);
        return { ok: true as const };
      },
    },
    healthcheck: async () => mockHealth(KEY),
  };
  const mock = buildMockConnector({ ...spec, connect: async (businessId: string) => mockIntegrationRecord(KEY, businessId) });
  return buildLiveConnector(
    {
      ...spec,
      connectFields: FIELDS,
      connect: async (businessId: string, input: unknown) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(KEY, "apiKey", "Enter your Keyed vendor API key to connect it");
        return { ...mockIntegrationRecord(KEY, businessId, { status: "connected", accountLabel: "founder@northwind.example" }), credentialToStore: { kind: "api_key" as const, secret: apiKey } };
      },
    },
    mock,
  );
}

let hz: ApiHarness;
// The api's own registry refuses to run a live connector; the gateway runs it over the api's database and vault.
const gateway = inProcessGateway();
const guarded = guardLiveCalls(createRegistry([keyedConnector()]));
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "intconnect", env: { LIVE_CONNECTORS: KEY }, connectors: guarded.registry, gateway: gateway.client });
  gateway.bind({ db: hz.db, vault: hz.deps.vault, registry: createRegistry([keyedConnector()]), liveConnectors: [KEY] });
}, 120_000);
afterAll(() => hz.close());

describe("integrations.connect with the founder's own key", () => {
  it("lists the fields to enter for a connector that runs live", async () => {
    const list = await hz.caller({ userId: hz.A.ownerId }).integrations.list({ businessId: hz.A.businessId });
    expect(list.catalogue.find((c) => c.key === KEY)).toMatchObject({ live: true, connectFields: FIELDS });
  });

  it("refuses a live connect without the key and stores nothing", async () => {
    await expect(hz.caller({ userId: hz.A.ownerId }).integrations.connect({ businessId: hz.A.businessId, connectorKey: KEY, input: {} })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Enter your Keyed vendor API key to connect it" });
    expect(await repos.integrations.getByKey(hz.db, hz.A.businessId, KEY)).toBeNull();
    expect(gateway.paths.at(-1)).toBe("/v1/integrations/connect");
    expect(guarded.liveCalls).toEqual([]);
  });

  it("seals the key under the kind the gateway loads and never returns it", async () => {
    const secret = "founder-own-key-0123456789";
    const r = await hz.caller({ userId: hz.A.ownerId }).integrations.connect({ businessId: hz.A.businessId, connectorKey: KEY, input: { apiKey: secret } });
    expect(r.integration).toMatchObject({ connectorKey: KEY, status: "connected" });
    expect(JSON.stringify(r)).not.toContain(secret);
    const integrationId = r.integration!.id;
    const metas = await repos.credentials.listMetadata(hz.db, hz.A.businessId, { integrationId });
    expect(metas.map((m) => m.kind)).toEqual([INTEGRATION_CREDENTIAL_KIND]);
    // What the gateway's loader does: the newest live row of that kind, opened with the row-bound AAD.
    const loaded = await repos.credentials.latest(hz.db, hz.A.businessId, integrationId);
    expect(loaded).not.toBeNull();
    const credential = await decryptJson(hz.deps.vault!, loaded!.record, buildAad(hz.A.businessId, "credentials", loaded!.meta.id));
    expect(credential).toEqual({ kind: "api_key", secret });
    const audits = await repos.audit.list(hz.db, hz.A.businessId, { action: "integrations.connect" });
    expect(audits.items[0]?.details).toMatchObject({ secretStored: true, secretHint: "foun***", credentialId: loaded!.meta.id });
    expect(JSON.stringify(await repos.audit.list(hz.db, hz.A.businessId, { limit: 200 }))).not.toContain(secret);
    // Sealed by the gateway; the api's own connector never ran.
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "gateway.integration.connect", limit: 1 })).items[0]?.details).toMatchObject({ service: "api", mode: "live", secretStored: true, integrationId });
    expect(guarded.liveCalls).toEqual([]);
  });

  it("checks a live integration's health through the gateway, never in the api", async () => {
    const row = (await repos.integrations.getByKey(hz.db, hz.A.businessId, KEY))!;
    const r = await hz.caller({ userId: hz.A.ownerId }).integrations.health({ businessId: hz.A.businessId, integrationId: row.id });
    expect(r.health).toMatchObject({ ok: true });
    expect(gateway.paths.at(-1)).toBe("/v1/integrations/health");
    expect(guarded.liveCalls).toEqual([]);
  });
});

describe("a key connected in Settings is found by a live gateway call (audits GPC-05 / VMLSL-X2)", () => {
  const SECRET = "test-session-token-secret-0123456789";
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

  it("answers 409 before the key is connected, and runs with the founder's key after integrations.connect stored it", async () => {
    const seen: (string | null)[] = [];
    const registry = createRegistry([keyedConnector(seen)]);
    // The gateway over the api's own database and vault, in live mode: the way a deployment shares them.
    const gateway = createGatewayApp({ db: hz.db, registry, vault: hz.deps.vault, mode: "live", rateLimits: new MemoryRateLimitStore(), recipients: new UntrustedRecipientRegistry(), log: silent }, { sessionTokenSecret: SECRET });
    const session = await repos.agents.createSession(hz.db, hz.B.businessId, { agentId: hz.B.agentId, modelKey: "sonnet" });
    const { token } = await mintSessionToken(SECRET, { businessId: hz.B.businessId, agentId: hz.B.agentId, sessionId: session.id, allowedTools: [`${KEY}:ping`] }, 300);
    const ping = () => gateway.request("/v1/call", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ connector: KEY, tool: "ping", args: {} }) });

    // Nothing connected yet: a live call is refused before it reaches the vendor.
    expect((await ping()).status).toBe(409);
    expect(seen).toEqual([]);

    const secret = "founder-own-key-for-the-gateway-0123";
    await hz.caller({ userId: hz.B.ownerId }).integrations.connect({ businessId: hz.B.businessId, connectorKey: KEY, input: { apiKey: secret } });
    const res = await ping();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "allow", result: { ok: true } });
    expect(seen).toEqual([secret]);
  });
});
