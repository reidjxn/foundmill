import { sql } from "drizzle-orm";
import { loadByokApiKey, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "keys" });
}, 120_000);
afterAll(() => hz.close());

const KEY = "sk-ant-api03-test-key-0123456789abcdef";

describe("keys.setAnthropic / validate / rotate / revoke (BUILD §10.2)", () => {
  it("validates through the anthropic connector (mock) and stores ciphertext only", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const result = await owner.keys.setAnthropic({ businessId: hz.A.businessId, apiKey: KEY });
    expect(result.validation.valid).toBe(true);
    expect(result.validation.mode).toBe("mock");
    expect(result.fingerprint).toBe("sk-a***");
    expect(JSON.stringify(result)).not.toContain(KEY);

    const rows = (await hz.h.db.execute(sql`select ciphertext, data_key_ciphertext, kms_key_id, nonce, archived_at from credentials where id = ${result.credentialId}::uuid`)) as unknown as { rows: Record<string, unknown>[] };
    const row = rows.rows[0]!;
    const ciphertext = Buffer.from(row.ciphertext as Uint8Array).toString("utf8");
    expect(ciphertext).not.toContain(KEY);
    expect(ciphertext).not.toContain("sk-ant");
    expect(row.nonce).toBeNull();
    expect(String(row.kms_key_id)).toMatch(/^local:/);
    expect(row.archived_at).toBeNull();

    const loaded = await repos.credentials.load(hz.db, hz.A.businessId, result.credentialId);
    expect(loaded.record.alg).toBe("xchacha20poly1305-ietf");
    expect(JSON.stringify(loaded.record)).not.toContain(KEY);

    const status = await owner.keys.status({ businessId: hz.A.businessId });
    expect(status.configured).toBe(true);
    expect(status.integration?.accountLabel).toBe("sk-a***");

    // The business now runs on its own key, and the orchestrator/gateway loader reads back exactly what was pasted.
    expect(result.modelBilling).toBe("byok");
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("byok");
    const key = await loadByokApiKey(hz.db, hz.deps.vault!, hz.A.businessId);
    expect(key).toMatchObject({ apiKey: KEY, credentialId: result.credentialId, integrationId: result.integrationId, shape: "current" });
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "keys.set_anthropic" });
    expect(audit.items).toHaveLength(1);
    expect(JSON.stringify(audit.items[0]!.details)).not.toContain(KEY);
  });

  it("rejects a key the vendor refuses, and only admins may set keys", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.keys.setAnthropic({ businessId: hz.A.businessId, apiKey: "sk-ant-invalid-key" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const validation = await owner.keys.validate({ businessId: hz.A.businessId, apiKey: "sk-ant-revoked-key" });
    expect(validation.valid).toBe(false);
    await expect(hz.caller({ userId: hz.A.memberId }).keys.setAnthropic({ businessId: hz.A.businessId, apiKey: KEY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).keys.setAnthropic({ businessId: hz.A.businessId, apiKey: KEY })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rotate archives the previous credential; revoke pauses the team and posts an Inbox note", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const rotated = await owner.keys.rotate({ businessId: hz.A.businessId, apiKey: `${KEY}-rotated` });
    const metas = await repos.credentials.listMetadata(hz.db, hz.A.businessId, { integrationId: rotated.integrationId });
    expect(metas).toHaveLength(1);
    expect(metas[0]!.id).toBe(rotated.credentialId);
    expect((await loadByokApiKey(hz.db, hz.deps.vault!, hz.A.businessId))?.apiKey).toBe(`${KEY}-rotated`);

    await repos.agents.setStatus(hz.db, hz.A.businessId, hz.A.agentId, "healthy");
    const revoked = await owner.keys.revoke({ businessId: hz.A.businessId });
    expect(revoked.revoked).toBeGreaterThanOrEqual(1);
    expect(revoked.pausedAgents).toBeGreaterThanOrEqual(1);
    expect(revoked.noteId).not.toBeNull();
    const note = await repos.inbox.get(hz.db, hz.A.businessId, revoked.noteId!);
    expect(note.type).toBe("warning");
    expect((await owner.keys.status({ businessId: hz.A.businessId })).configured).toBe(false);
    expect((await repos.agents.get(hz.db, hz.A.businessId, hz.A.agentId)).status).toBe("paused");
    expect(await loadByokApiKey(hz.db, hz.deps.vault!, hz.A.businessId)).toBeNull();
    // The free tier has no credits to fall back to: the business stays on byok, paused until a new key is set.
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).planTier).toBe("free");
    expect(revoked.modelBilling).toBe("byok");
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("byok");
    expect(note.bodyMd).toMatch(/Set a new key/);
  });

  it("on a tier with credits, revoking the key moves the business back to credits", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await owner.billing.changeTier({ businessId: hz.A.businessId, tier: "pro" });
    try {
      const stored = await owner.keys.setAnthropic({ businessId: hz.A.businessId, apiKey: KEY });
      expect(stored.modelBilling).toBe("byok");
      expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("byok");
      const revoked = await owner.keys.revoke({ businessId: hz.A.businessId });
      expect(revoked.modelBilling).toBe("credits");
      expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("credits");
      expect((await repos.inbox.get(hz.db, hz.A.businessId, revoked.noteId!)).bodyMd).toMatch(/plan's credits/);
      const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "keys.revoke" });
      expect(audit.items.find((e) => (e.details as { modelBilling?: { to?: string } }).modelBilling?.to === "credits")?.details).toMatchObject({ modelBilling: { from: "byok", to: "credits" } });
    } finally {
      await owner.billing.changeTier({ businessId: hz.A.businessId, tier: "free" });
    }
  });
});
