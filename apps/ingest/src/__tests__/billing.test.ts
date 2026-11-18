/**
 * `POST /billing/stripe` (audit 2026-10-12 #22): the platform Stripe webhook is the only way a live top-up becomes
 * credits. Only a delivery signed with STRIPE_BILLING_WEBHOOK_SECRET is read (never the businesses' secret, never a
 * fixture secret; without the secret nothing is accepted); a paid session grants its checkout's USD credits once and is
 * audited; a replay is refused, a duplicate event or a mismatched session grants nothing; an unpaid, expired or bounced
 * session grants nothing (the last two close the checkout); another business's checkout is never touched. A grant that
 * lifts a credits stop restarts the engines and queued retests, as every other way back does.
 */
import { MOCK_NOW, stripeSignatureHeader } from "@foundmill/connectors";
import { creditsState, repos, resumeBusinessAgents, stopBusinessAgents } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASYNC_PAYMENT_FAILED_MESSAGE, BILLING_WEBHOOK_PATH } from "../billing";
import { createFollowups } from "../followups";
import { silentLogger } from "../types";
import type { WorkflowStarter } from "../workflows";
import { createIngestHarness, json, type IngestHarness } from "./harness";

const SECRET = "whsec_test_platform_billing_0123456789";
const T = Math.floor(MOCK_NOW.getTime() / 1000);
const period = MOCK_NOW.toISOString().slice(0, 7);

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("billing", { billingWebhookSecret: SECRET });
}, 120_000);
afterAll(() => hz?.close());

