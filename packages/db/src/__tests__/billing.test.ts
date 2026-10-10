/**
 * Credits and the business's own key (BUILD §10.2, §10.4, §10.5): `chargeCredits` settles a metered cost after the fact
 * and stops at zero; `bookUsage` records every row, charges credits rows once a balance exists, pauses the team and posts
 * one Inbox warning on the charge that uses the last credit; `loadByokApiKey` reads the row apps/api seals (and the
 * pre-2026-10-10 shape) and nothing for a revoked key.
 */
import { buildAad, createVault, encryptJson, generateMasterKey } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookUsage, CREDITS_EXHAUSTED_SUBJECT } from "../billing";
import { BYOK_CREDENTIAL_KIND, LEGACY_BYOK_CREDENTIAL_KIND, loadByokApiKey } from "../byok";
import { repos } from "../repos";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("bill");
});
afterAll(() => r?.close());

const PERIOD = "2026-10";
const at = (d: number) => new Date(Date.UTC(2026, 9, d, 12));

describe("usage.chargeCredits", () => {
  it("is null without a balance row, charges in full, and stops the balance at zero", async () => {
    const B = r.B.businessId;
    expect(await repos.usage.chargeCredits(r.db, B, PERIOD, 10)).toBeNull();
    await repos.usage.grantCredits(r.db, B, PERIOD, 100);
    const first = await repos.usage.chargeCredits(r.db, B, PERIOD, 60);
    expect(first).toMatchObject({ exhausted: null, balance: { balanceMinor: 40, spentMinor: 60 } });
    const second = await repos.usage.chargeCredits(r.db, B, PERIOD, 60);
    expect(second).toMatchObject({ exhausted: "now", balance: { balanceMinor: 0, spentMinor: 120 } });
    const third = await repos.usage.chargeCredits(r.db, B, PERIOD, 5);
    expect(third).toMatchObject({ exhausted: "already", balance: { balanceMinor: 0, spentMinor: 125 } });
    expect((await repos.usage.chargeCredits(r.db, B, PERIOD, 0))?.exhausted).toBeNull();
    // Another period is untouched.
    expect(await repos.usage.chargeCredits(r.db, B, "2026-11", 1)).toBeNull();
  });
});

describe("bookUsage", () => {
  const A = () => r.A.businessId;
  const tokens = (costMinor: number, billedTo: "byok" | "credits", day = 3) => ({ agentId: r.A.agentId, kind: "tokens" as const, modelKey: "sonnet" as const, quantity: 1000, unit: "tokens", costMinor, billedTo, occurredAt: at(day), details: { label: "Estimate" } });

  it("records a byok row without touching credits, and a credits row is metered but not enforced until a balance exists", async () => {
    const byok = await bookUsage(r.db, A(), tokens(50, "byok"));
    expect(byok.entry.billedTo).toBe("byok");
    expect(byok.credits).toBeNull();
    const credits = await bookUsage(r.db, A(), tokens(50, "credits"));
    expect(credits.entry.billedTo).toBe("credits");
    expect(credits.credits).toMatchObject({ enforced: false, exhausted: null, pausedAgents: 0, noteId: null });
    expect(await repos.usage.creditBalance(r.db, A(), PERIOD)).toBeNull();
  });

  it("charges credits once granted; the charge that uses the last credit pauses the team and posts one Inbox warning", async () => {
    await repos.usage.grantCredits(r.db, A(), PERIOD, 100);
    await repos.agents.setStatus(r.db, A(), r.A.agentId, "healthy");
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "idle");
    const notesBefore = (await repos.inbox.list(r.db, A(), { limit: 200 })).items.length;

    const partial = await bookUsage(r.db, A(), tokens(60, "credits"));
    expect(partial.credits).toMatchObject({ enforced: true, exhausted: null, pausedAgents: 0, noteId: null, balance: { balanceMinor: 40 } });
    expect((await repos.agents.get(r.db, A(), r.A.agentId)).status).toBe("healthy");

    const last = await bookUsage(r.db, A(), tokens(60, "credits"));
    expect(last.credits).toMatchObject({ enforced: true, exhausted: "now", balance: { balanceMinor: 0, spentMinor: 120 } });
    expect(last.credits!.pausedAgents).toBeGreaterThanOrEqual(2);
    expect(last.credits!.noteId).not.toBeNull();
    expect((await repos.agents.get(r.db, A(), r.A.agentId)).status).toBe("paused");
    expect((await repos.agents.get(r.db, A(), r.A.agent2Id)).status).toBe("paused");
    const note = await repos.inbox.get(r.db, A(), last.credits!.noteId!);
    expect(note.type).toBe("warning");
    expect(note.subject).toBe(CREDITS_EXHAUSTED_SUBJECT);
    expect(note.bodyMd).toMatch(/Estimate/);
    const audit = await repos.audit.list(r.db, A(), { action: "billing.credits_exhausted" });
    expect(audit.items).toHaveLength(1);

    // Overrun is recorded (the ledger is the truth) without a second pause or note.
    const over = await bookUsage(r.db, A(), tokens(7, "credits"));
    expect(over.credits).toMatchObject({ enforced: true, exhausted: "already", pausedAgents: 0, noteId: null, balance: { balanceMinor: 0, spentMinor: 127 } });
    expect((await repos.inbox.list(r.db, A(), { limit: 200 })).items.length).toBe(notesBefore + 1);
    expect((await repos.audit.list(r.db, A(), { action: "billing.credits_exhausted" })).items).toHaveLength(1);
    // Business B's balance is its own.
    expect((await repos.usage.creditBalance(r.db, r.B.businessId, PERIOD))?.spentMinor).toBe(125);
  });
});

