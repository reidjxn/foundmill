import { sql } from "drizzle-orm";
import { createDefaultRegistry } from "@foundmill/connectors";
import { loadByokApiKey, repos, resumeBusinessAgents } from "@foundmill/db";
import { MODELS } from "@foundmill/models";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCaller } from "../router";
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
    // The free tier includes a monthly platform credit (DECISIONS 2026-10-12): the business falls back to it, still
    // bounded by its balance, and stays paused until the founder resumes the team or sets a new key.
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).planTier).toBe("free");
    expect(revoked.modelBilling).toBe("credits");
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("credits");
    expect(note.bodyMd).toMatch(/plan's credits, or set a new key/);
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

describe("the key is checked the way it will be used (audit BILL-04)", () => {
  /** Anthropic with live models: messages answer per `messages`, the model list names every routed model. */
  function anthropicFetch(messages: () => Response) {
    const calls: string[] = [];
    const fn = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(new URL(url).pathname);
      if (url.includes("/v1/messages")) return messages();
      return new Response(JSON.stringify({ data: Object.values(MODELS).map((id) => ({ type: "model", id, display_name: id, created_at: "2026-01-01T00:00:00Z" })), has_more: false, first_id: null, last_id: null }), { status: 200, headers: { "content-type": "application/json" } });
    };
    return { fetch: fn as unknown as typeof globalThis.fetch, calls };
  }
  const ok = () => new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: MODELS.haiku, content: [{ type: "text", text: "p" }], stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 8, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  const refused = (status: number, type: string, message: string) => () => new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json" } });

  /** Production's shape: live models, mock connectors. */
  const liveModels = (fetch: typeof globalThis.fetch) => {
    vi.stubGlobal("fetch", fetch);
    return createCaller({ ...hz.deps, env: { ...hz.deps.env, MODEL_MODE: "live", INTEGRATIONS_MODE: "mock" }, connectors: createDefaultRegistry({ fetch }) }, { userId: hz.A.ownerId });
  };
  afterEach(() => vi.unstubAllGlobals());

  it("with live models a look-alike key is refused by a real call, and the business stays where it was", async () => {
    const before = (await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling;
    const anthropic = anthropicFetch(refused(401, "authentication_error", "invalid x-api-key"));
    const caller = liveModels(anthropic.fetch);
    const validation = await caller.keys.validate({ businessId: hz.A.businessId, apiKey: "sk-ant-not-a-real-key" });
    expect(validation).toMatchObject({ valid: false, mode: "live", routedModels: [] });
    expect(anthropic.calls).toEqual(["/v1/messages"]);
    expect(Date.now() - Date.parse(validation.checkedAt)).toBeLessThan(60_000);
    await expect(caller.keys.setAnthropic({ businessId: hz.A.businessId, apiKey: "sk-ant-not-a-real-key" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe(before);
  });

  it("an account with no credit is refused too, in words the founder can act on", async () => {
    const caller = liveModels(anthropicFetch(refused(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")).fetch);
    const validation = await caller.keys.validate({ businessId: hz.A.businessId, apiKey: KEY });
    expect(validation).toMatchObject({ valid: false, mode: "live" });
    expect(validation.reason).toMatch(/no credit left\. Add credit in the Anthropic Console/);
  });

  it("a working key is stored as a live connection with the routed models checked", async () => {
    const anthropic = anthropicFetch(ok);
    const caller = liveModels(anthropic.fetch);
    try {
      const stored = await caller.keys.setAnthropic({ businessId: hz.A.businessId, apiKey: KEY });
      expect(stored.validation).toMatchObject({ valid: true, mode: "live" });
      expect(stored.validation.routedModels.length).toBeGreaterThan(0);
      expect(stored.validation.routedModels.every((m) => m.available)).toBe(true);
      expect(anthropic.calls[0]).toBe("/v1/messages");
      expect(anthropic.calls).toContain("/v1/models");
      expect((await repos.integrations.get(hz.db, hz.A.businessId, stored.integrationId)).status).toBe("connected");
    } finally {
      await hz.caller({ userId: hz.A.ownerId }).keys.revoke({ businessId: hz.A.businessId });
      await resumeBusinessAgents(hz.db, hz.A.businessId);
    }
  });
});

describe("Settings › Integrations hands the Anthropic key to Settings › Keys (audit ARB-04, BILL-21)", () => {
  it("disconnecting Anthropic is a revoke: billing leaves byok, the team stops, and the note reaches the outbox", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await resumeBusinessAgents(hz.db, hz.A.businessId);
    const stored = await owner.keys.setAnthropic({ businessId: hz.A.businessId, apiKey: KEY });
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("byok");
    await repos.agents.setStatus(hz.db, hz.A.businessId, hz.A.agentId, "healthy");

    const row = await owner.integrations.disconnect({ businessId: hz.A.businessId, integrationId: stored.integrationId });
    expect(row.status).toBe("disconnected");
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBilling).toBe("credits");
    expect((await owner.keys.status({ businessId: hz.A.businessId })).configured).toBe(false);
    expect((await repos.agents.get(hz.db, hz.A.businessId, hz.A.agentId)).status).toBe("paused");
    expect(await repos.businesses.agentsStopped(hz.db, hz.A.businessId)).toBe(true);
    const notes = await repos.inbox.list(hz.db, hz.A.businessId, { limit: 50 });
    const note = notes.items.find((n) => n.subject === "Anthropic key revoked: team paused");
    expect(note).toBeDefined();
    const created = (await repos.events.list(hz.db, hz.A.businessId, { type: "inbox.item_created", limit: 200 })).items.find((e) => (e.payload as { inboxItemId: string }).inboxItemId === note!.id);
    expect(created?.actor).toMatchObject({ kind: "agent" });
    await resumeBusinessAgents(hz.db, hz.A.businessId);
  });

  it("connecting Anthropic as a generic connector is refused and points at Settings › Keys", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.integrations.connect({ businessId: hz.A.businessId, connectorKey: "anthropic", input: { apiKey: KEY } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Settings › Keys/) });
    expect((await owner.keys.status({ businessId: hz.A.businessId })).configured).toBe(false);
  });
});
