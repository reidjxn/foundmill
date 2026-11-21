/**
 * Plan tier and credits in the cycle (BUILD §9.4, §10.5): the brief's concurrency is the tier's limit less the sessions
 * already open, its budget is the business's credits in US dollars (the tier's included credits before the first charge
 * of a month; none for a business on its own key), a full plan defers every start, and a small balance still runs work.
 */
import { CREDITS_CURRENCY, includedCreditsMinor, TIERS } from "@foundmill/config";
import { periodOf, repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBriefActivities } from "../activities/brief";
import { createCycleActivities } from "../activities/cycle";
import { DEFAULT_TASK_RESERVE_MINOR, taskReserveMinor } from "../workflows/businessCycle";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "tier" });
});
afterAll(async () => {
  await t?.close();
});

describe("loadBrief: the plan tier and credits", () => {
  it("runs a free business at its tier's concurrency, less what is already running, against its included credits in US dollars", async () => {
    const { loadBrief } = createBriefActivities(t.deps);
    const open = (await repos.agents.listSessions(t.db, t.businessId, { openOnly: true, limit: 50 })).items.length;
    const brief = await loadBrief({ businessId: t.businessId });
    expect(brief.maxAgents).toBe(TIERS.free.maxConcurrentAgents - open);
    expect(brief.creditsCurrency).toBe(CREDITS_CURRENCY);
    expect(brief.budgetRemainingMinor).toBe(includedCreditsMinor("free"));
    expect(brief.text).toContain(`Concurrency limit: ${TIERS.free.maxConcurrentAgents - open} agents (plan free: ${TIERS.free.maxConcurrentAgents} at once, ${open} already running)`);
    expect(brief.text).toContain("5.00 USD of credits (Estimate)");

    await repos.businesses.update(t.db, t.businessId, { planTier: "pro" });
    expect((await loadBrief({ businessId: t.businessId })).maxAgents).toBe(TIERS.pro.maxConcurrentAgents - open);
    await repos.businesses.update(t.db, t.businessId, { planTier: "free", modelBilling: "byok" });
    const own = await loadBrief({ businessId: t.businessId });
    expect(own.budgetRemainingMinor).toBeNull();
    expect(own.text).toContain("the founder's own Anthropic key");
    await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
  });

  it("with this month's credits used up, the brief has no budget and the round of work plan drafts nothing on the platform's key", async () => {
    const { loadBrief } = createBriefActivities(t.deps);
    const { planCycle } = createCycleActivities(t.deps);
    const period = periodOf(t.deps.clock.now());
    const { balance } = await repos.usage.ensurePeriodCredits(t.db, t.businessId, period, includedCreditsMinor("free"));
    await repos.usage.chargeCredits(t.db, t.businessId, period, Number(balance.balanceMinor));
    try {
      const brief = await loadBrief({ businessId: t.businessId });
      expect(brief.budgetRemainingMinor).toBe(0);
      expect(brief.maxAgents).toBeGreaterThan(0);
      const ledgerBefore = (await repos.usage.list(t.db, t.businessId, { limit: 500 })).items.length;
      const plan = await planCycle({ businessId: t.businessId, cycleNumber: 1, trigger: "continue", brief });
      expect(plan).toMatchObject({ starts: [], costMinor: 0 });
      expect(plan.deferred.length).toBeGreaterThan(0);
      expect(plan.deferred.every((d) => d.reason === "credits used up for this month")).toBe(true);
      expect((await repos.usage.list(t.db, t.businessId, { limit: 500 })).items).toHaveLength(ledgerBefore);
    } finally {
      await repos.usage.grantCredits(t.db, t.businessId, period, includedCreditsMinor("free"));
    }
  });

  it("with every slot of the plan in use, the round of work plan defers each start", async () => {
    const { loadBrief } = createBriefActivities(t.deps);
    const { planCycle } = createCycleActivities(t.deps);
    let brief = await loadBrief({ businessId: t.businessId });
    while (brief.maxAgents > 0) {
      await openSessionRow(t, t.workerId, t.codeTaskId);
      brief = await loadBrief({ businessId: t.businessId });
    }
    expect(brief.maxAgents).toBe(0);
    const ledgerBefore = (await repos.usage.list(t.db, t.businessId, { limit: 500 })).items.length;
    const plan = await planCycle({ businessId: t.businessId, cycleNumber: 1, trigger: "continue", brief });
    expect(plan.starts).toEqual([]);
    expect(plan.costMinor).toBe(0);
    expect(plan.deferred.length).toBeGreaterThan(0);
    expect(plan.deferred.every((d) => d.reason === "plan limit: every concurrent agent slot is in use")).toBe(true);
    // No plan is drafted, so nothing is spent on one.
    expect((await repos.usage.list(t.db, t.businessId, { limit: 500 })).items).toHaveLength(ledgerBefore);
  });
});

describe("taskReserveMinor: what a starting task holds back of the credits left", () => {
  it("keeps the task's budget (or the default) when credits are plentiful, and an equal share of a small balance", () => {
    expect(taskReserveMinor(null, 1_000_000, 4)).toBe(DEFAULT_TASK_RESERVE_MINOR);
    expect(taskReserveMinor(300, 1_000_000, 4)).toBe(300);
    // The free tier's $5.00 over four free slots: every slot can still start.
    expect(taskReserveMinor(null, 500, 4)).toBe(125);
    expect(taskReserveMinor(null, 500, 0)).toBe(500);
    expect(taskReserveMinor(null, 0, 4)).toBe(0);
  });
});
