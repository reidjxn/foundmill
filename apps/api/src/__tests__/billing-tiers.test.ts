/**
 * Billing and plan limits through the routers (BUILD §10.5, §11.15): credits are bought and reported in US dollars
 * whatever the business's currency, third-party spend in another currency is listed apart, a seat past the tier is
 * refused with a typed `tier_limit` error, and the founder's "Spend cap per action" is stored and editable by admins.
 */
import { CREDITS_CURRENCY, includedCreditsMinor, TIERS } from "@foundmill/config";
import { PRICING_CURRENCY } from "@foundmill/models";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeLocally } from "../services/composer";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  // A Temporal client that takes every workflow: the last check starts a task, which needs the session queued.
  const temporal = { workflow: { start: async () => ({}), getHandle: () => ({ signal: async () => undefined }) } };
  hz = await createApiHarness({ prefix: "tiers", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());

const period = () => new Date().toISOString().slice(0, 7);

describe("credits are US dollars", () => {
  it("the credits currency is the model price list's currency", () => {
    expect(CREDITS_CURRENCY).toBe(PRICING_CURRENCY);
  });

  it("a top-up is granted in US dollars on top of the month's included credits; another currency is refused, never merged", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.billing.topUp({ businessId: hz.A.businessId, amountMinor: 2_500, currency: "GBP" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await repos.usage.creditBalance(hz.db, hz.A.businessId, period())).toBeNull();
    // A top-up is a checkout (mock mode here) whose payment grants the credits.
    const buy = async (amountMinor: number, currency?: string) => {
      const opened = await owner.billing.topUp({ businessId: hz.A.businessId, amountMinor, ...(currency ? { currency } : {}) });
      expect(opened.checkout).toMatchObject({ currency: "USD", amountMinor });
      return owner.billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: opened.checkout.id });
    };
    // The first thing in the month: the period starts with what the tier includes, and the top-up comes on top of it.
    const included = includedCreditsMinor("free");
    expect((await buy(2_500)).balance).toMatchObject({ grantedMinor: included + 2_500, balanceMinor: included + 2_500, currency: "USD" });
    // Later top-ups only add their own amount.
    expect((await buy(500, "usd")).balance).toMatchObject({ grantedMinor: included + 3_000 });
  });

  it("plan and usage report US dollar costs and list spend in another currency apart", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await repos.usage.record(hz.db, hz.A.businessId, { agentId: hz.A.agentId, kind: "tokens", modelKey: "sonnet", quantity: 1_000, costMinor: 34 });
    await repos.usage.record(hz.db, hz.A.businessId, { agentId: hz.A.agentId, kind: "tool", quantity: 1, unit: "calls", costMinor: 1_200, currency: "GBP" });
    const plan = await owner.billing.plan({ businessId: hz.A.businessId });
    expect(plan.creditsCurrency).toBe("USD");
    expect(plan.usage).toMatchObject({ currency: "USD", label: "Estimate", otherCurrencies: [{ currency: "GBP", costMinor: 1_200 }] });
    expect(plan.usage.costMinor).toBeGreaterThanOrEqual(34);
    const usage = await owner.billing.usage({ businessId: hz.A.businessId });
    expect(usage.currency).toBe("USD");
    expect(usage.byAgent.find((a) => a.agentId === hz.A.agentId)?.costMinor).toBe(plan.usage.costMinor);
    const wages = await owner.finance.wages({ businessId: hz.A.businessId });
    expect(wages).toMatchObject({ currency: "USD", label: "Estimate" });
    // A wage cap caps that metered cost, so it is in US dollars too.
    expect(wages.rows.length).toBeGreaterThan(0);
    expect(wages.rows.every((r) => r.wageCapCurrency === "USD")).toBe(true);
    // Model costs elsewhere: an agent's wage and a training estimate are US dollars, whatever the business's currency.
    const profile = await owner.agent.profile.get({ businessId: hz.A.businessId, agentId: hz.A.agentId });
    expect(profile.wage).toMatchObject({ currency: "USD", label: "Estimate" });
    expect(await owner.agent.training.estimate({ businessId: hz.A.businessId, agentId: hz.A.agentId })).toMatchObject({ currency: "USD", label: "Estimate" });
    expect(await owner.agent.model.compare({ businessId: hz.A.businessId, agentId: hz.A.agentId })).toMatchObject({ currency: "USD" });
  });
});

