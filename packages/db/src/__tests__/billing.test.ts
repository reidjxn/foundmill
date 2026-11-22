/**
 * Credits and the business's own key (BUILD §10.2, §10.4, §10.5): `chargeCredits` settles a metered cost after the fact
 * and stops at zero; `bookUsage` records every row and charges the platform's USD costs of every business, which always
 * holds a balance (the tier's included credits are granted on the first charge of a month, one pool per founder), pauses
 * a team on credits and posts one Inbox warning on the charge that uses the last credit (a team on its own key keeps
 * working); the platform-key gate refuses a call once the month's credits are used up and never counts simulated
 * credits where calls are live; `loadByokApiKey` reads the row apps/api seals (and the pre-2026-10-10 shape) and nothing
 * for a revoked key.
 */
import { creditsAreLow, includedCreditsMinor, LOW_CREDITS_FLOOR_MINOR, LOW_CREDITS_SHARE, lowCreditsThresholdMinor } from "@foundmill/config";
import { CreditsExhaustedError } from "@foundmill/shared";
import { buildAad, createVault, encryptJson, generateMasterKey } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { agentWorkFunding, assertPlatformCredits, bookUsage as bookUsageAtCost, chargesCredits, fundingOfRow, checkPlatformCredits, creditsState, CREDITS_EXHAUSTED_SUBJECT, CREDITS_ZERO_STILL_WORKS, CREDITS_ZERO_STOPPED, restBeforeSession, restingNoteBody, RESTING_SUBJECT, waysToContinue, CREDITS_LOW_AUDIT_ACTION, CREDITS_LOW_SUBJECT, includedCreditsFor, monthlyBudgetMinor, PLATFORM_CREDITS_EXHAUSTED_SUBJECT, platformCredits } from "../billing";
import { BYOK_CREDENTIAL_KIND, LEGACY_BYOK_CREDENTIAL_KIND, loadByokApiKey } from "../byok";
import { resumeBusinessAgents, stopBusinessAgents } from "../controls";
import { settleCreditCheckout } from "../payments";
import { repos } from "../repos";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

/** These tests state amounts at cost: the charge's own mechanics, without the markup (its test is in billing-markup.test.ts). */
const bookUsage: typeof bookUsageAtCost = (db, businessId, input, options = {}) => bookUsageAtCost(db, businessId, input, { markup: 0, ...options });

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("bill");
});
afterAll(() => r?.close());

