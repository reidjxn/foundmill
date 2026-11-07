/**
 * Who converted (audit VGJC-X3, JM-02): every payer is linked to a CRM record or added to the CRM, per business, with a
 * customer role whose stage only moves forward; only a customer's first payment is a conversion that wins a customer
 * (renewals, repeat orders and a returning customer's one-off checkout are revenue only), so customer counts, the nth of
 * a kind and journey_daily count first payments while revenue counts every payment.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { goalCounters, repos } from "@foundmill/db";
import { signedShopifyRequest, signedStripeRequest } from "@foundmill/connectors";
import { SH_CUSTOMERS, SH_ORDERS } from "@foundmill/connectors/connectors/shopify/fixtures/shop";
import { ST_CHECKOUT_PAID, ST_INVOICES } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { stripeEvent } from "@foundmill/connectors/connectors/stripe/mock";
import { stripeCustomerEntityId } from "@foundmill/connectors/connectors/stripe/webhooks";
import { MOCK_NOW_UNIX } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { addCustomerRecord, advanceCustomerRole, customerEntityId } from "../customers";
import { createIngestHarness, deliver, json, type IngestHarness } from "./harness";

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("customers");
}, 120_000);
afterAll(async () => {
  await hz.close();
});

type Won = { entityId: string; conversionId: string; nthOfKind: number; kind: string };
const wins = async (businessId: string): Promise<Won[]> => (await hz.events(businessId, "customer.converted")).map((e) => e.payload as Won);
const customerRole = async (businessId: string, entityId: string) => (await repos.entities.listRoles(hz.db, businessId, entityId)).find((r) => r.role === "customer");

describe("payers in the CRM (#59)", () => {
  it("adds an unknown Stripe payer to the CRM, per business, and links every row to that record", async () => {
    const paid = stripeEvent("invoice.paid", ST_INVOICES[2]!, "evt_omar_a");
    expect((await deliver(hz.base, signedStripeRequest(hz.A.businessId, paid))).status).toBe(200);
    const [won] = await wins(hz.A.businessId);
    // Added at the business-scoped id derived from the connector's customer id, so Stripe's next delivery resolves at once.
    expect(won!.entityId).toBe(customerEntityId(hz.A.businessId, stripeCustomerEntityId("cus_MockOmarHaddad2", "omar.haddad@example.com")));
    const omar = await repos.entities.get(hz.db, hz.A.businessId, won!.entityId);
    expect(omar).toMatchObject({ displayName: "Omar Haddad", identifiers: { email: "omar.haddad@example.com", stripe_id: "cus_MockOmarHaddad2" }, lawfulBasis: "contract" });
    expect(await customerRole(hz.A.businessId, omar.id)).toMatchObject({ stage: "customer" });
    const provenance = await repos.entities.listProvenance(hz.db, hz.A.businessId, omar.id);
    expect(provenance.map((p) => p.field).sort()).toEqual(["display_name", "email", "stripe_id"]);

    // The same Stripe customer paying another business is that business's own record (no shared ids across tenants).
    expect((await deliver(hz.base, signedStripeRequest(hz.B.businessId, stripeEvent("invoice.paid", ST_INVOICES[2]!, "evt_omar_b")))).status).toBe(200);
    const [wonB] = await wins(hz.B.businessId);
    expect(wonB!.entityId).not.toBe(omar.id);
    expect((await repos.entities.get(hz.db, hz.B.businessId, wonB!.entityId)).displayName).toBe("Omar Haddad");
    await expect(repos.entities.get(hz.db, hz.B.businessId, omar.id)).rejects.toThrow();
  });

  it("links a payer the CRM already holds by email instead of adding a duplicate, and fills the missing Stripe id", async () => {
    const anna = await repos.entities.create(hz.db, hz.A.businessId, { kind: "person", displayName: "Anna L.", identifiers: { email: "Anna.Lind@example.com", phone: "+46 70 000 00 00" } });
    const before = (await repos.entities.countByKind(hz.db, hz.A.businessId)).person;
    expect((await deliver(hz.base, signedStripeRequest(hz.A.businessId, stripeEvent("invoice.paid", ST_INVOICES[0]!, "evt_anna_1")))).status).toBe(200);
    expect((await repos.entities.countByKind(hz.db, hz.A.businessId)).person).toBe(before);
    const payment = (await hz.events(hz.A.businessId, "payment.received")).find((p) => p.payload.externalId === ST_INVOICES[0]!.id)!;
    expect(payment.payload.entityId).toBe(anna.id);
    expect(payment.entityIds).toEqual([anna.id]);
    const linked = await repos.entities.get(hz.db, hz.A.businessId, anna.id);
    expect(linked.displayName).toBe("Anna L."); // the founder's name for her is kept
    expect(linked.identifiers).toMatchObject({ email: "Anna.Lind@example.com", stripe_id: "cus_MockAnnaLind01", phone: "+46 70 000 00 00" });
    const conversion = (await repos.journeys.listConversions(hz.db, hz.A.businessId, { entityId: anna.id })).items[0]!;
    expect(conversion).toMatchObject({ kind: "payment", firstPayment: true });
  });

  it("moves the Shopify shopper from signed up to customer, never backwards", async () => {
    const shopper = { ...SH_CUSTOMERS[1]!, id: 6_100_000_077, email: "rita@example.com", first_name: "Rita", last_name: "Moreno" };
    expect((await deliver(hz.base, signedShopifyRequest(hz.B.businessId, "customers/create", shopper, { webhookId: "rita-signup" }))).status).toBe(200);
    const [signup] = (await wins(hz.B.businessId)).filter((w) => w.kind === "signup");
    expect(await customerRole(hz.B.businessId, signup!.entityId)).toMatchObject({ stage: "signed_up" });
    const order = { ...SH_ORDERS[0]!, id: 5_500_000_777, customer: { id: shopper.id, email: shopper.email, orders_count: 1 } };
    expect((await deliver(hz.base, signedShopifyRequest(hz.B.businessId, "orders/paid", order, { webhookId: "rita-order" }))).status).toBe(200);
    const payment = (await hz.events(hz.B.businessId, "payment.received")).find((p) => p.payload.externalId === String(order.id))!;
    expect(payment.payload.entityId).toBe(signup!.entityId);
    expect(await customerRole(hz.B.businessId, signup!.entityId)).toMatchObject({ stage: "customer" });
    // The order's landing page and code became a touch on her path, attributed through parseTouchSource.
    const touches = await repos.journeys.pathForEntity(hz.db, hz.B.businessId, signup!.entityId);
    expect(touches.map((t) => t.channelKey)).toContain("social");
    expect(touches.some((t) => (t.source as { code?: string }).code === "MAJA10")).toBe(true);
    // A late signup event cannot demote a paying customer.
    const late = { ...shopper, created_at: "2026-10-03T00:00:00Z" };
    await deliver(hz.base, signedShopifyRequest(hz.B.businessId, "customers/create", { ...late, id: shopper.id }, { webhookId: "rita-late" }));
    expect(await customerRole(hz.B.businessId, signup!.entityId)).toMatchObject({ stage: "customer" });
  });

  it("a delivery that loses the race to add the same new customer links to the record the other one committed", async () => {
    const id = customerEntityId(hz.A.businessId, "connector-entity-of-the-racer");
    const input = { id, kind: "person" as const, displayName: "Racer", identifiers: { email: "racer@example.com" } };
    // The concurrent delivery committed first; this one's insert at the same id hits the primary key.
    const winner = await repos.entities.create(hz.db, hz.A.businessId, input);
    const outcome = await hz.db.transaction(async (tx) => {
      const added = await addCustomerRecord(tx, hz.A.businessId, input);
      // The failed insert ran in a savepoint, so the delivery's transaction goes on (and commits) normally.
      await advanceCustomerRole(tx, hz.A.businessId, added.entity.id, "customer", new Date());
      return added;
    });
    expect(outcome).toMatchObject({ created: false, entity: { id: winner.id } });
    expect(await customerRole(hz.A.businessId, winner.id)).toMatchObject({ stage: "customer" });
  });
});

describe("first payments only (#60)", () => {
  it("a returning customer's one-off checkout and a repeat order are revenue, and do not move the customer count", async () => {
    const before = await repos.journeys.countConversions(hz.db, hz.B.businessId);
    const winsBefore = (await wins(hz.B.businessId)).length;
    // Rita (above) already paid in B: her repeat Shopify order says orders_count 2.
    const repeat = { ...SH_ORDERS[0]!, id: 5_500_000_778, created_at: "2026-10-04T10:00:00Z", customer: { id: 6_100_000_077, email: "rita@example.com", orders_count: 2 } };
    expect((await deliver(hz.base, signedShopifyRequest(hz.B.businessId, "orders/paid", repeat, { webhookId: "rita-repeat" }))).status).toBe(200);
    // Omar paid B by invoice already; a one-off checkout is flagged first by Stripe but he has paid before.
    const checkout = stripeEvent("checkout.session.completed", { ...ST_CHECKOUT_PAID, id: "cs_test_omar_again", customer: "cus_MockOmarHaddad2", customer_details: { email: "omar.haddad@example.com", name: "Omar Haddad" } }, "evt_omar_checkout");
    expect((await deliver(hz.base, signedStripeRequest(hz.B.businessId, checkout))).status).toBe(200);

    expect((await wins(hz.B.businessId)).length).toBe(winsBefore);
    expect(await repos.journeys.countConversions(hz.db, hz.B.businessId)).toEqual(before);
    const repeats = await repos.journeys.listConversions(hz.db, hz.B.businessId, { kind: "payment", firstPayment: false });
    expect(repeats.items.map((c) => Number(c.amountMinor)).sort((a, b) => a - b)).toEqual([4_900, 12_000]);
  });

  it("the next new customer is numbered among first payments, and journey_daily counts customers from first payments but revenue from all", async () => {
    // Paid after both repeat payments above: B's first payments before it are Omar's invoice and Rita's first order.
    const paidAt = MOCK_NOW_UNIX + 60;
    const fresh = stripeEvent("invoice.paid", { ...ST_INVOICES[0]!, id: "in_new_customer_1", customer: "cus_NewCustomer001", customer_email: "new.one@example.com", customer_name: "New One", status_transitions: { paid_at: paidAt } }, "evt_new_customer");
    const res = await deliver(hz.base, signedStripeRequest(hz.B.businessId, fresh));
    expect(res.status).toBe(200);
    const [, convertedId] = (await json<{ eventIds: string[] }>(res)).eventIds;
    const won = (await hz.events(hz.B.businessId, "customer.converted")).find((e) => e.id === convertedId)!;
    expect(won.payload).toMatchObject({ kind: "payment", nthOfKind: 3 }); // not 5: the two repeat payments are not customers

    await repos.journeys.refreshDaily(hz.db);
    const day = "2026-10-04";
    const [row] = await repos.journeys.dailyTotals(hz.db, hz.B.businessId, { from: day, to: day });
    expect(row).toMatchObject({ payments: 0 }); // the repeat order that day is not a customer
    expect(Number(row!.revenueMinor)).toBe(4_900); // but it is revenue
  });
});

describe("milestones from real payments (#58)", () => {
  it("the first payment a business receives awards First customer once; retries and repeat payments award it again never", async () => {
    const A = hz.A.businessId;
    const firstCustomer = async () => (await repos.journeys.listMilestones(hz.db, A)).filter((m) => (m.ref as { trophyKey?: unknown } | null)?.trophyKey === "customer_1");
    const awarded = await firstCustomer();
    expect(awarded).toHaveLength(1);
    expect(awarded[0]!.label).toBe("First customer");
    // Awarded by the delivery that brought the business's first payment, with that payment's time.
    const payments = (await repos.journeys.listConversions(hz.db, A, { kind: "payment", firstPayment: true, limit: 100 })).items;
    const winner = payments.find((p) => p.id === (awarded[0]!.ref as { conversionId?: string }).conversionId);
    expect(winner).toBeDefined();
    expect(awarded[0]!.achievedAt.toISOString()).toBe(winner!.occurredAt.toISOString());

    // The same invoice delivered again (a vendor retry) and a repeat order award nothing more.
    expect([200, 409]).toContain((await deliver(hz.base, signedStripeRequest(A, stripeEvent("invoice.paid", ST_INVOICES[2]!, "evt_omar_a")))).status);
    const repeat = { ...SH_ORDERS[0]!, id: 5_500_000_901, created_at: "2026-10-05T10:00:00Z", customer: { id: 6_100_000_177, email: "anna.lind@example.com", orders_count: 2 } };
    expect((await deliver(hz.base, signedShopifyRequest(A, "orders/paid", repeat, { webhookId: "anna-repeat" }))).status).toBe(200);
    expect(await firstCustomer()).toHaveLength(1);
  });
});

describe("the business's goal reached by a payment (founder, 2026-11-07)", () => {
  it("marks the active goal achieved once, with the Chief of Staff's note and goal.achieved through the outbox", async () => {
    const B = hz.B.businessId;
    const before = (await goalCounters(hz.db, B)).payingCustomers;
    const goal = await repos.goals.seedActive(hz.db, B, { sentence: `Reach ${before + 1} paying customers by Dec 19`, kind: "paying_customers", target: before + 1, dueOn: "2027-12-19", startValue: before, approvedAt: new Date(), agentId: hz.B.agentId });
    expect(goal).not.toBeNull();
    const invoice = { ...ST_INVOICES[0]!, id: "in_MockGoal0001Paid", customer: "cus_MockGoalPayer01", customer_email: "goal.payer@example.com", customer_name: "Goal Payer" };
    expect((await deliver(hz.base, signedStripeRequest(B, stripeEvent("invoice.paid", invoice, "evt_goal_b_1")))).status).toBe(200);
    expect((await goalCounters(hz.db, B)).payingCustomers).toBe(before + 1);
    expect(await repos.goals.get(hz.db, B, goal!.id)).toMatchObject({ status: "achieved", achievedValue: before + 1 });
    const achieved = await hz.events(B, "goal.achieved");
    expect(achieved).toHaveLength(1);
    expect(achieved[0]!.payload).toMatchObject({ goalId: goal!.id, achievedValue: before + 1 });
    const noteId = (achieved[0]!.payload as { inboxItemId: string }).inboxItemId;
    expect(await repos.inbox.get(hz.db, B, noteId)).toMatchObject({ type: "milestone", subject: `Goal reached: ${before + 1} paying customers`, blocksContinue: false, fromAgentId: hz.B.agentId });
    // A second payment reaches nothing more.
    const again = { ...invoice, id: "in_MockGoal0002Paid", customer: "cus_MockGoalPayer02", customer_email: "goal.payer2@example.com" };
    expect((await deliver(hz.base, signedStripeRequest(B, stripeEvent("invoice.paid", again, "evt_goal_b_2")))).status).toBe(200);
    expect(await hz.events(B, "goal.achieved")).toHaveLength(1);
  });
});