describe("a note's own cost", () => {
  it("the in-process composer books a note's model cost in US dollars, never the business's currency", async () => {
    const item = await composeLocally(hz.db, hz.deps.models, hz.A.businessId);
    expect(item.currency).toBe("USD");
    const created = (await repos.events.list(hz.db, hz.A.businessId, { type: ["inbox.item_created"], limit: 20 })).items.find((e) => (e.payload as { inboxItemId?: string }).inboxItemId === item.id);
    expect((created?.payload as { cost?: { currency?: string } } | undefined)?.cost?.currency).toBe("USD");
  });
});

describe("people are free (TIERS.seats)", () => {
  it("a free business adds another person without a plan change", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    const guest = await hz.h.createUser("tiers-guest@test.local");
    // The fixture business already has four members and is on the free plan: no limit refuses a fifth.
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).planTier).toBe("free");
    const { link } = await owner.invitation.create({ businessId: hz.B.businessId, role: "collaborator" });
    await hz.caller({ userId: guest }).invitation.accept({ confirmAdult: true, token: link.split("/i/")[1]! });
    expect((await repos.memberships.get(hz.db, hz.B.businessId, guest))?.role).toBe("collaborator");
    expect(await repos.memberships.get(hz.db, hz.B.businessId, guest)).not.toBeNull();
  });
});

describe("concurrent agents (TIERS.maxConcurrentAgents)", () => {
  it("a task started by hand is refused while every slot of the tier is in use, before any session is opened", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const A = hz.A.businessId;
    const task = await repos.tasks.create(hz.db, A, { kind: "ops", title: "Tier slot check", assigneeAgentId: hz.A.agentId, status: "ready" });
    const open = async () => (await repos.agents.listSessions(hz.db, A, { openOnly: true, limit: 100 })).items.length;
    while ((await open()) < TIERS.free.maxConcurrentAgents) await repos.agents.createSession(hz.db, A, { agentId: hz.A.agentId });
    const before = await open();
    await expect(owner.dev.tasks.start({ businessId: A, taskId: task.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { code: "tier_limit", details: { limit: "concurrent_agents", tier: "free", allowed: TIERS.free.maxConcurrentAgents, used: before } },
    });
    expect(await open()).toBe(before);
    expect((await repos.tasks.get(hz.db, A, task.id)).status).toBe("ready");
    // A larger tier has room for it.
    await repos.businesses.update(hz.db, A, { planTier: "pro" });
    try {
      const started = await owner.dev.tasks.start({ businessId: A, taskId: task.id });
      expect(started.session.taskId).toBe(task.id);
      expect(await open()).toBe(before + 1);
    } finally {
      await repos.businesses.update(hz.db, A, { planTier: "free" });
    }
  });
});

describe("business.setSpendCap (Settings › What the team can do)", () => {
  it("an admin sets and clears the business cap, audited; a member cannot", async () => {
    const admin = hz.caller({ userId: hz.B.adminId });
    const set = await admin.business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: 5_000 });
    expect(set.spendCapMinor).toBe(5_000);
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).spendCapMinor).toBe(5_000);
    const audit = await repos.audit.list(hz.db, hz.B.businessId, { action: "business.set_spend_cap" });
    expect(audit.items[0]?.details).toMatchObject({ from: null, to: 5_000 });
    await expect(hz.caller({ userId: hz.B.memberId }).business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await admin.business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: null })).spendCapMinor).toBeNull();
    await expect(admin.business.setSpendCap({ businessId: hz.B.businessId, spendCapMinor: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("business.setModelBudget (the monthly model budget, 0059)", () => {
  it("an admin sets and clears the budget in US cents, audited; a member cannot; a negative amount is refused", async () => {
    const admin = hz.caller({ userId: hz.B.adminId });
    const set = await admin.business.setModelBudget({ businessId: hz.B.businessId, modelBudgetMinor: 25_000 });
    expect(set.modelBudgetMinor).toBe(25_000);
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).modelBudgetMinor).toBe(25_000);
    const audit = await repos.audit.list(hz.db, hz.B.businessId, { action: "business.set_model_budget" });
    expect(audit.items[0]?.details).toMatchObject({ from: null, to: 25_000 });
    await expect(hz.caller({ userId: hz.B.memberId }).business.setModelBudget({ businessId: hz.B.businessId, modelBudgetMinor: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.business.setModelBudget({ businessId: hz.B.businessId, modelBudgetMinor: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).modelBudgetMinor).toBe(25_000);
    expect((await admin.business.setModelBudget({ businessId: hz.B.businessId, modelBudgetMinor: null })).modelBudgetMinor).toBeNull();
    // The other business is untouched.
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).modelBudgetMinor).toBeNull();
  });
});
