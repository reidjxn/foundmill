/**
 * Credits and the business's own key (BUILD §10.2, §10.4, §10.5): `chargeCredits` settles a metered cost after the fact
 * and stops at zero; `bookUsage` records every row and charges the platform's USD costs of every business, which always
 * holds a balance (the tier's included credits are granted on the first charge of a month, one pool per founder), pauses
 * a team on credits and posts one Inbox warning on the charge that uses the last credit (a team on its own key keeps
 * working); the platform-key gate refuses a call once the month's credits are used up and never counts simulated
 * credits where calls are live; `loadByokApiKey` reads the row apps/api seals (and the pre-2026-10-10 shape) and nothing
 * for a revoked key.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { CreditsExhaustedError } from "@foundmill/shared";
import { buildAad, createVault, encryptJson, generateMasterKey } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertPlatformCredits, bookUsage, chargesCredits, checkPlatformCredits, creditsState, CREDITS_EXHAUSTED_SUBJECT, includedCreditsFor, PLATFORM_CREDITS_EXHAUSTED_SUBJECT, platformCredits } from "../billing";
import { BYOK_CREDENTIAL_KIND, LEGACY_BYOK_CREDENTIAL_KIND, loadByokApiKey } from "../byok";
import { resumeBusinessAgents, stopBusinessAgents } from "../controls";
import { settleCreditCheckout } from "../payments";
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

  it("a business on its own key pays for the platform key's calls with its credits: its team keeps working, and one note says what waits (SEC2 S2)", async () => {
    const B = r.B.businessId;
    // The test before used B's last credit (the team was stopped); the founder stores a key, which resumes it.
    await resumeBusinessAgents(r.db, B);
    await repos.businesses.update(r.db, B, { modelBilling: "byok" });
    const jan =(costMinor: number, billedTo: "byok" | "credits") => ({ ...tokens(costMinor, billedTo), agentId: r.B.agentId, occurredAt: new Date(Date.UTC(2027, 0, 3, 12)) });
    // Its agents' own calls run on its key: never charged.
    expect((await bookUsage(r.db, B, jan(40, "byok"))).credits).toBeNull();
    expect(await repos.usage.creditBalance(r.db, B, "2027-01")).toBeNull();
    // The api's and the composer's calls ran on the platform key: charged to the month's included credits.
    const platform = await bookUsage(r.db, B, jan(40, "credits"));
    expect(platform.entry.billedTo).toBe("credits");
    expect(platform.credits).toMatchObject({ enforced: true, exhausted: null, balance: { period: "2027-01", grantedMinor: includedCreditsMinor("pro"), balanceMinor: includedCreditsMinor("pro") - 40 } });
    const business = await repos.businesses.get(r.db, B);
    // The agents' budget is the founder's own key; the platform credits are still there to read.
    expect(await creditsState(r.db, business, "2027-01")).toBeNull();
    expect(await platformCredits(r.db, business, "2027-01")).toMatchObject({ currency: "USD", balanceMinor: includedCreditsMinor("pro") - 40, exhausted: false });

    await repos.agents.setStatus(r.db, B, r.B.agentId, "healthy");
    const last = await bookUsage(r.db, B, jan(includedCreditsMinor("pro"), "credits"));
    expect(last.credits).toMatchObject({ exhausted: "now", pausedAgents: 0, balance: { balanceMinor: 0 } });
    // Nothing is stopped: the agents run on the founder's key.
    expect(await repos.businesses.agentsStopped(r.db, B)).toBe(false);
    expect((await repos.agents.get(r.db, B, r.B.agentId)).status).toBe("healthy");
    const note = await repos.inbox.get(r.db, B, last.credits!.noteId!);
    expect(note.subject).toBe(PLATFORM_CREDITS_EXHAUSTED_SUBJECT);
    expect(note.blocksContinue).toBe(false);
    expect(note.bodyMd).toMatch(/agents run on your own Anthropic key and keep working/);
    expect(note.bodyMd).toMatch(/Feb 1, 2027/);
    expect(note.bodyMd).toMatch(/Estimate/);
    expect((await repos.audit.list(r.db, B, { action: "billing.credits_exhausted" })).items[0]?.details).toMatchObject({ teamStopped: false, modelBilling: "byok" });
    // And the next platform-key call is refused before it is made.
    await expect(assertPlatformCredits(r.db, B, { live: true, now: new Date(Date.UTC(2027, 0, 20)) })).rejects.toMatchObject({ code: "credits_exhausted", status: 402, details: { reason: "exhausted", period: "2027-01" } });
    const refused = await assertPlatformCredits(r.db, B, { live: true, now: new Date(Date.UTC(2027, 0, 20)) }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CreditsExhaustedError);
    expect((refused as Error).message).toMatch(/Your agents keep working on your own Anthropic key/);
    // Next month's credits open the door again.
    await expect(assertPlatformCredits(r.db, B, { live: true, now: new Date(Date.UTC(2027, 1, 2)) })).resolves.toMatchObject({ ok: true, period: "2027-02" });
  });
});

describe("included credits: one pool a month per founder (SEC2 S6)", () => {
  it("archiving a business and taking charge of another never grants a second included credit in the same month", async () => {
    const founder = await r.h.createUser("bill-pool@test.local");
    const open = async (name: string) => {
      const b = await repos.businesses.create(r.db, { name, createdBy: founder });
      await repos.memberships.add(r.db, b.id, { userId: founder, role: "owner" });
      return b;
    };
    const in2027 = (d: number, month: number) => new Date(Date.UTC(2027, month, d, 12));
    const charge = (businessId: string, costMinor: number, month: number) => bookUsage(r.db, businessId, { kind: "tokens", modelKey: "sonnet", quantity: 100, unit: "tokens", costMinor, billedTo: "credits", occurredAt: in2027(4, month) });

    const first = await open("Pool First");
    expect(await includedCreditsFor(r.db, first, "2027-05")).toBe(FREE_INCLUDED);
    expect((await charge(first.id, 10, 4)).credits?.balance).toMatchObject({ period: "2027-05", grantedMinor: FREE_INCLUDED });
    await repos.businesses.archive(r.db, first.id);

    // The free plan's included credits cover one business a month: a second business this month gets nothing included.
    const second = await open("Pool Second");
    expect(await includedCreditsFor(r.db, second, "2027-05")).toBe(0);
    expect(await platformCredits(r.db, second, "2027-05")).toMatchObject({ includedMinor: 0, balanceMinor: 0, exhausted: true });
    const empty = await charge(second.id, 1, 4);
    expect(empty.credits).toMatchObject({ exhausted: "now", balance: { grantedMinor: 0, balanceMinor: 0 } });
    expect(await repos.businesses.agentsStopped(r.db, second.id)).toBe(true);
    await expect(assertPlatformCredits(r.db, second.id, { live: false, now: in2027(20, 4) })).rejects.toMatchObject({ code: "credits_exhausted", details: { reason: "exhausted", period: "2027-05" } });

    // Next month the business that holds the place gets its credits (the archived one charges nothing).
    expect((await charge(second.id, 1, 5)).credits?.balance).toMatchObject({ period: "2027-06", grantedMinor: FREE_INCLUDED });
    expect(await includedCreditsFor(r.db, first, "2027-06")).toBe(0);
    // A month's stop for used-up credits does not hold the next month's calls back.
    await expect(assertPlatformCredits(r.db, second.id, { live: false, now: in2027(20, 5) })).resolves.toMatchObject({ ok: true });

    // On Scale every business gets its included credits.
    await repos.businesses.update(r.db, second.id, { planTier: "scale" });
    expect(await includedCreditsFor(r.db, { ...first, planTier: "scale" }, "2027-06")).toBe(includedCreditsMinor("scale"));
  });
});

describe("the platform-key gate (SEC2 S2, S10)", () => {
  it("refuses while the team is stopped for used-up credits this month, and counts no simulated credits where calls are live", async () => {
    const founder = await r.h.createUser("bill-gate@test.local");
    const business = await repos.businesses.create(r.db, { name: "Gate Business", createdBy: founder, planTier: "scale" });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    // Before any charge the tier's included credits stand.
    expect(await checkPlatformCredits(r.db, business.id, { live: true, now })).toMatchObject({ ok: true, reason: null, balanceMinor: includedCreditsMinor("scale") });
    // A stop for used-up credits this month refuses, even with a balance left; resuming lifts it.
    await stopBusinessAgents(r.db, business.id, { reason: "credits_exhausted" });
    expect(await checkPlatformCredits(r.db, business.id, { live: true, now })).toMatchObject({ ok: false, reason: "exhausted" });
    await resumeBusinessAgents(r.db, business.id);
    // Stop all agents is not about credits: the founder's own conversations still run.
    await stopBusinessAgents(r.db, business.id, { reason: "kill_switch" });
    expect((await checkPlatformCredits(r.db, business.id, { live: true, now })).ok).toBe(true);
    await resumeBusinessAgents(r.db, business.id);

    // Credits from a simulated payment only: they pay for mock calls, never for live ones.
    const gate = await repos.businesses.create(r.db, { name: "Gate Mock Only", createdBy: founder, planTier: "scale" });
    // The month opened with nothing included (the founder's pool was used): a top-up that opens a period would also grant the tier's included credits.
    await repos.usage.ensurePeriodCredits(r.db, gate.id, period, 0);
    const checkout = await repos.checkouts.create(r.db, gate.id, { mode: "mock", amountMinor: 2500 });
    const settled = await settleCreditCheckout(r.db, { businessId: gate.id, checkoutId: checkout.id, externalId: null, eventId: `mock:${checkout.id}`, amountMinor: 2500, currency: "USD", mode: "mock", paidAt: now, actor: { kind: "user", id: founder } });
    expect(settled.outcome).toBe("granted");
    expect(await repos.checkouts.mockGrantedMinor(r.db, gate.id, period)).toBe(2500);
    expect(await checkPlatformCredits(r.db, gate.id, { live: false, now })).toMatchObject({ ok: true, balanceMinor: 2500, spendableMinor: 2500 });
    expect(await checkPlatformCredits(r.db, gate.id, { live: true, now })).toMatchObject({ ok: false, reason: "mock_only", spendableMinor: 0 });
    await expect(assertPlatformCredits(r.db, gate.id, { live: true, now })).rejects.toThrow(/Only simulated credits are left this month, and they never pay for live model calls/);
    expect((await platformCredits(r.db, gate, period)).mockMinor).toBe(2500);
    // Real credits on top are spendable live; the simulated ones still are not.
    await repos.usage.grantCredits(r.db, gate.id, period, 700);
    expect(await checkPlatformCredits(r.db, gate.id, { live: true, now })).toMatchObject({ ok: true, balanceMinor: 3200, spendableMinor: 700 });
  });

  it("sessionTokens sums the USD token cost a session has booked so far", async () => {
    const A = r.A.businessId;
    const session = await repos.agents.createSession(r.db, A, { agentId: r.A.agentId });
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "tokens", quantity: 100, unit: "tokens", costMinor: 12, billedTo: "byok" });
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "tokens", quantity: 50, unit: "tokens", costMinor: 3, billedTo: "byok" });
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "sandbox", quantity: 5, unit: "minutes", costMinor: 0, billedTo: "byok" });
    expect(await repos.usage.sessionTokens(r.db, A, session.id)).toEqual({ costMinor: 15, quantity: 150 });
    expect(await repos.usage.sessionTokens(r.db, r.B.businessId, session.id)).toEqual({ costMinor: 0, quantity: 0 });
  });
});

describe("bookUsage, calls under half a cent", () => {
  it("a stream of 0.2-cent calls is charged to credits: the carry completes a cent on every fifth call", async () => {
    const B = r.B.businessId;
    await repos.businesses.update(r.db, B, { modelBilling: "credits" });
    const call = () => bookUsage(r.db, B, { agentId: r.B.agentId, kind: "tokens", modelKey: "haiku", quantity: 1150, costMicroMinor: 200_000, billedTo: "credits", occurredAt: new Date(Date.UTC(2027, 3, 5, 12)) });
    const spent: number[] = [];
    for (let i = 0; i < 10; i++) spent.push(Number((await call()).credits?.balance?.spentMinor));
    expect(spent).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 2]);
    expect((await repos.usage.totals(r.db, B, { from: new Date(Date.UTC(2027, 3, 1)), to: new Date(Date.UTC(2027, 4, 1)) })).costMinor).toBe(2);
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
