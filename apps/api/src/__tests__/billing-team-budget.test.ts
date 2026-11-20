/**
 * The team budget in outcomes on Settings › Billing (WP-14 T3): `billing.plan.teamBudget` is this month's real outcomes
 * (the north star's rule: nothing simulated counts) against what the budget paid so far, an Estimate. With no outcome
 * yet, or nothing spent, there is no figure at all: no number is made up. Never for a sample business, nor for a
 * business on its own key, whose agents the budget does not pay for.
 */
import { bookUsage, repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "teambudget" });
}, 120_000);
afterAll(() => hz.close());

const event = (businessId: string, type: string, actor: { kind: string; id: string }, payload: Record<string, unknown>) =>
  hz.db.execute(sql`insert into events (business_id, type, actor, payload) values (${businessId}, ${type}, ${JSON.stringify(actor)}::jsonb, ${JSON.stringify(payload)}::jsonb)`);
const spend = (businessId: string, agentId: string, costMinor: number) => bookUsage(hz.db, businessId, { agentId, kind: "tokens", modelKey: "haiku", quantity: 1_000, unit: "tokens", costMinor, billedTo: "credits" });

describe("billing.plan.teamBudget", () => {
  it("is null with no outcome yet, whatever was spent: the screen shows the dollar balance alone", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect((await owner.billing.plan({ businessId: hz.A.businessId })).teamBudget).toBeNull();
    await spend(hz.A.businessId, hz.A.agentId, 120);
    const plan = await owner.billing.plan({ businessId: hz.A.businessId });
    expect(plan.teamBudget).toBeNull();
    // 120 cents of cost are charged to credits at cost plus the markup (Nov 17, 2026).
    expect(plan.credits).toMatchObject({ spentMinor: 156, balanceMinor: 344 });
  });

  it("counts the month's real outcomes, nothing simulated, and says what the balance is enough for, as an Estimate", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const A = hz.A.businessId;
    // Real: the founder published the page; the vendor accepted two emails; a person confirmed a follow.
    await event(A, "page.published", { kind: "user", id: hz.A.ownerId }, {});
    await event(A, "mail.sent", { kind: "agent", id: hz.A.agentId }, { simulated: false });
    await event(A, "mail.sent", { kind: "agent", id: hz.A.agentId }, { simulated: false });
    await event(A, "page.followed", { kind: "system", id: "public-page" }, {});
    // Not real: a simulated send, a page an agent published, and a payment nobody's webhook reported.
    await event(A, "mail.sent", { kind: "agent", id: hz.A.agentId }, { simulated: true });
    await event(A, "page.published", { kind: "agent", id: hz.A.agentId }, {});
    await event(A, "payment.received", { kind: "system", id: "simulate" }, { amountMinor: 900 });
    const plan = await owner.billing.plan({ businessId: A });
    // $1.56 of budget spent (cost plus the markup) for 4 outcomes is 39 cents each; $3.44 left is enough for about 8 more.
    expect(plan.teamBudget).toEqual({ outcomes: 4, costPerOutcomeMinor: 39, enoughFor: 8, label: "Estimate" });
  });

  it("gives no figure for a sample business or a business on its own key", async () => {
    const B = hz.B.businessId;
    const owner = hz.caller({ userId: hz.B.ownerId });
    await spend(B, hz.B.agentId, 100);
    await event(B, "mail.sent", { kind: "agent", id: hz.B.agentId }, { simulated: false });
    expect((await owner.billing.plan({ businessId: B })).teamBudget).toMatchObject({ outcomes: 1 });
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${B}`);
    expect((await owner.billing.plan({ businessId: B })).teamBudget).toBeNull();
    await hz.db.execute(sql`update businesses set is_demo = false, model_billing = 'byok' where id = ${B}`);
    expect((await owner.billing.plan({ businessId: B })).teamBudget).toBeNull();
    await repos.businesses.update(hz.db, B, { modelBilling: "credits" });
  });
});
