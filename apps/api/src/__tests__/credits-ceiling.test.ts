/**
 * The credits ceiling on the API's own platform-key calls (BUILD §10.4, §10.5; DECISIONS 2026-10-12): once a business
 * has used up this month's credits, a call made for it (a conversation reply, a plan compile, the in-process composer)
 * is refused before it is sent, with the way back. Nothing is booked for a refused call; a call with no business and a
 * business with credits left are never refused. A business on its own key pays for these platform-key calls with its
 * credits too (SEC2 S2), so it is refused alike, and told its agents keep working on its key.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { assertPlatformCredits, CREDITS_ZERO_STILL_WORKS, CREDITS_ZERO_STOPPED, periodOf, repos } from "@foundmill/db";
import { PlanOutput } from "@foundmill/models";
import { CreditsExhaustedError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLog } from "../services/log";
import { createApiModelClient } from "../services/models";
import { createApiHarness, spendAllCredits, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ceiling" });
}, 120_000);
afterAll(() => hz.close());

const period = () => periodOf(new Date());
const ledger = async (businessId: string) => (await repos.usage.list(hz.db, businessId, { limit: 500 })).items.length;
const ask = { route: "planCompiler" as const, schema: PlanOutput, messages: [{ role: "user" as const, content: "```json\n" + JSON.stringify({ reply: "Pause the ads until Monday", agents: [], action_types: [] }) + "\n```" }] };
/** Uses up this month's credits of a business on credits: the owner's shared budget first, then its own balance. */
const useUp = (businessId: string) => spendAllCredits(hz.db, businessId, period());

describe("the API's platform-key calls stop when the credits do", () => {
  it("a business with credits left runs; once they are used up the call is refused before it is sent, and nothing is booked", async () => {
    const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db });
    const A = hz.A.businessId;
    await models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } });
    await expect(assertPlatformCredits(hz.db, A, { live: false })).resolves.toMatchObject({ ok: true });

    await useUp(A);
    const before = await ledger(A);
    const refused = await models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CreditsExhaustedError);
    expect(refused).toMatchObject({ code: "credits_exhausted", status: 402, details: { reason: "exhausted", businessId: A, period: period(), balanceMinor: 0 } });
    // This harness sells no credits (topUps off), so the sentence names the own key and the date, never a top-up (WP-09 T13).
    expect((refused as Error).message).toMatch(/^The team is resting: this month's team budget is used.*add your own Anthropic key in Settings › Keys/);
    expect((refused as Error).message).toMatch(/wait for next month's credits on [A-Z][a-z]{2} 1, \d{4}/);
    expect((refused as Error).message).not.toMatch(/Top up|add credits/i);
    expect(await ledger(A)).toBe(before);

    // Account-level calls (no business yet) are not the business's to pay for.
    await expect(models.complete({ ...ask, attribution: { kind: "ideation" } })).resolves.toBeDefined();

    // A top-up puts the business back on credits it can spend.
    await repos.usage.grantCredits(hz.db, A, period(), 200);
    await expect(models.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } })).resolves.toBeDefined();
  });

  it("a conversation at an agent's desk is refused with PAYMENT_REQUIRED and the way back", async () => {
    const A = hz.A.businessId;
    await useUp(A);
    hz.limits.reset();
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.agent.conversation.send({ businessId: A, subject: { kind: "agent", id: hz.A.agentId }, text: "Is the supplier invoice due?" })).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: expect.stringMatching(/The team is resting/),
      cause: { code: "credits_exhausted" },
    });
  });

  it("a business on its own key is refused alike, and told its agents keep working", async () => {
    const B = hz.B.businessId;
    await useUp(B);
    await repos.businesses.update(hz.db, B, { modelBilling: "byok" });
    try {
      await expect(assertPlatformCredits(hz.db, B, { live: false })).rejects.toThrow(/Your agents keep working on your own Anthropic key/);
      const models = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db });
      await expect(models.complete({ ...ask, attribution: { businessId: B, kind: "plan_compiler" } })).rejects.toBeInstanceOf(CreditsExhaustedError);
    } finally {
      await repos.businesses.update(hz.db, B, { modelBilling: "credits" });
    }
    await expect(assertPlatformCredits(hz.db, B, { live: false })).rejects.toBeInstanceOf(CreditsExhaustedError);
  });
});

describe("at zero credits: what stopped, what still works and a way on that works here (WP-09 T13)", () => {
  const page = { pitch: "Bread by bike", about: "Fresh bread every morning.", forWhom: "", stage: "idea" as const, showFounders: false, followForm: false };
  const decision = { options: [{ id: "a", label: "Yes", recommended: true, consequence: "Ads start today.", cost_minor: 0, reversible: true }, { id: "b", label: "No", recommended: false, consequence: "Nothing starts.", cost_minor: 0, reversible: true }], free_text: false, expires_at: null };

  it("the 402 sentence names credits first only where they can be bought, and always the own key and the date", async () => {
    const A = hz.A.businessId;
    await useUp(A);
    const sell = createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db, topUps: true });
    const offered = (await sell.complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } }).catch((e: unknown) => e)) as Error;
    expect(offered.message).toMatch(/To keep going, add credits in Settings › Billing, add your own Anthropic key in Settings › Keys .*, or wait for next month's credits on /);
    const none = (await createApiModelClient({ MODEL_MODE: "mock" }, silentLog(), { db: hz.db }).complete({ ...ask, attribution: { businessId: A, kind: "plan_compiler" } }).catch((e: unknown) => e)) as Error;
    expect(none.message).not.toMatch(/credits in Settings › Billing/);
  });

  it("reading, editing and publishing the page by hand, and answering a note with one of its options all work; a conversation does not", async () => {
    const A = hz.A.businessId;
    await useUp(A);
    hz.limits.reset();
    const owner = hz.caller({ userId: hz.A.ownerId });
    // Reading what the team wrote.
    await expect(owner.inbox.list({ businessId: A })).resolves.toBeDefined();
    // The public page by hand: no model call.
    await repos.businesses.commit(hz.db, A, { archetype: "b2b_saas" }).catch(() => undefined);
    await expect(owner.page.saveDraft({ businessId: A, draft: page })).resolves.toBeDefined();
    await expect(owner.page.publish({ businessId: A, content: page })).resolves.toMatchObject({ outcome: "published" });
    // A note answered with one of its prepared options.
    const item = await repos.inbox.createItem(hz.db, A, { type: "decision", from_agent_id: hz.A.agentId, subject: "Start the ads?", body_md: "Pick one.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision, blocks_continue: false, source_event_ids: [], entity_ids: [] });
    await expect(owner.inbox.decide({ businessId: A, itemId: item.id, chosenOption: "b" })).resolves.toBeDefined();
    // Settings › Billing says the same three lines; this test server sells (simulated) credits, so they come first.
    const plan = await owner.billing.plan({ businessId: A });
    expect(plan.atZero).toEqual({ stopped: CREDITS_ZERO_STOPPED, stillWorks: CREDITS_ZERO_STILL_WORKS, ways: expect.stringMatching(/^To keep going, add credits in Settings › Billing, add your own Anthropic key/) });
    // A conversation needs a model call: refused with the way on.
    await expect(owner.agent.conversation.send({ businessId: A, subject: { kind: "agent", id: hz.A.agentId }, text: "Anything new?" })).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
});