const h = (q: ReturnType<typeof sql>) => r.db.execute(q);
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
    // 50 cents is under the low line: the credit saver's one note, which pauses nothing.
    expect(partial.credits!.lowNoteId).not.toBeNull();
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
    // The Chief of Staff's note (WP-14 T1): the plan by its name, never "free"; the own key always offered; a top-up
    // and a change of plan only where they can be had (neither on this server, at this stage); the day the budget resets.
    expect(note.bodyMd).toMatch(/^We've used this month's team budget\./);
    expect(note.bodyMd).toMatch(/You can add your own Anthropic key in Settings › Keys \(billed by Anthropic, not by us\) or let us rest until Nov 1, 2026, when your budget resets\./);
    expect(note.bodyMd).toMatch(/You're on Try, which includes \$5\.00 of team budget a month/);
    expect(note.bodyMd).not.toMatch(/free plan|top up in|change plan|paused/i);
    expect(note.bodyMd).toMatch(/Estimate/);
    const audit = await repos.audit.list(r.db, A(), { action: "billing.credits_exhausted" });
    expect(audit.items).toHaveLength(1);
    expect(await creditsState(r.db, await repos.businesses.get(r.db, A()), PERIOD)).toMatchObject({ balanceMinor: 0, exhausted: true });

    // Overrun is recorded (the ledger is the truth) without a second pause or note.
    const over = await bookUsage(r.db, A(), tokens(7, "credits"));
    expect(over.credits).toMatchObject({ enforced: true, exhausted: "already", pausedAgents: 0, noteId: null, balance: { balanceMinor: 0, spentMinor: FREE_INCLUDED + 17 } });
    // Two notes in all: the low-credits note on the way down and the one pause note at zero.
    const notes = (await repos.inbox.list(r.db, A(), { limit: 200 })).items;
    expect(notes.length).toBe(notesBefore + 2);
    expect(notes.filter((n) => n.subject === CREDITS_EXHAUSTED_SUBJECT)).toHaveLength(1);
    expect((await repos.audit.list(r.db, A(), { action: "billing.credits_exhausted" })).items).toHaveLength(1);
    // Business B's balance is its own.
    expect((await repos.usage.creditBalance(r.db, r.B.businessId, PERIOD))?.spentMinor).toBe(125);
  });

  it("where a top-up can be bought the note names it first, and a change of plan once plans are on sale; the own key is offered either way", async () => {
    const nextOn = new Date(Date.UTC(2026, 11, 1));
    expect(waysToContinue({ topUps: false, nextCreditsOn: nextOn, voice: "rest" })).toBe("You can add your own Anthropic key in Settings › Keys (billed by Anthropic, not by us) or let us rest until Dec 1, 2026, when your budget resets.");
    expect(waysToContinue({ nextCreditsOn: nextOn, topUps: true, plans: true, voice: "rest" })).toBe("You can top up in Settings › Billing, change plan, add your own Anthropic key in Settings › Keys (billed by Anthropic, not by us), or let us rest until Dec 1, 2026, when your budget resets.");
    const body = restingNoteBody({ planTier: "pro", finished: ["Draft the landing page", "Research three suppliers"], next: ["Write the first post"], leftMinor: 16, nextOn, topUps: true });
    expect(body).toMatch(/^We've used this month's team budget\. Here's what we finished, and here's what we'd do next\. You can top up in Settings › Billing, add your own Anthropic key/);
    expect(body).toContain("**Finished this month**\n- Draft the landing page\n- Research three suppliers");
    expect(body).toContain("**What we'd do next**\n- Write the first post");
    expect(body).toContain("You're on Founder, which includes $10.00 of team budget a month.");
    expect(body).toContain("$0.16 is left: too little to finish another task, so it stays in your balance.");
    // With nothing on record the note claims no list.
    expect(restingNoteBody({ planTier: "free", finished: [], next: [], leftMinor: 0, nextOn })).not.toMatch(/Here's what we finished|Finished this month|is left/);
  });

  it("the note lists what was finished this month and what comes next from the task records, and a service that sells top-ups names one", async () => {
    const B = r.B.businessId;
    await repos.businesses.update(r.db, B, { planTier: "pro" });
    const finished = await repos.tasks.create(r.db, B, { kind: "ops", title: "Write the welcome email", status: "ready" });
    await h(sql`update tasks set status = 'done', ended_at = '2026-12-02T10:00:00Z' where id = ${finished.id}`);
    const earlier = await repos.tasks.create(r.db, B, { kind: "ops", title: "Something from last month", status: "ready" });
    await h(sql`update tasks set status = 'done', ended_at = '2026-11-20T10:00:00Z' where id = ${earlier.id}`);
    await repos.tasks.create(r.db, B, { kind: "ops", title: "Publish the page", status: "ready" });
    {
      const done = await bookUsage(r.db, B, { ...tokens(includedCreditsMinor("pro") + 1, "credits", 3, 11), agentId: r.B.agentId }, { topUps: true });
      expect(done.credits).toMatchObject({ exhausted: "now", balance: { period: "2026-12", balanceMinor: 0 } });
      const body = (await repos.inbox.get(r.db, B, done.credits!.noteId!)).bodyMd;
      expect(body).toMatch(/You can top up in Settings › Billing, add your own Anthropic key in Settings › Keys \(billed by Anthropic, not by us\), or let us rest until Jan 1, 2027, when your budget resets\./);
      expect(body).toContain("- Write the welcome email");
      expect(body).toContain("- Publish the page");
      expect(body).not.toContain("Something from last month");
      expect(body).toContain("You're on Founder");
    }
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
  it("one included budget a month per owner, shared by all their projects: archiving and taking charge again never yields a second one (founder, Nov 19, 2026)", async () => {
    const founder = await r.h.createUser("bill-pool@test.local");
    const open = async (name: string) => {
      const b = await repos.businesses.create(r.db, { name, createdBy: founder });
      await repos.memberships.add(r.db, b.id, { userId: founder, role: "owner" });
      return b;
    };
    const in2027 = (d: number, month: number) => new Date(Date.UTC(2027, month, d, 12));
    const charge = (businessId: string, costMinor: number, month: number) => bookUsage(r.db, businessId, { kind: "tokens", modelKey: "sonnet", quantity: 100, unit: "tokens", costMinor, billedTo: "credits", occurredAt: in2027(4, month) });

    const first = await open("Pool First");
    // A project with a recorded owner opens its own balance with nothing included: the budget is the owner's.
    expect(await includedCreditsFor(r.db, first, "2027-05")).toBe(0);
    expect(await monthlyBudgetMinor(r.db, first)).toBe(FREE_INCLUDED);
    expect(await platformCredits(r.db, first, "2027-05")).toMatchObject({ includedMinor: FREE_INCLUDED, balanceMinor: FREE_INCLUDED, exhausted: false });
    expect((await charge(first.id, 10, 4)).credits?.balance).toMatchObject({ period: "2027-05", balanceMinor: FREE_INCLUDED - 10, grantedMinor: FREE_INCLUDED });
    await repos.businesses.archive(r.db, first.id);

    // A second project this month shares what is left: it does not start with a second budget, nor with nothing.
    const second = await open("Pool Second");
    expect(await platformCredits(r.db, second, "2027-05")).toMatchObject({ balanceMinor: FREE_INCLUDED - 10, exhausted: false });
    const used = await charge(second.id, FREE_INCLUDED - 10, 4);
    expect(used.credits).toMatchObject({ exhausted: "now", balance: { balanceMinor: 0 } });
    expect(await repos.businesses.agentsStopped(r.db, second.id)).toBe(true);
    expect(await repos.usage.ownerCredits(r.db, founder, "2027-05")).toMatchObject({ grantedMinor: FREE_INCLUDED, balanceMinor: 0, spentMinor: FREE_INCLUDED });
    await expect(assertPlatformCredits(r.db, second.id, { live: false, now: in2027(20, 4) })).rejects.toMatchObject({ code: "credits_exhausted", details: { reason: "exhausted", period: "2027-05" } });

    // A third project sees the same empty budget (it is shared) and is refused too.
    const third = await open("Pool Third");
    expect(await platformCredits(r.db, third, "2027-05")).toMatchObject({ balanceMinor: 0, exhausted: true });
    await expect(assertPlatformCredits(r.db, third.id, { live: false, now: in2027(20, 4) })).rejects.toMatchObject({ code: "credits_exhausted" });

    // What a project bought is its own: with the shared budget gone, it alone keeps working on its top-up.
    await repos.usage.grantCredits(r.db, second.id, "2027-05", 200);
    expect(await platformCredits(r.db, second, "2027-05")).toMatchObject({ balanceMinor: 200, exhausted: false });
    expect((await charge(second.id, 50, 4)).credits?.balance).toMatchObject({ balanceMinor: 150 });
    expect(await platformCredits(r.db, third, "2027-05")).toMatchObject({ balanceMinor: 0, exhausted: true });

    // Next month the owner has a new budget, whichever project charges first; a month's stop does not hold it back.
    expect((await charge(second.id, 1, 5)).credits?.balance).toMatchObject({ period: "2027-06", grantedMinor: FREE_INCLUDED, balanceMinor: FREE_INCLUDED - 1 });
    await expect(assertPlatformCredits(r.db, second.id, { live: false, now: in2027(20, 5) })).resolves.toMatchObject({ ok: true });

    // The budget is the owner's plan's: Studio includes more.
    await repos.businesses.update(r.db, second.id, { planTier: "scale" });
    expect(await monthlyBudgetMinor(r.db, second)).toBe(includedCreditsMinor("scale"));
  });

  it("two projects of one owner charging at once never spend the shared budget twice", async () => {
    const founder = await r.h.createUser("bill-race@test.local");
    const open = async (name: string) => {
      const b = await repos.businesses.create(r.db, { name, createdBy: founder });
      await repos.memberships.add(r.db, b.id, { userId: founder, role: "owner" });
      return b;
    };
    const a = await open("Race A");
    const b = await open("Race B");
    const each = Math.floor(FREE_INCLUDED / 2);
    const charge = (businessId: string) => bookUsage(r.db, businessId, { kind: "tokens", modelKey: "sonnet", quantity: 100, unit: "tokens", costMinor: each, billedTo: "credits", occurredAt: new Date(Date.UTC(2027, 7, 4, 12)) });
    await Promise.all([charge(a.id), charge(b.id), charge(a.id), charge(b.id)]);
    // Four charges of half the budget: the budget stops at zero and records what the projects drew, never more than it held.
    expect(await repos.usage.ownerCredits(r.db, founder, "2027-08")).toMatchObject({ grantedMinor: FREE_INCLUDED, balanceMinor: 0, spentMinor: FREE_INCLUDED });
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
    // The owner's shared budget for the month is used up, so only the simulated top-up is left.
    await h(sql`insert into owner_credits (user_id, period, granted_minor, balance_minor, spent_minor) values (${founder}, ${period}, ${includedCreditsMinor("scale")}, 0, ${includedCreditsMinor("scale")}) on conflict (user_id, period) do update set balance_minor = 0`);
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

  it("sessionTokens sums the USD token cost a session has booked so far, its own rows only", async () => {
    const A = r.A.businessId;
    const session = await repos.agents.createSession(r.db, A, { agentId: r.A.agentId });
    const sdk = { source: "claude-agent-sdk", label: "Estimate" };
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "tokens", quantity: 100, unit: "tokens", costMinor: 12, billedTo: "byok", details: sdk });
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "tokens", quantity: 50, unit: "tokens", costMinor: 3, billedTo: "byok", details: sdk });
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "sandbox", quantity: 5, unit: "minutes", costMinor: 0, billedTo: "byok" });
    // The gateway's reader booked under the session id is not the session's own spend (WP-09 T3).
    await bookUsage(r.db, A, { agentId: r.A.agentId, sessionId: session.id, kind: "tokens", quantity: 6_000, unit: "tokens", costMinor: 1, billedTo: "byok", details: { service: "gateway", route: "quarantinedReader" } });
    expect(await repos.usage.sessionTokens(r.db, A, session.id)).toEqual({ costMinor: 15, quantity: 150 });
    expect(await repos.usage.sessionTokens(r.db, r.B.businessId, session.id)).toEqual({ costMinor: 0, quantity: 0 });
  });
});

