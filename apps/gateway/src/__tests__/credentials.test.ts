/**
 * Live calls find the credential Settings › Integrations stored (audit GPC-05 / VMLSL-X2): `integrations.connect` used to
 * store it under the connector's auth kind (`api_key`, `oauth`) while the gateway only ever loaded kind `secret`, so every
 * founder-connected integration answered 409 "not connected" in live mode. Both now use INTEGRATION_CREDENTIAL_KIND; rows
 * an older api stored under the auth kind are still read. A token a connector refreshes mid-call is sealed back in place.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { INTEGRATION_CREDENTIAL_KIND, repos } from "@foundmill/db";
import { buildAad, encryptJson } from "@foundmill/shared/crypto";
import type { DecryptedCredential } from "@foundmill/connectors";
import { CREDENTIAL_KIND, loadCredential } from "../credentials";
import type { AllowResponse, CallResponse } from "../types";
import { setupGateway, type GatewayFixture } from "./harness";

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

/** Exactly what apps/api `integrations.connect` does with a connector's `credentialToStore` (kind overridable for old rows). */
async function storeLikeIntegrationsConnect(g: GatewayFixture, credential: unknown, kind: string = INTEGRATION_CREDENTIAL_KIND): Promise<string> {
  return g.db.transaction(async (tx) => {
    const bootstrap = await encryptJson(g.vault, credential, buildAad(g.businessId, "credentials", "pending"));
    const meta = await repos.credentials.store(tx, g.businessId, { integrationId: g.integrationId, kind, record: bootstrap, expiresAt: null });
    await repos.credentials.rotate(tx, g.businessId, meta.id, await encryptJson(g.vault, credential, buildAad(g.businessId, "credentials", meta.id)));
    return meta.id;
  });
}

const archiveAll = async (g: GatewayFixture) => {
  for (const m of await repos.credentials.listMetadata(g.db, g.businessId, { integrationId: g.integrationId })) await repos.credentials.revoke(g.db, g.businessId, m.id);
};

describe("live calls with credentials from Settings › Integrations", () => {
  let g: GatewayFixture;
  beforeAll(async () => {
    g = await setupGateway({ mode: "live" });
  }, 120_000);
  afterAll(async () => {
    await g.close();
  });
  beforeEach(async () => {
    g.seen.length = 0;
    await archiveAll(g);
  });

  it("the gateway and the api agree on the row kind", () => {
    expect(CREDENTIAL_KIND).toBe(INTEGRATION_CREDENTIAL_KIND);
  });

  it("uses the key the founder entered (stored the way integrations.connect stores it)", async () => {
    const credential: DecryptedCredential = { kind: "api_key", secret: "SG.founder-own-key-0001" };
    await storeLikeIntegrationsConnect(g, credential);
    const r = asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: { text: "live" } }));
    expect(r.result.ok).toBe(true);
    expect(g.seen.at(-1)).toMatchObject({ mode: "live", credentialSecret: "SG.founder-own-key-0001" });
    expect(JSON.stringify(r)).not.toContain("founder-own-key");
  });

  it("still finds rows an older integrations.connect stored under the auth kind (api_key, oauth)", async () => {
    await storeLikeIntegrationsConnect(g, { kind: "api_key", secret: "legacy-api-key" }, "api_key");
    asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: {} }));
    expect(g.seen.at(-1)?.credentialSecret).toBe("legacy-api-key");

    await archiveAll(g);
    await storeLikeIntegrationsConnect(g, { kind: "oauth", secret: "legacy-access-token", refreshToken: "r1", expiresAt: "2026-12-01T00:00:00.000Z" }, "oauth");
    const loaded = await loadCredential(g.db, g.vault, g.businessId, g.integrationId);
    expect(loaded?.credential).toMatchObject({ kind: "oauth", secret: "legacy-access-token", refreshToken: "r1" });

    // A business's own model key from before 2026-10-10 had the shape { apiKey } under kind api_key.
    await archiveAll(g);
    await storeLikeIntegrationsConnect(g, { apiKey: "sk-ant-legacy-0001" }, "api_key");
    expect((await loadCredential(g.db, g.vault, g.businessId, g.integrationId))?.credential).toEqual({ kind: "api_key", secret: "sk-ant-legacy-0001" });
  });

  it("prefers the current row over a legacy one, and refuses with 409 only when there is none", async () => {
    await storeLikeIntegrationsConnect(g, { kind: "api_key", secret: "old" }, "api_key");
    await storeLikeIntegrationsConnect(g, { kind: "api_key", secret: "new" });
    asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: {} }));
    expect(g.seen.at(-1)?.credentialSecret).toBe("new");

    await archiveAll(g);
    await expect(g.client.call(await g.token(), { connector: "test", tool: "note", args: {} })).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
  });
});

describe("a credential the connector refreshes during a call", () => {
  let g: GatewayFixture;
  beforeAll(async () => {
    g = await setupGateway({ mode: "live", connector: { refreshedSecret: "refreshed-access-token" } });
  }, 120_000);
  afterAll(async () => {
    await g.close();
  });

  it("is sealed back into the same row, so the next call uses it instead of refreshing again", async () => {
    const id = await storeLikeIntegrationsConnect(g, { kind: "oauth", secret: "expired-access-token", refreshToken: "r1" });
    asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: {} }));
    expect(g.seen.at(-1)?.credentialSecret).toBe("expired-access-token");
    const loaded = await loadCredential(g.db, g.vault, g.businessId, g.integrationId);
    expect(loaded).toMatchObject({ credentialId: id, credential: { kind: "oauth", secret: "refreshed-access-token", refreshToken: "r1", expiresAt: "2026-12-31T00:00:00.000Z" }, expiresAt: "2026-12-31T00:00:00.000Z" });
    asAllow(await g.client.call(await g.token(), { connector: "test", tool: "note", args: {} }));
    expect(g.seen.at(-1)?.credentialSecret).toBe("refreshed-access-token");
    const audit = await repos.audit.list(g.db, g.businessId, { action: "tool.call" });
    expect(JSON.stringify(audit)).not.toContain("refreshed-access-token");
  });
});