let n = 0;
async function liveCheckout(businessId: string, amountMinor = 5000) {
  const row = await repos.checkouts.create(hz.db, businessId, { mode: "live", amountMinor });
  return repos.checkouts.attachSession(hz.db, businessId, row.id, { mode: "live", externalId: `cs_test_${row.id.replace(/-/g, "").slice(0, 24)}`, checkoutUrl: "https://checkout.stripe.com/c/pay/x" });
}
const sessionEvent = (type: string, c: { id: string; businessId: string; externalId: string | null; amountMinor: number }, over: Record<string, unknown> = {}) => ({
  id: `evt_billing_${++n}`,
  type,
  created: T,
  livemode: false,
  data: { object: { id: c.externalId, object: "checkout.session", mode: "payment", payment_status: "paid", amount_total: Number(c.amountMinor), currency: "usd", metadata: { foundmill_checkout_id: c.id, foundmill_business_id: c.businessId, foundmill_kind: "credits" }, ...over } },
});
async function post(event: unknown, opts: { secret?: string; timestamp?: number; base?: string } = {}) {
  const body = JSON.stringify(event);
  const res = await fetch(`${opts.base ?? hz.base}${BILLING_WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(opts.secret ?? SECRET, body, opts.timestamp ?? T) }, body });
  return { status: res.status, body: await json(res) };
}
// What the business can spend this period: the balance row, or what its tier includes before the month's first row (a
// top-up that comes first starts the row with the included credits).
const balance = async (businessId: string) => Number((await creditsState(hz.db, await repos.businesses.get(hz.db, businessId), period))?.balanceMinor ?? 0);

describe("POST /billing/stripe", () => {
  it("a paid session grants its checkout's credits once and audits it; the same event again is refused as a replay", async () => {
    const c = await liveCheckout(hz.A.businessId, 5000);
    const before = await balance(hz.A.businessId);
    const event = sessionEvent("checkout.session.completed", c);
    expect(await post(event)).toEqual({ status: 200, body: { ok: true, eventId: event.id, outcome: "granted" } });
    expect(await balance(hz.A.businessId)).toBe(before + 5000);
    expect(await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).toMatchObject({ status: "paid", paidEventId: event.id, grantedPeriod: period });
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "billing.credits_purchased" });
    expect(audit.items.find((a) => (a.target as { id?: string }).id === c.id)).toMatchObject({ actorKind: "webhook", details: { amountMinor: 5000, currency: "USD", mode: "live", eventId: event.id } });
    expect((await post(event)).status).toBe(409);
    // Stripe announces the same payment again under another event (async success after completion): nothing more.
    expect((await post(sessionEvent("checkout.session.async_payment_succeeded", c))).body).toMatchObject({ outcome: "duplicate" });
    expect(await balance(hz.A.businessId)).toBe(before + 5000);
  });

  it("refuses a delivery signed with any other secret (a fixture's, the businesses' Stripe secret), a stale one, or none", async () => {
    const c = await liveCheckout(hz.A.businessId, 2500);
    const before = await balance(hz.A.businessId);
    expect((await post(sessionEvent("checkout.session.completed", c), { secret: "whsec_mock_platform_signing_secret" })).status).toBe(401);
    expect((await post(sessionEvent("checkout.session.completed", c), { timestamp: T - 3600 })).status).toBe(401);
    const unsigned = await fetch(`${hz.base}${BILLING_WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sessionEvent("checkout.session.completed", c)) });
    expect(unsigned.status).toBe(401);
    expect(await balance(hz.A.businessId)).toBe(before);
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).status).toBe("open");
  });

  it("without STRIPE_BILLING_WEBHOOK_SECRET every delivery is refused, in mock mode too", async () => {
    const built = hz.build({ billingWebhookSecret: null });
    const c = await liveCheckout(hz.A.businessId, 2500);
    const body = JSON.stringify(sessionEvent("checkout.session.completed", c));
    const res = await built.app.request(BILLING_WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(SECRET, body, T) }, body });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "billing_webhook_unconfigured" });
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).status).toBe("open");
  });

  it("grants nothing for an unpaid session, another amount, a mock checkout, or a checkout of another business", async () => {
    const c = await liveCheckout(hz.A.businessId, 10_000);
    const before = await balance(hz.A.businessId);
    const beforeB = await balance(hz.B.businessId);
    expect((await post(sessionEvent("checkout.session.completed", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "awaiting_payment" });
    expect((await post(sessionEvent("checkout.session.completed", c, { amount_total: 100 }))).body).toMatchObject({ outcome: "mismatch" });
    expect((await post(sessionEvent("checkout.session.completed", c, { currency: "eur" }))).body).toMatchObject({ outcome: "mismatch" });
    expect((await post(sessionEvent("checkout.session.completed", { ...c, businessId: hz.B.businessId }))).body).toMatchObject({ outcome: "unknown" });
    const mock = await repos.checkouts.create(hz.db, hz.A.businessId, { mode: "mock", amountMinor: 10_000 });
    expect((await post(sessionEvent("checkout.session.completed", { ...mock, externalId: "cs_test_forged", amountMinor: 10_000 }))).body).toMatchObject({ outcome: "mismatch" });
    expect(await balance(hz.A.businessId)).toBe(before);
    expect(await balance(hz.B.businessId)).toBe(beforeB);
    // Not a Foundmill top-up at all (another product on the platform account): acknowledged and ignored.
    expect((await post({ ...sessionEvent("checkout.session.completed", c), data: { object: { id: "cs_test_other", mode: "payment", payment_status: "paid", amount_total: 999, currency: "usd", metadata: {} } } })).body).toMatchObject({ outcome: "ignored" });
    expect((await post({ id: "evt_billing_invoice", type: "invoice.paid", created: T, data: { object: {} } })).body).toMatchObject({ outcome: "ignored" });
  });

  it("an expired session closes its checkout", async () => {
    const c = await liveCheckout(hz.A.businessId, 2500);
    expect((await post(sessionEvent("checkout.session.expired", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "expired" });
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).status).toBe("expired");
  });

  it("a delayed payment that bounces closes its checkout as failed, with a sentence for the Billing tab", async () => {
    const c = await liveCheckout(hz.A.businessId, 2500);
    const before = await balance(hz.A.businessId);
    // A bank debit: the session completes unpaid, then the payment fails (the session never expires).
    expect((await post(sessionEvent("checkout.session.completed", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "awaiting_payment" });
    expect((await post(sessionEvent("checkout.session.async_payment_failed", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "failed" });
    expect(await repos.checkouts.get(hz.db, hz.A.businessId, c.id)).toMatchObject({ status: "failed", failure: ASYNC_PAYMENT_FAILED_MESSAGE });
    expect(await balance(hz.A.businessId)).toBe(before);
  });
});

describe("the entry plan (WP-09 T16)", () => {
  async function planCheckout(businessId: string, createdBy: string) {
    const row = await repos.checkouts.create(hz.db, businessId, { kind: "subscription", mode: "live", amountMinor: 500, createdBy });
    return repos.checkouts.attachSession(hz.db, businessId, row.id, { mode: "live", externalId: `cs_test_${row.id.replace(/-/g, "").slice(0, 24)}`, checkoutUrl: "https://checkout.stripe.com/c/pay/x" });
  }
  const planSession = (c: { id: string; businessId: string; externalId: string | null; amountMinor: number }, sub: string, over: Record<string, unknown> = {}) =>
    sessionEvent("checkout.session.completed", c, { mode: "subscription", subscription: sub, customer: "cus_test_entry", metadata: { foundmill_checkout_id: c.id, foundmill_business_id: c.businessId, foundmill_kind: "subscription" }, ...over });
  const subEvent = (type: string, object: Record<string, unknown>) => ({ id: `evt_billing_${++n}`, type, created: T, livemode: false, data: { object } });

  it("a paid subscription session activates the opener's plan and grants no credits; its later events move the plan", async () => {
    const owner = hz.B.ownerId;
    const c = await planCheckout(hz.B.businessId, owner);
    const before = await balance(hz.B.businessId);
    expect(await repos.accountPlans.ownerHasActivePlan(hz.db, hz.B.businessId, { live: true })).toBe(false);
    expect((await post(planSession(c, "sub_test_entry_1"))).body).toMatchObject({ outcome: "subscribed" });
    expect(await balance(hz.B.businessId)).toBe(before);
    expect(await repos.accountPlans.forUser(hz.db, owner)).toMatchObject({ status: "active", mode: "live", stripeSubscriptionId: "sub_test_entry_1", stripeCustomerId: "cus_test_entry", checkoutId: c.id });
    expect(await repos.accountPlans.ownerHasActivePlan(hz.db, hz.B.businessId, { live: true })).toBe(true);
    const audit = await repos.audit.list(hz.db, hz.B.businessId, { action: "billing.entry_plan_started" });
    expect(audit.items.find((a) => (a.target as { id?: string }).id === c.id)).toMatchObject({ actorKind: "webhook" });

    // The renewal invoice (newer API shape: the subscription under parent) records the paid period's end.
    const end = T + 30 * 86_400;
    expect((await post(subEvent("invoice.paid", { object: "invoice", parent: { subscription_details: { subscription: "sub_test_entry_1" } }, lines: { data: [{ period: { end } }] } }))).body).toMatchObject({ outcome: "plan_updated" });
    expect((await repos.accountPlans.forUser(hz.db, owner))?.currentPeriodEnd?.getTime()).toBe(end * 1000);
    // A failed renewal (older API shape: top-level subscription) puts the plan behind; a recovery brings it back.
    expect((await post(subEvent("invoice.payment_failed", { object: "invoice", subscription: "sub_test_entry_1" }))).body).toMatchObject({ outcome: "plan_updated" });
    expect(await repos.accountPlans.ownerHasActivePlan(hz.db, hz.B.businessId, { live: true })).toBe(false);
    expect((await post(subEvent("customer.subscription.updated", { id: "sub_test_entry_1", object: "subscription", status: "active", items: { data: [{ current_period_end: end }] } }))).body).toMatchObject({ outcome: "plan_updated" });
    expect((await repos.accountPlans.forUser(hz.db, owner))?.status).toBe("active");
    expect((await post(subEvent("customer.subscription.deleted", { id: "sub_test_entry_1", object: "subscription", status: "canceled" }))).body).toMatchObject({ outcome: "plan_updated" });
    expect((await repos.accountPlans.forUser(hz.db, owner))?.status).toBe("canceled");
    // A subscription no account holds (another product on the platform account) is acknowledged and ignored.
    expect((await post(subEvent("customer.subscription.updated", { id: "sub_test_other", object: "subscription", status: "active" }))).body).toMatchObject({ outcome: "ignored" });
  });

  it("a subscription checkout arriving as a one-off payment, or a credits checkout as a subscription, is ignored", async () => {
    const c = await planCheckout(hz.B.businessId, hz.B.adminId);
    expect((await post(planSession(c, "sub_test_entry_2", { mode: "payment" }))).body).toMatchObject({ outcome: "ignored" });
    const credits = await liveCheckout(hz.B.businessId, 2000);
    expect((await post(sessionEvent("checkout.session.completed", credits, { mode: "subscription" }))).body).toMatchObject({ outcome: "ignored" });
    expect(await repos.accountPlans.forUser(hz.db, hz.B.adminId)).toBeNull();
    expect((await repos.checkouts.get(hz.db, hz.B.businessId, credits.id)).status).toBe("open");
  });
});

describe("a paid top-up that lifts a credits stop (SEC3)", () => {
  /** An app whose follow-ups record the workflows they start. */
  function recordingApp() {
    const calls: { type: string; workflowId: string; args: unknown[] }[] = [];
    const workflows: WorkflowStarter = {
      async start(type, options) {
        calls.push({ type, ...options });
        return { started: true, workflowId: options.workflowId };
      },
      async close() {},
    };
    const followups = createFollowups({ db: hz.db, composer: null, workflows, log: silentLogger });
    const built = hz.build({ followups });
    const deliver = async (event: unknown) => {
      const body = JSON.stringify(event);
      const res = await built.app.request(BILLING_WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(SECRET, body, T) }, body });
      await followups.idle();
      return { status: res.status, body: await res.json() };
    };
    return { calls, deliver };
  }

  it("restarts the engines the stop ended and the retests queued meanwhile, as Resume agents does; another stop restarts nothing", async () => {
    const { businessId, agentId, channelId } = hz.A;
    await repos.channels.setEngineWorkflow(hz.db, businessId, channelId, `engine:${channelId}`);
    const draft = await repos.agents.createVersion(hz.db, businessId, agentId, { state: "draft" });
    const queued = await repos.training.create(hz.db, businessId, { agentId, toVersionId: draft.id, status: "queued" });
    const decided = await repos.training.create(hz.db, businessId, { agentId, toVersionId: draft.id, status: "awaiting_decision" });
    const channel = await repos.channels.get(hz.db, businessId, channelId);
    try {
      // Stop all agents is never lifted by a top-up: nothing restarts.
      await stopBusinessAgents(hz.db, businessId, { reason: "kill_switch" });
      const app = recordingApp();
      expect((await app.deliver(sessionEvent("checkout.session.completed", await liveCheckout(businessId, 2500)))).body).toMatchObject({ outcome: "granted" });
      expect(await repos.businesses.stopState(hz.db, businessId)).toMatchObject({ stopped: true, reason: "kill_switch" });
      expect(app.calls).toEqual([]);
      await resumeBusinessAgents(hz.db, businessId);

      // The credits ran out: the top-up lifts the stop and starts what a resume starts.
      await stopBusinessAgents(hz.db, businessId, { reason: "credits_exhausted" });
      const paid = recordingApp();
      expect((await paid.deliver(sessionEvent("checkout.session.completed", await liveCheckout(businessId, 2500)))).body).toMatchObject({ outcome: "granted" });
      expect(await repos.businesses.agentsStopped(hz.db, businessId)).toBe(false);
      expect(paid.calls).toEqual(
        expect.arrayContaining([
          { type: "channelEngine", workflowId: `engine:${channelId}`, args: [{ businessId, channelId, channelKey: channel.channelKey }] },
          { type: "trainingRun", workflowId: `training:${queued.id}`, args: [{ businessId, trainingRunId: queued.id }] },
        ]),
      );
      expect(paid.calls.map((c) => c.workflowId)).not.toContain(`training:${decided.id}`);
      // A top-up with nothing stopped restarts nothing.
      const idle = recordingApp();
      expect((await idle.deliver(sessionEvent("checkout.session.completed", await liveCheckout(businessId, 2500)))).body).toMatchObject({ outcome: "granted" });
      expect(idle.calls).toEqual([]);
    } finally {
      await resumeBusinessAgents(hz.db, businessId);
      await repos.training.cancelActive(hz.db, businessId, { coachSummaryMd: "test cleanup" });
      await repos.channels.setEngineWorkflow(hz.db, businessId, channelId, null);
    }
  });
});

describe("the pay-and-resume loop (founder, Nov 17, 2026)", () => {
  function recordingApp() {
    const calls: { type: string; workflowId: string; args: unknown[] }[] = [];
    const workflows: WorkflowStarter = {
      async start(type, options) {
        calls.push({ type, ...options });
        return { started: true, workflowId: options.workflowId };
      },
      async close() {},
    };
    const followups = createFollowups({ db: hz.db, composer: null, workflows, log: silentLogger });
    const built = hz.build({ followups });
    const deliver = async (event: unknown) => {
      const body = JSON.stringify(event);
      const res = await built.app.request(BILLING_WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(SECRET, body, T) }, body });
      await followups.idle();
      return { status: res.status, body: await res.json() };
    };
    return { calls, deliver };
  }
  async function resumable(businessId: string, kind: "credits" | "subscription", createdBy: string) {
    const row = await repos.checkouts.create(hz.db, businessId, { kind, mode: "live", amountMinor: kind === "subscription" ? 500 : 2000, createdBy, resume: "continue" });
    return repos.checkouts.attachSession(hz.db, businessId, row.id, { mode: "live", externalId: `cs_test_${row.id.replace(/-/g, "").slice(0, 24)}`, checkoutUrl: "https://checkout.stripe.com/c/pay/x" });
  }
  const cycles = (calls: { type: string }[]) => calls.filter((c) => c.type === "businessCycle");
  beforeAll(async () => {
    // A clear Inbox: an item that holds Continue would (rightly) keep the paid round waiting for the founder.
    const items = await repos.inbox.list(hz.db, hz.B.businessId, { limit: 200 });
    for (const i of items.items) if (i.blocksContinue) await repos.inbox.archive(hz.db, hz.B.businessId, i.id, { force: true });
  });

  it("a paid checkout opened to unblock the next round starts it once; a replayed or repeated event starts nothing more", async () => {
    const c = await resumable(hz.B.businessId, "credits", hz.B.ownerId);
    const app = recordingApp();
    const event = sessionEvent("checkout.session.completed", c);
    expect((await app.deliver(event)).body).toMatchObject({ outcome: "granted" });
    const started = cycles(app.calls);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ workflowId: expect.stringMatching(new RegExp(`^cycle:${hz.B.businessId}:\\d+$`)), args: [{ businessId: hz.B.businessId, trigger: "continue" }] });
    const audit = await repos.audit.list(hz.db, hz.B.businessId, { action: "business.continue" });
    expect(audit.items.find((a) => (a.details as { checkoutId?: string }).checkoutId === c.id)).toMatchObject({ details: { trigger: "payment" } });
    // The same delivery again is a replay (409); the same payment under another event is a duplicate: no second round.
    expect((await app.deliver(event)).status).toBe(409);
    expect((await app.deliver(sessionEvent("checkout.session.async_payment_succeeded", c))).body).toMatchObject({ outcome: "duplicate" });
    expect(cycles(app.calls)).toHaveLength(1);
  });

  it("the entry plan paid from the first run's request starts the team; a round already queued is not doubled", async () => {
    const items = await repos.inbox.list(hz.db, hz.A.businessId, { limit: 200 });
    for (const i of items.items) if (i.blocksContinue) await repos.inbox.archive(hz.db, hz.A.businessId, i.id, { force: true });
    const c = await resumable(hz.A.businessId, "subscription", hz.A.ownerId);
    const app = recordingApp();
    const event = sessionEvent("checkout.session.completed", c, { mode: "subscription", subscription: "sub_test_resume", customer: "cus_test_resume", metadata: { foundmill_checkout_id: c.id, foundmill_business_id: c.businessId, foundmill_kind: "subscription" } });
    expect((await app.deliver(event)).body).toMatchObject({ outcome: "subscribed" });
    expect(cycles(app.calls)).toHaveLength(1);
    // A second paid checkout while that round is still queued starts nothing: the queued round picks the work up.
    const again = recordingApp();
    expect((await again.deliver(sessionEvent("checkout.session.completed", await resumable(hz.A.businessId, "credits", hz.A.ownerId)))).body).toMatchObject({ outcome: "granted" });
    expect(cycles(again.calls)).toEqual([]);
  });

  it("a canceled or expired checkout starts nothing and leaves the work waiting", async () => {
    const c = await resumable(hz.B.businessId, "credits", hz.B.ownerId);
    const app = recordingApp();
    expect((await app.deliver(sessionEvent("checkout.session.expired", c, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "expired" });
    expect((await app.deliver(sessionEvent("checkout.session.async_payment_failed", { ...(await resumable(hz.B.businessId, "credits", hz.B.ownerId)) }, { payment_status: "unpaid" }))).body).toMatchObject({ outcome: "failed" });
    expect(cycles(app.calls)).toEqual([]);
  });

  it("a checkout bought on its own (no resume) starts no round", async () => {
    const c = await liveCheckout(hz.B.businessId, 2000);
    const app = recordingApp();
    expect((await app.deliver(sessionEvent("checkout.session.completed", c))).body).toMatchObject({ outcome: "granted" });
    expect(cycles(app.calls)).toEqual([]);
  });
});