describe("low credits (the credit saver)", () => {
  const LINE = lowCreditsThresholdMinor(FREE_INCLUDED);
  const charge = (businessId: string, costMinor: number, at: Date) => bookUsage(r.db, businessId, { kind: "tokens", modelKey: "sonnet", quantity: 100, unit: "tokens", costMinor, billedTo: "credits", occurredAt: at });

  it("the line is the larger of 20% of the month's included credits and a $1 floor", () => {
    expect(LOW_CREDITS_SHARE).toBe(0.2);
    expect(LOW_CREDITS_FLOOR_MINOR).toBe(100);
    expect(lowCreditsThresholdMinor(500)).toBe(100);
    expect(lowCreditsThresholdMinor(5_000)).toBe(1_000);
    expect(lowCreditsThresholdMinor(0)).toBe(100);
    expect(creditsAreLow(99, 500)).toBe(true);
    expect(creditsAreLow(100, 500)).toBe(false);
    // Zero is the pause, not the saver.
    expect(creditsAreLow(0, 500)).toBe(false);
  });

  it("the gate says low below the line and not above it; never when the call is refused", async () => {
    const founder = await r.h.createUser("bill-low-gate@test.local");
    const business = await repos.businesses.create(r.db, { name: "Low Gate", createdBy: founder });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    const now = new Date(Date.UTC(2027, 7, 10, 12));
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now })).toMatchObject({ ok: true, low: false, balanceMinor: FREE_INCLUDED });
    await charge(business.id, FREE_INCLUDED - LINE, now);
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now })).toMatchObject({ ok: true, low: false, balanceMinor: LINE });
    await charge(business.id, 1, now);
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now })).toMatchObject({ ok: true, low: true, balanceMinor: LINE - 1 });
    // A top-up above the line lifts the saver by itself.
    await repos.usage.grantCredits(r.db, business.id, "2027-08", 500);
    expect((await checkPlatformCredits(r.db, business.id, { live: false, now })).low).toBe(false);
    // At zero the call is refused (the pause), and `low` is false.
    await charge(business.id, 10_000, now);
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now })).toMatchObject({ ok: false, reason: "exhausted", low: false });
  });

  it("posts one plain note a month the first time the balance falls below the line, says what changed and how to avoid it, and pauses nothing", async () => {
    const founder = await r.h.createUser("bill-low-note@test.local");
    const business = await repos.businesses.create(r.db, { name: "Low Note", createdBy: founder, planTier: "pro" });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    const chief = await repos.agents.create(r.db, business.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" });
    const sept = (d: number) => new Date(Date.UTC(2027, 8, d, 12));
    const lowNotes = async () => (await repos.inbox.list(r.db, business.id, { limit: 200 })).items.filter((n) => n.subject === CREDITS_LOW_SUBJECT);

    // Above the line (a fifth of Founder's $10.00): nothing.
    expect((await charge(business.id, includedCreditsMinor("pro") - 200, sept(2))).credits?.lowNoteId).toBeNull();
    expect(await lowNotes()).toHaveLength(0);
    // The first charge below it: one note from the Chief of Staff.
    const first = await charge(business.id, 150, sept(3));
    expect(first.credits).toMatchObject({ exhausted: null, pausedAgents: 0, noteId: null, balance: { balanceMinor: 50 } });
    const notes = await lowNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(first.credits!.lowNoteId);
    expect(notes[0]).toMatchObject({ type: "warning", fromAgentId: chief.id, blocksContinue: false });
    expect(notes[0]!.bodyMd).toMatch(/down to \$0\.50 \(an Estimate in US dollars\)/);
    expect(notes[0]!.bodyMd).toMatch(/routine work now runs on a lighter, lower-cost model/);
    expect(notes[0]!.bodyMd).toMatch(/Replies to you, plans, the Chief of Staff, anything that goes outside the business, and money and legal work keep their usual model/);
    // No top-up can be bought on this server, so none is named; the own key always is.
    expect(notes[0]!.bodyMd).toMatch(/To keep everything on its usual model, add your own Anthropic key in Settings → Keys/);
    expect(notes[0]!.bodyMd).toMatch(/the team finishes the task it is on and rests until you add your key/);
    expect(notes[0]!.bodyMd).toMatch(/Oct 1, 2027/);
    expect(await repos.businesses.agentsStopped(r.db, business.id)).toBe(false);
    // Later charges below the line, and a top-up and a second fall, tell nothing new this month.
    expect((await charge(business.id, 10, sept(4))).credits?.lowNoteId).toBeNull();
    await repos.usage.grantCredits(r.db, business.id, "2027-09", 500);
    expect((await charge(business.id, 500, sept(5))).credits?.lowNoteId).toBeNull();
    expect(await lowNotes()).toHaveLength(1);
    expect((await repos.audit.list(r.db, business.id, { action: CREDITS_LOW_AUDIT_ACTION })).items).toHaveLength(1);
    // Next month tells again.
    const october = await charge(business.id, includedCreditsMinor("pro") - 20, new Date(Date.UTC(2027, 9, 2, 12)));
    expect(october.credits?.lowNoteId).not.toBeNull();
    expect(await lowNotes()).toHaveLength(2);
  });

  it("on the free plan the way to avoid it is the founder's own key; on its own key the agents are not affected", async () => {
    const founder = await r.h.createUser("bill-low-free@test.local");
    const free = await repos.businesses.create(r.db, { name: "Low Free", createdBy: founder });
    await repos.memberships.add(r.db, free.id, { userId: founder, role: "owner" });
    await repos.agents.create(r.db, free.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" });
    const id = (await charge(free.id, FREE_INCLUDED - 40, new Date(Date.UTC(2027, 10, 3, 12)))).credits!.lowNoteId!;
    const body = (await repos.inbox.get(r.db, free.id, id)).bodyMd;
    expect(body).toMatch(/add your own Anthropic key in Settings → Keys \(Anthropic bills your key, not us\)/);
    expect(body).not.toMatch(/top up/i);

    const founder2 = await r.h.createUser("bill-low-byok@test.local");
    const own = await repos.businesses.create(r.db, { name: "Low Own Key", createdBy: founder2, modelBilling: "byok" });
    await repos.memberships.add(r.db, own.id, { userId: founder2, role: "owner" });
    await repos.agents.create(r.db, own.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" });
    const ownId = (await charge(own.id, FREE_INCLUDED - 40, new Date(Date.UTC(2027, 10, 3, 12)))).credits!.lowNoteId!;
    expect((await repos.inbox.get(r.db, own.id, ownId)).bodyMd).toMatch(/Your agents run on your own Anthropic key, so they are not affected/);
  });

  it("the pause at zero is unchanged, and its note gives every way back", async () => {
    const founder = await r.h.createUser("bill-low-zero@test.local");
    const business = await repos.businesses.create(r.db, { name: "Low Zero", createdBy: founder, planTier: "pro" });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    await repos.agents.create(r.db, business.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" });
    const done = await charge(business.id, includedCreditsMinor("pro") + 5, new Date(Date.UTC(2027, 11, 3, 12)));
    expect(done.credits).toMatchObject({ exhausted: "now", balance: { balanceMinor: 0 } });
    expect(await repos.businesses.agentsStopped(r.db, business.id)).toBe(true);
    const note = await repos.inbox.get(r.db, business.id, done.credits!.noteId!);
    expect(note).toMatchObject({ subject: CREDITS_EXHAUSTED_SUBJECT, blocksContinue: true });
    expect(note.bodyMd).toMatch(/add your own Anthropic key in Settings › Keys \(billed by Anthropic, not by us\) or let us rest until Jan 1, 2028, when your budget resets/);
    expect(note.bodyMd).toMatch(/on Jan 1, 2028, press Resume agents/);
    await expect(assertPlatformCredits(r.db, business.id, { live: false, now: new Date(Date.UTC(2027, 11, 20)) })).rejects.toMatchObject({ code: "credits_exhausted" });
  });
});

describe("who funds the work (0104)", () => {
  const ON = { enabled: true, providers: ["openai"] } as const;
  const sept = new Date(Date.UTC(2028, 8, 4, 12));
  const row = (billedTo: "byok" | "credits") => ({ kind: "tokens" as const, modelKey: "sonnet" as const, quantity: 100, unit: "tokens", costMinor: 30, billedTo, occurredAt: sept, details: { label: "Estimate" } });

  it("every model row records which source paid: the month's credits, or the founder's own Anthropic key", async () => {
    const A = r.A.businessId;
    const credits = await bookUsage(r.db, A, row("credits"));
    expect(credits.entry.details).toMatchObject({ label: "Estimate", funding: { source: "foundmill_credits" } });
    expect(credits.credits).not.toBeNull();
    const own = await bookUsage(r.db, A, row("byok"));
    expect(own.entry.details).toMatchObject({ funding: { source: "own_api_key", provider: "anthropic" } });
    expect(fundingOfRow(own.entry)).toBe("own_api_key");
    // A tool row is the vendor's bill to the founder's own account: no model funding is recorded on it.
    const tool = await bookUsage(r.db, A, { kind: "tool", quantity: 1, unit: "calls", costMinor: 0, currency: "USD", billedTo: "credits", occurredAt: sept });
    expect((tool.entry.details as { funding?: unknown }).funding).toBeUndefined();
  });

  it("a claim that the founder's own plan paid is checked against the business: with the flag off it is charged like any other row (finding 4)", async () => {
    const A = r.A.businessId;
    const before = (await platformCredits(r.db, await repos.businesses.get(r.db, A), "2028-09")).balanceMinor;
    // Business A is not on its own plan, and the flag is off: the claim is not believed.
    const claimed = await bookUsage(r.db, A, { ...row("credits"), funding: { source: "own_plan", provider: "openai" } });
    expect(claimed.entry.details).toMatchObject({ funding: { source: "foundmill_credits" } });
    expect(claimed.credits).not.toBeNull();
    expect((await platformCredits(r.db, await repos.businesses.get(r.db, A), "2028-09")).balanceMinor).toBe(before - 30);
    // A row that says own_plan in its details (written by anything) is still charged while the flag is off.
    const forged = { billedTo: "credits" as const, kind: "tokens" as const, currency: "USD", details: { funding: { source: "own_plan", provider: "openai" } } };
    expect(chargesCredits(forged)).toBe(true);
    expect(chargesCredits(forged, { enabled: true, providers: ["openai"] })).toBe(false);
    expect(chargesCredits({ ...forged, details: { funding: { source: "own_plan", provider: "other" } } }, { enabled: true, providers: ["openai"] })).toBe(true);
  });

  it("a business really on its plan, with the flag on, records the plan and is not charged; a different provider is", async () => {
    const founder = await r.h.createUser("bill-own-plan-row@test.local");
    const business = await repos.businesses.create(r.db, { name: "Own Plan Row", createdBy: founder });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    await repos.businesses.setOwnPlan(r.db, business.id, "openai", ON);
    const plan = await bookUsage(r.db, business.id, { ...row("credits"), funding: { source: "own_plan", provider: "openai" } }, { ownPlan: ON });
    expect(plan.entry.details).toMatchObject({ funding: { source: "own_plan", provider: "openai" } });
    expect(plan.credits).toBeNull();
    const other = await bookUsage(r.db, business.id, { ...row("credits"), funding: { source: "own_plan", provider: "gemini" } }, { ownPlan: ON });
    expect(other.entry.details).toMatchObject({ funding: { source: "foundmill_credits" } });
    expect(other.credits).not.toBeNull();
    // The same claim with the flag off is charged.
    expect((await bookUsage(r.db, business.id, { ...row("credits"), funding: { source: "own_plan", provider: "openai" } })).credits).not.toBeNull();
  });

  it("with the flag off a business on its own plan is still gated by credits; with it on for an integrated provider the gate skips them", async () => {
    const founder = await r.h.createUser("bill-own-plan@test.local");
    const business = await repos.businesses.create(r.db, { name: "Own Plan", createdBy: founder });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    expect(agentWorkFunding(business)).toEqual({ source: "foundmill_credits" });
    // Today nothing can put a business on its own plan.
    await expect(repos.businesses.setOwnPlan(r.db, business.id, "openai")).rejects.toThrow(/cannot run on the founder's own plan/);
    const onPlan = await repos.businesses.setOwnPlan(r.db, business.id, "openai", ON);
    expect(onPlan).toMatchObject({ fundingSource: "own_plan", fundingPlanProvider: "openai" });
    // The flag is off in the product: its work is still funded by credits, and an empty month refuses the call.
    expect(agentWorkFunding(onPlan)).toEqual({ source: "foundmill_credits" });
    await bookUsage(r.db, business.id, { ...row("credits"), costMinor: 10_000 });
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now: sept })).toMatchObject({ ok: false, reason: "exhausted", fundedBy: "foundmill_credits" });
    // With the flag on and the provider integrated, a call routed to the plan skips Foundmill's credits.
    expect(agentWorkFunding(onPlan, ON)).toEqual({ source: "own_plan", provider: "openai" });
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now: sept, ownPlan: ON, routedTo: "openai" })).toMatchObject({ ok: true, reason: null, low: false, fundedBy: "own_plan" });
    // A call on the platform key keeps the zero check even then (finding 3): the plan pays nothing on Foundmill's key.
    expect(await checkPlatformCredits(r.db, business.id, { live: false, now: sept, ownPlan: ON })).toMatchObject({ ok: false, reason: "exhausted", fundedBy: "foundmill_credits" });
    await expect(assertPlatformCredits(r.db, business.id, { live: false, now: sept, ownPlan: ON })).rejects.toMatchObject({ code: "credits_exhausted" });
    // A call routed to another provider is not the plan's.
    expect((await checkPlatformCredits(r.db, business.id, { live: false, now: sept, ownPlan: ON, routedTo: "anthropic" })).ok).toBe(false);
    // A provider that is not integrated does not count, flag or no flag.
    expect(agentWorkFunding(onPlan, { enabled: true, providers: [] })).toEqual({ source: "foundmill_credits" });
  });

  it("a business on its plan stopped for credits, with a balance left, still has its platform-key calls refused (finding 3)", async () => {
    const founder = await r.h.createUser("bill-own-plan-stop@test.local");
    const business = await repos.businesses.create(r.db, { name: "Own Plan Stop", createdBy: founder });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    await repos.businesses.setOwnPlan(r.db, business.id, "openai", ON);
    const now = new Date();
    await stopBusinessAgents(r.db, business.id, { reason: "credits_exhausted" });
    try {
      expect(await checkPlatformCredits(r.db, business.id, { live: false, now, ownPlan: ON })).toMatchObject({ ok: false, reason: "exhausted" });
      expect((await checkPlatformCredits(r.db, business.id, { live: false, now, ownPlan: ON, routedTo: "openai" })).ok).toBe(true);
    } finally {
      await resumeBusinessAgents(r.db, business.id);
    }
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

describe("waysToContinue (WP-09 T13)", () => {
  const on = new Date(Date.UTC(2026, 11, 1));
  it("names credits only where they can be bought, the own key unless the business has one, and always the date", () => {
    expect(waysToContinue({ topUps: true, nextCreditsOn: on })).toBe("To keep going, add credits in Settings › Billing, add your own Anthropic key in Settings › Keys (billed by Anthropic, not by us), or wait for next month's credits on Dec 1, 2026.");
    expect(waysToContinue({ topUps: false, nextCreditsOn: on })).toBe("To keep going, add your own Anthropic key in Settings › Keys (billed by Anthropic, not by us) or wait for next month's credits on Dec 1, 2026.");
    expect(waysToContinue({ topUps: true, nextCreditsOn: on, ownKey: true })).toBe("To keep going, add credits in Settings › Billing or wait for next month's credits on Dec 1, 2026.");
    expect(waysToContinue({ topUps: false, nextCreditsOn: on, ownKey: true })).toBe("To keep going, wait for next month's credits on Dec 1, 2026.");

  });
});

describe("resting before a session that would not fit (WP-14 T1)", () => {
  it("rests the team once, books nothing, keeps what is left, and says so in one note; a second call and a team on its own key change nothing", async () => {
    const founder = await r.h.createUser("bill-rest@test.local");
    const business = await repos.businesses.create(r.db, { name: "Rest Early", createdBy: founder });
    await repos.memberships.add(r.db, business.id, { userId: founder, role: "owner" });
    await repos.agents.create(r.db, business.id, { name: "Chief", agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" });
    // The stop is stamped with the real clock, so this test runs in the real month.
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const nextOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    // 9 cents left of the month: under a 10-cent reserve.
    await bookUsage(r.db, business.id, { kind: "tokens", modelKey: "haiku", quantity: 100, unit: "tokens", costMinor: FREE_INCLUDED - 9, billedTo: "credits", occurredAt: now });
    const rows = async () => Number(((await h(sql`select count(*)::int as n from usage_ledger where business_id = ${business.id}`)) as unknown as { rows: { n: number }[] }).rows[0]!.n);
    const before = await rows();
    const rested = await restBeforeSession(r.db, business.id, { reserveMinor: 10, now });
    expect(rested).toMatchObject({ rested: true, noteId: expect.any(String) });
    expect(await rows()).toBe(before);
    expect(await repos.usage.ownerCredits(r.db, founder, month)).toMatchObject({ balanceMinor: 9 });
    expect(await repos.businesses.stopState(r.db, business.id)).toMatchObject({ stopped: true, reason: "credits_exhausted" });
    const note = await repos.inbox.get(r.db, business.id, rested.noteId!);
    expect(note).toMatchObject({ subject: RESTING_SUBJECT, blocksContinue: true });
    expect(note.bodyMd).toContain("$0.09 is left: too little to finish another task, so it stays in your balance.");
    expect(note.bodyMd).toContain(`let us rest until ${nextOn}, when your budget resets`);
    // Resting already: no second note, no second audit row.
    expect(await restBeforeSession(r.db, business.id, { reserveMinor: 10, now })).toEqual({ rested: true, noteId: null });
    expect((await repos.inbox.list(r.db, business.id, { limit: 50 })).items.filter((n) => n.subject === RESTING_SUBJECT)).toHaveLength(1);
    expect((await repos.audit.list(r.db, business.id, { action: "billing.credits_exhausted" })).items).toHaveLength(1);
    expect((await repos.audit.list(r.db, business.id, { action: "billing.credits_exhausted" })).items[0]!.details).toMatchObject({ resting: true, leftMinor: 9, reserveMinor: 10 });
    // The platform-key gate says Resting, with the day, and offers the key.
    const refused = await assertPlatformCredits(r.db, business.id, { live: false, now }).catch((e: unknown) => e);
    expect((refused as Error).message).toMatch(/^The team is resting: this month's team budget is used.*add your own Anthropic key.*next month's credits on [A-Z][a-z]{2} 1, \d{4}\.$/);
    expect((refused as Error).message).toContain(`next month's credits on ${nextOn}`);
    // A business on its own key never rests this way.
    const own = await repos.businesses.create(r.db, { name: "Rest Own Key", createdBy: await r.h.createUser("bill-rest-own@test.local"), modelBilling: "byok" });
    expect(await restBeforeSession(r.db, own.id, { reserveMinor: 10, now })).toEqual({ rested: false, noteId: null });
    expect(await repos.businesses.agentsStopped(r.db, own.id)).toBe(false);
  });

  it("the reserve's average is taken over the type's own finished, costed sessions in this business", async () => {
    const business = await repos.businesses.create(r.db, { name: "Reserve Avg", createdBy: await r.h.createUser("bill-avg@test.local") });
    const worker = await repos.agents.create(r.db, business.id, { name: "Dev", agentType: "engineer", layer: "worker", modelKey: "sonnet" });
    const other = await repos.agents.create(r.db, business.id, { name: "Writer", agentType: "copywriter", layer: "worker", modelKey: "sonnet" });
    expect(await repos.agents.recentSessionCost(r.db, business.id, "engineer", 20)).toEqual({ averageMinor: null, sessions: 0 });
    const session = async (agentId: string, costMinor: number, ended: boolean) => {
      const s = await repos.agents.createSession(r.db, business.id, { agentId });
      await h(sql`update agent_sessions set cost_minor = ${costMinor}, ended_at = ${ended ? sql`now()` : sql`null`} where id = ${s.id}`);
    };
    await session(worker.id, 10, true);
    await session(worker.id, 20, true);
    await session(worker.id, 0, true);
    await session(worker.id, 500, false);
    await session(other.id, 900, true);
    expect(await repos.agents.recentSessionCost(r.db, business.id, "engineer", 20)).toEqual({ averageMinor: 15, sessions: 2 });
    expect(await repos.agents.recentSessionCost(r.db, r.A.businessId, "engineer", 20)).toMatchObject({ sessions: expect.any(Number) });
  });
});
