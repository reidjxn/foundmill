/**
 * The business's own currency (0025) on the server paths that price business money: the plans an Inbox reply runs (an
 * amount without a currency used to be priced in EUR in every business), and the dashboard metrics that add amounts up
 * (never two currencies together, never a fixed EUR label).
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planContextFor } from "../services/decide";
import { executePlanActions } from "../services/plans";
import type { BusinessContext } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "currency" });
  // A pound business; the A business keeps the default (USD).
  await repos.businesses.update(hz.db, hz.B.businessId, { currency: "GBP" });
}, 120_000);
afterAll(() => hz.close());

describe("plans price in the business's currency (OL-20)", () => {
  it("an amount the plan names without a currency is the business's own; one the founder priced keeps it", async () => {
    const { businessId } = hz.B;
    const ctx = { db: hz.db, businessId, business: await repos.businesses.get(hz.db, businessId) } as unknown as BusinessContext;
    const planCtx = await planContextFor(ctx);
    expect(planCtx.currency).toBe("GBP");

    const plan = await repos.plans.create(hz.db, businessId, {
      origin: "free_text",
      status: "executing",
      actions: [
        // A live plan compiler may give the amount alone ("set the SEO budget to 300").
        { type: "set_budget", params: { channel: "seo", amount_minor: 30_000 }, policyOutcome: "allow" },
        // "$200 on paid ads": priced by the founder.
        { type: "set_budget", params: { channel: "paid_ads", amount_minor: 20_000, currency: "USD" }, policyOutcome: "allow" },
        { type: "create_task", params: { kind: "channel", title: "Write the launch post", budget_minor: 5_000 }, policyOutcome: "allow" },
      ],
    });
    const exec = await executePlanActions(hz.db, businessId, plan, { actorUserId: hz.B.ownerId, temporal: hz.deps.temporal, currency: planCtx.currency });
    expect(exec.executed).toHaveLength(3);
    expect(await repos.channels.getByKey(hz.db, businessId, "seo")).toMatchObject({ budgetMinor: 30_000, currency: "GBP" });
    expect(await repos.channels.getByKey(hz.db, businessId, "paid_ads")).toMatchObject({ budgetMinor: 20_000, currency: "USD" });
    const task = (await repos.tasks.list(hz.db, businessId, { limit: 200 })).items.find((t) => t.title === "Write the launch post");
    expect(task).toMatchObject({ budgetMinor: 5_000, currency: "GBP" });
  });
});

describe("dashboard metrics never add two currencies (api-services-25)", () => {
  it("blended cost per customer exists only while every channel spends in one currency", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    await repos.businesses.update(hz.db, businessId, { currency: "GBP" });
    try {
      const day = new Date().toISOString().slice(0, 10);
      // Written without a currency: the channel and its spend take the business's (GBP).
      const seo = await repos.channels.upsert(hz.db, businessId, { channelKey: "seo", line: "defence", enabled: true });
      expect(seo.currency).toBe("GBP");
      await repos.channels.upsertMetric(hz.db, businessId, { channelId: seo.id, day, spendMinor: 10_000, customers: 4 });
      expect(await owner.dashboard.customMetric.get({ businessId, queryId: "cpa_blended" })).toMatchObject({ value: 2_500, currency: "GBP", format: "money" });

      // A channel kept in dollars (set up before the business switched): no blended figure, and the reason says why.
      const ads = await repos.channels.upsert(hz.db, businessId, { channelKey: "paid_ads", line: "attack", enabled: true, currency: "USD" });
      await repos.channels.upsertMetric(hz.db, businessId, { channelId: ads.id, day, spendMinor: 9_000, currency: "USD", customers: 3 });
      const mixed = await owner.dashboard.customMetric.get({ businessId, queryId: "cpa_blended" });
      expect(mixed.value).toBeNull();
      expect(mixed.provenance).toMatch(/more than one currency/);
    } finally {
      await repos.businesses.update(hz.db, businessId, { currency: "USD" });
    }
  });

  it("revenue counts payments in the business's currency and says when others were left out", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    const { businessId } = hz.B;
    // The fixture's two payments were written while the business was in dollars: with no pound payment yet, the figure
    // is the dollars it has, labeled as such (never summed into pounds).
    expect(await owner.dashboard.customMetric.get({ businessId, queryId: "revenue_30d" })).toMatchObject({ value: 9_800, currency: "USD" });
    await repos.journeys.recordConversion(hz.db, businessId, { kind: "payment", amountMinor: 12_000, currency: "GBP" });
    await repos.journeys.recordConversion(hz.db, businessId, { kind: "payment", amountMinor: 50_000, currency: "EUR" });
    const revenue = await owner.dashboard.customMetric.get({ businessId, queryId: "revenue_30d" });
    expect(revenue).toMatchObject({ value: 12_000, currency: "GBP", format: "money" });
    expect(revenue.provenance).toMatch(/other currencies not added/);
  });
});
