/**
 * Credits and the business's own key (BUILD §10.2, §10.4, §10.5): `chargeCredits` settles a metered cost after the fact
 * and stops at zero; `bookUsage` records every row and charges the platform's USD costs of a business on credits, which
 * always holds a balance (the tier's included credits are granted on the first charge of a month), pauses the team and
 * posts one Inbox warning on the charge that uses the last credit; `loadByokApiKey` reads the row apps/api seals (and
 * the pre-2026-10-10 shape) and nothing for a revoked key.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { buildAad, createVault, encryptJson, generateMasterKey } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookUsage, chargesCredits, creditsState, CREDITS_EXHAUSTED_SUBJECT } from "../billing";
import { BYOK_CREDENTIAL_KIND, LEGACY_BYOK_CREDENTIAL_KIND, loadByokApiKey } from "../byok";
import { repos } from "../repos";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("bill");
});
afterAll(() => r?.close());

const PERIOD = "2026-10";
const at = (d: number, month = 9) => new Date(Date.UTC(2026, month, d, 12));
const FREE_INCLUDED = includedCreditsMinor("free");

describe("usage.chargeCredits", () => {
  it("is null without a balance row, charges in full, and stops the balance at zero", async () => {
    const B = r.B.businessId;
    expect(await repos.usage.chargeCredits(r.db, B, PERIOD, 10)).toBeNull();
    await repos.usage.grantCredits(r.db, B, PERIOD, 100);
    const first = await repos.usage.chargeCredits(r.db, B, PERIOD, 60);
    expect(first).toMatchObject({ exhausted: null, balance: { balanceMinor: 40, spentMinor: 60, currency: "USD" } });
    const second = await repos.usage.chargeCredits(r.db, B, PERIOD, 60);
    expect(second).toMatchObject({ exhausted: "now", balance: { balanceMinor: 0, spentMinor: 120 } });
    const third = await repos.usage.chargeCredits(r.db, B, PERIOD, 5);
    expect(third).toMatchObject({ exhausted: "already", balance: { balanceMinor: 0, spentMinor: 125 } });
    expect((await repos.usage.chargeCredits(r.db, B, PERIOD, 0))?.exhausted).toBeNull();
    // Another period is untouched.
    expect(await repos.usage.chargeCredits(r.db, B, "2026-11", 1)).toBeNull();
  });

  it("with the included credits a period without a row starts with them; nothing included means the first charge empties it", async () => {
    const B = r.B.businessId;
    const opened = await repos.usage.chargeCredits(r.db, B, "2027-02", 30, { includedMinor: 100 });
    expect(opened).toMatchObject({ exhausted: null, balance: { grantedMinor: 100, balanceMinor: 70, spentMinor: 30, currency: "USD" } });
    // An existing row (a top-up came first) is charged as it is; the included credits are not granted again.
    expect(await repos.usage.chargeCredits(r.db, B, "2027-02", 10, { includedMinor: 100 })).toMatchObject({ balance: { grantedMinor: 100, balanceMinor: 60 } });
    expect(await repos.usage.chargeCredits(r.db, B, "2027-03", 1, { includedMinor: 0 })).toMatchObject({ exhausted: "now", balance: { grantedMinor: 0, balanceMinor: 0, spentMinor: 1 } });
  });
});

describe("bookUsage", () => {
  const A = () => r.A.businessId;
  const tokens = (costMinor: number, billedTo: "byok" | "credits", day = 3, month = 9) => ({ agentId: r.A.agentId, kind: "tokens" as const, modelKey: "sonnet" as const, quantity: 1000, unit: "tokens", costMinor, billedTo, occurredAt: at(day, month), details: { label: "Estimate" } });

  it("only platform costs in US dollars are charged: a byok row, a tool row and a row in another currency touch no balance", async () => {
    expect(chargesCredits({ billedTo: "credits", kind: "tokens", currency: "USD" })).toBe(true);
    expect(chargesCredits({ billedTo: "byok", kind: "tokens", currency: "USD" })).toBe(false);
    expect(chargesCredits({ billedTo: "credits", kind: "tool", currency: "USD" })).toBe(false);
    expect(chargesCredits({ billedTo: "credits", kind: "tokens", currency: "GBP" })).toBe(false);

    const byok = await bookUsage(r.db, A(), tokens(50, "byok"));
    expect(byok.entry.billedTo).toBe("byok");
    expect(byok.credits).toBeNull();
    const tool = await bookUsage(r.db, A(), { agentId: r.A.agentId, kind: "tool", quantity: 1, unit: "calls", costMinor: 900, currency: "USD", billedTo: "credits", occurredAt: at(3) });
    expect(tool.credits).toBeNull();
    const pounds = await bookUsage(r.db, A(), { ...tokens(900, "credits"), currency: "GBP" });
    expect(pounds.credits).toBeNull();
    expect(await repos.usage.creditBalance(r.db, A(), PERIOD)).toBeNull();
  });

  it("a business on credits is always enforced: the first charge of each month grants the tier's included credits, in US dollars", async () => {
    const first = await bookUsage(r.db, A(), tokens(50, "credits"));
    expect(first.entry.currency).toBe("USD");
    expect(first.credits).toMatchObject({ enforced: true, exhausted: null, balance: { period: PERIOD, grantedMinor: FREE_INCLUDED, balanceMinor: FREE_INCLUDED - 50, spentMinor: 50, currency: "USD" } });
    const nextMonth = await bookUsage(r.db, A(), tokens(10, "credits", 2, 10));
    expect(nextMonth.credits?.balance).toMatchObject({ period: "2026-11", grantedMinor: FREE_INCLUDED, balanceMinor: FREE_INCLUDED - 10 });
    expect(await creditsState(r.db, await repos.businesses.get(r.db, A()), "2026-12")).toMatchObject({ currency: "USD", balanceMinor: FREE_INCLUDED, includedMinor: FREE_INCLUDED, exhausted: false });
  });

  it("the charge that uses the last credit pauses the team and posts one Inbox warning; on the free tier it asks for the founder's own key", async () => {
    await repos.agents.setStatus(r.db, A(), r.A.agentId, "healthy");
    await repos.agents.setStatus(r.db, A(), r.A.agent2Id, "idle");
    const notesBefore = (await repos.inbox.list(r.db, A(), { limit: 200 })).items.length;

    const partial = await bookUsage(r.db, A(), tokens(FREE_INCLUDED - 100, "credits"));
    expect(partial.credits).toMatchObject({ enforced: true, exhausted: null, pausedAgents: 0, noteId: null, balance: { balanceMinor: 50 } });
    expect((await repos.agents.get(r.db, A(), r.A.agentId)).status).toBe("healthy");

    const last = await bookUsage(r.db, A(), tokens(60, "credits"));
    expect(last.credits).toMatchObject({ enforced: true, exhausted: "now", balance: { balanceMinor: 0, spentMinor: FREE_INCLUDED + 10 } });
    expect(last.credits!.pausedAgents).toBeGreaterThanOrEqual(2);
    expect(last.credits!.noteId).not.toBeNull();
    expect((await repos.agents.get(r.db, A(), r.A.agentId)).status).toBe("paused");
    expect((await repos.agents.get(r.db, A(), r.A.agent2Id)).status).toBe("paused");
    const note = await repos.inbox.get(r.db, A(), last.credits!.noteId!);
    expect(note.type).toBe("warning");
    expect(note.subject).toBe(CREDITS_EXHAUSTED_SUBJECT);
    expect(note.bodyMd).toMatch(/own Anthropic key in Settings → Keys/);
    expect(note.bodyMd).toMatch(/\$5\.00/);
    expect(note.bodyMd).toMatch(/Estimate/);
    const audit = await repos.audit.list(r.db, A(), { action: "billing.credits_exhausted" });
    expect(audit.items).toHaveLength(1);
    expect(await creditsState(r.db, await repos.businesses.get(r.db, A()), PERIOD)).toMatchObject({ balanceMinor: 0, exhausted: true });

    // Overrun is recorded (the ledger is the truth) without a second pause or note.
    const over = await bookUsage(r.db, A(), tokens(7, "credits"));
    expect(over.credits).toMatchObject({ enforced: true, exhausted: "already", pausedAgents: 0, noteId: null, balance: { balanceMinor: 0, spentMinor: FREE_INCLUDED + 17 } });
    expect((await repos.inbox.list(r.db, A(), { limit: 200 })).items.length).toBe(notesBefore + 1);
    expect((await repos.audit.list(r.db, A(), { action: "billing.credits_exhausted" })).items).toHaveLength(1);
    // Business B's balance is its own.
    expect((await repos.usage.creditBalance(r.db, r.B.businessId, PERIOD))?.spentMinor).toBe(125);
  });

  it("on a paid tier the warning offers a top-up or the founder's own key", async () => {
    const B = r.B.businessId;
    await repos.businesses.update(r.db, B, { planTier: "pro" });
    const done = await bookUsage(r.db, B, { ...tokens(includedCreditsMinor("pro") + 1, "credits", 3, 11), agentId: r.B.agentId });
    expect(done.credits).toMatchObject({ exhausted: "now", balance: { period: "2026-12", balanceMinor: 0 } });
    expect((await repos.inbox.get(r.db, B, done.credits!.noteId!)).bodyMd).toMatch(/Top up in Settings → Billing, or bring your own Anthropic key/);
  });

  it("a business on its own key never touches credits, not even for rows the platform key paid for", async () => {
    const B = r.B.businessId;
    await repos.businesses.update(r.db, B, { modelBilling: "byok" });
    const platform = await bookUsage(r.db, B, { ...tokens(40, "credits"), agentId: r.B.agentId, occurredAt: new Date(Date.UTC(2027, 0, 3, 12)) });
    expect(platform.entry.billedTo).toBe("credits");
    expect(platform.credits).toBeNull();
    expect(await repos.usage.creditBalance(r.db, B, "2027-01")).toBeNull();
    expect(await creditsState(r.db, await repos.businesses.get(r.db, B), "2027-01")).toBeNull();
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