describe("loadByokApiKey", () => {
  const vault = createVault({ DEV_MASTER_KEY: generateMasterKey(), APP_ENV: "test" });
  const seal = async (businessId: string, integrationId: string, kind: string, payload: unknown) => {
    const provisional = await encryptJson(vault, payload, buildAad(businessId, "credentials", "pending"));
    const meta = await repos.credentials.store(r.db, businessId, { integrationId, kind, record: provisional });
    await repos.credentials.rotate(r.db, businessId, meta.id, await encryptJson(vault, payload, buildAad(businessId, "credentials", meta.id)));
    return meta.id;
  };

  it("is null without an integration; reads the sealed connector shape; still reads the legacy shape; null once revoked", async () => {
    const B = r.B.businessId;
    expect(await loadByokApiKey(r.db, vault, B)).toBeNull();
    const integration = await repos.integrations.upsert(r.db, B, { connectorKey: "anthropic", status: "connected", authKind: "api_key", accountLabel: "sk-a***" });
    expect(await loadByokApiKey(r.db, vault, B)).toBeNull();

    const legacyId = await seal(B, integration.id, LEGACY_BYOK_CREDENTIAL_KIND, { apiKey: "sk-ant-legacy-0001" });
    expect(await loadByokApiKey(r.db, vault, B)).toMatchObject({ apiKey: "sk-ant-legacy-0001", credentialId: legacyId, integrationId: integration.id, shape: "legacy" });

    const currentId = await seal(B, integration.id, BYOK_CREDENTIAL_KIND, { kind: "api_key", secret: "sk-ant-current-0002" });
    expect(await loadByokApiKey(r.db, vault, B)).toMatchObject({ apiKey: "sk-ant-current-0002", credentialId: currentId, shape: "current" });
    // Business A never sees B's key.
    expect(await loadByokApiKey(r.db, vault, r.A.businessId)).toBeNull();

    // Revoke the way keys.revoke does: archive every credential and disconnect the integration.
    for (const m of await repos.credentials.listMetadata(r.db, B, { integrationId: integration.id })) await repos.credentials.revoke(r.db, B, m.id);
    await repos.integrations.disconnect(r.db, B, integration.id);
    expect(await loadByokApiKey(r.db, vault, B)).toBeNull();
  });
});
