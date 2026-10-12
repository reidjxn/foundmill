/**
 * integrations.connect for a live API-key connector (audits GPC-05 / VMLSL-X2 and MLSL-24): the key the founder enters in
 * Settings › Integrations reaches `connect()`, is sealed under the credential kind the gateway loads
 * (INTEGRATION_CREDENTIAL_KIND, the auth kind stays inside the payload), and is never echoed. A live connect without
 * the key is refused with the connector's own message instead of falling back to the platform's key.
 */
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTEGRATION_CREDENTIAL_KIND, repos } from "@foundmill/db";
import { buildAad, decryptJson } from "@foundmill/shared/crypto";
import { buildLiveConnector, buildMockConnector, ConnectInputError, connectInputValue, createRegistry, defineTool, mockHealth, mockIntegrationRecord, type ConnectField } from "@foundmill/connectors";
import { createApiHarness, type ApiHarness } from "./harness";

const KEY = "keyed";
const FIELDS: ConnectField[] = [{ name: "apiKey", label: "API key", secret: true, required: true, hint: "Billed to your own account." }];

/** Stands in for SendGrid, Dropbox Sign, Cloudflare DNS: a live connect that needs the founder's own key. */
function keyedConnector() {
  const tools = [defineTool({ name: "ping", description: "Checks the account answers.", input: z.object({}), output: z.object({ ok: z.literal(true) }), hints: {} })] as const;
  const spec = {
    key: KEY,
    displayName: "Keyed vendor",
    phase: 1 as const,
    auth: { kind: "api_key" as const },
    tools,
    rateLimits: {},
    handlers: { ping: async () => ({ ok: true as const }) },
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
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "intconnect", env: { LIVE_CONNECTORS: KEY }, connectors: createRegistry([keyedConnector()]) });
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
  });

  it("seals the key under the kind the gateway loads and never returns it", async () => {
    const secret = "founder-own-key-0123456789";
    const r = await hz.caller({ userId: hz.A.ownerId }).integrations.connect({ businessId: hz.A.businessId, connectorKey: KEY, input: { apiKey: secret } });
    expect(r.integration).toMatchObject({ connectorKey: KEY, status: "connected" });
    expect(JSON.stringify(r)).not.toContain(secret);
    const metas = await repos.credentials.listMetadata(hz.db, hz.A.businessId, { integrationId: r.integration.id });
    expect(metas.map((m) => m.kind)).toEqual([INTEGRATION_CREDENTIAL_KIND]);
    // What the gateway's loader does: the newest live row of that kind, opened with the row-bound AAD.
    const loaded = await repos.credentials.latest(hz.db, hz.A.businessId, r.integration.id);
    expect(loaded).not.toBeNull();
    const credential = await decryptJson(hz.deps.vault!, loaded!.record, buildAad(hz.A.businessId, "credentials", loaded!.meta.id));
    expect(credential).toEqual({ kind: "api_key", secret });
    const audits = await repos.audit.list(hz.db, hz.A.businessId, { action: "integrations.connect" });
    expect(JSON.stringify(audits)).not.toContain(secret);
  });
});
