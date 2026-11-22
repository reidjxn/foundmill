/**
 * The $5 entry plan and the credit packs (WP-09 T16; founder, 2026-11-17), behind `PAID_ENTRY`. With the switch off
 * nothing is offered and nothing is gated. With it on: the plan is a subscription checkout the owner opens (and, in mock
 * mode, completes with the simulated payment); until an owner holds it, Continue and Autopilot are refused with the
 * way to subscribe, and an approval starts no cycle; top-ups are the packs only; a pack bought by an owner removes the
 * "Built on" mark. A simulated plan never opens live work.
 */
import { CREDIT_PACKS_MINOR, ENTRY_PLAN } from "@foundmill/config";
import { ENTRY_PLAN_REQUEST_SUBJECT, markBilling, repos, showsBuiltOnMark } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { ENTRY_PLAN_REQUEST_BODY, ENTRY_PLAN_REQUIRED_MESSAGE, entryPlanOpen } from "../services/payments";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  const temporal = { workflow: { start: async () => ({}), signalWithStart: async () => ({}), getHandle: () => ({ signal: async () => undefined, describe: async () => ({ status: { name: "RUNNING" } }) }) } };
  hz = await createApiHarness({ prefix: "entryplan", temporalClient: temporal, env: { APP_URL: "https://foundmill.test" } });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => hz.limits.reset());

const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);
const paid = (user: CallerUser) => callerWith({ PAID_ENTRY: true }, user);
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof TRPCError ? { code: err.code, message: err.message } : { code: "other", message: String(err) };
  }
};

describe("with PAID_ENTRY off (invitation-only and free)", () => {
  it("offers nothing, gates nothing and sells any top-up amount", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    const plan = await owner.billing.plan({ businessId: hz.B.businessId });
    expect(plan.entryPlan).toBeNull();
    expect(await failure(owner.billing.subscribe({ businessId: hz.B.businessId }))).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await entryPlanOpen(hz.db, hz.deps.env, hz.B.businessId)).toBe(true);
    expect((await owner.billing.topUp({ businessId: hz.B.businessId, amountMinor: 1000 })).checkout).toMatchObject({ amountMinor: 1000, creditsMinor: null });
  });
});

describe("with PAID_ENTRY on", () => {
  it("refuses Continue and every other way agents start without the plan, with the way to subscribe", async () => {
    const owner = paid({ userId: hz.A.ownerId });
    expect(await failure(owner.business.continue({ businessId: hz.A.businessId }))).toEqual({ code: "PAYMENT_REQUIRED", message: ENTRY_PLAN_REQUIRED_MESSAGE });
    // The refusal is the request: one note in the Inbox says what is bought and what it costs, written once.
    expect(await failure(owner.business.continue({ businessId: hz.A.businessId }))).toMatchObject({ code: "PAYMENT_REQUIRED" });
    const requests = await repos.inbox.openBySubject(hz.db, hz.A.businessId, ENTRY_PLAN_REQUEST_SUBJECT);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ blocksContinue: false, bodyMd: ENTRY_PLAN_REQUEST_BODY });
    expect(await failure(owner.business.setBusinessMode({ businessId: hz.A.businessId, businessMode: "automated" }))).toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(await failure(paid({ userId: hz.A.adminId }).business.startHoliday({ businessId: hz.A.businessId, until: { kind: "return" } }))).toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(await failure(owner.business.autopilot.set({ businessId: hz.A.businessId, enabled: true }))).toEqual({ code: "PAYMENT_REQUIRED", message: ENTRY_PLAN_REQUIRED_MESSAGE });
    const plan = await owner.billing.plan({ businessId: hz.A.businessId });
    expect(plan.entryPlan).toMatchObject({ name: ENTRY_PLAN.name, priceMonthlyMinor: 500, includedCreditsMinor: 500, open: false, mine: null, available: true });
    expect(plan.entryPlan?.packs.map((p) => p.priceMinor)).toEqual([...CREDIT_PACKS_MINOR]);
    expect(plan.topUp.options).toEqual([...CREDIT_PACKS_MINOR]);
  });

  it("the plan goes first for every model call inside a project on the platform key; an own-key project skips it", async () => {
    const owner = paid({ userId: hz.A.ownerId });
    expect(await failure(owner.inbox.refresh({ businessId: hz.A.businessId }))).toEqual({ code: "PAYMENT_REQUIRED", message: ENTRY_PLAN_REQUIRED_MESSAGE });
    expect(await failure(owner.plan.preview({ businessId: hz.A.businessId, text: "Ship the page" }))).toMatchObject({ code: "PAYMENT_REQUIRED" });
    // The request is still said once.
    expect(await repos.inbox.openBySubject(hz.db, hz.A.businessId, ENTRY_PLAN_REQUEST_SUBJECT)).toHaveLength(1);
    // With the switch off, or on the founder's own key, the plan is not asked for (whatever the call then does).
    expect((await failure(hz.caller({ userId: hz.A.ownerId }).inbox.refresh({ businessId: hz.A.businessId })))?.code).not.toBe("PAYMENT_REQUIRED");
    await repos.businesses.update(hz.db, hz.A.businessId, { modelBilling: "byok" });
    try {
      expect((await failure(owner.inbox.refresh({ businessId: hz.A.businessId })))?.code).not.toBe("PAYMENT_REQUIRED");
    } finally {
      await repos.businesses.update(hz.db, hz.A.businessId, { modelBilling: "credits" });
    }
  });

  it("only the owner subscribes; the simulated payment opens the project's AI runs once", async () => {
    expect(await failure(paid({ userId: hz.A.adminId }).billing.subscribe({ businessId: hz.A.businessId }))).toMatchObject({ code: "FORBIDDEN" });
    const owner = paid({ userId: hz.A.ownerId });
    const opened = await owner.billing.subscribe({ businessId: hz.A.businessId, resume: "continue" });
    // A second press while it is open goes back to the same checkout, never to a second subscription.
    expect((await owner.billing.subscribe({ businessId: hz.A.businessId })).checkout.id).toBe(opened.checkout.id);
    expect(opened).toMatchObject({ mode: "mock", label: "Mock checkout (no money moves)", checkout: { kind: "subscription", amountMinor: ENTRY_PLAN.priceMonthlyMinor, status: "open" } });
    const balanceBefore = await repos.usage.creditBalance(hz.db, hz.A.businessId, new Date().toISOString().slice(0, 7));
    const done = await owner.billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: opened.checkout.id });
    expect(done).toMatchObject({ subscribed: true, granted: false, checkout: { status: "paid" } });
    // The pay-and-resume loop: the checkout came from the request at Continue, so the team started with no second press,
    // and the request left the Inbox.
    expect(done.continued).toMatchObject({ started: true });
    expect(await repos.inbox.openBySubject(hz.db, hz.A.businessId, ENTRY_PLAN_REQUEST_SUBJECT)).toEqual([]);
    // The plan grants no credits of its own: the month's included credits are its $5.
    expect(await repos.usage.creditBalance(hz.db, hz.A.businessId, new Date().toISOString().slice(0, 7))).toEqual(balanceBefore);
    const again = await owner.billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: opened.checkout.id });
    expect(again.subscribed).toBe(false);
    expect(again.continued).toBeNull();
    expect(await entryPlanOpen(hz.db, { ...hz.deps.env, PAID_ENTRY: true }, hz.A.businessId)).toBe(true);
    expect((await owner.billing.plan({ businessId: hz.A.businessId })).entryPlan).toMatchObject({ open: true, mine: { status: "active" } });
    // A second subscription is refused while the first is active.
    expect(await failure(owner.billing.subscribe({ businessId: hz.A.businessId }))).toMatchObject({ code: "BAD_REQUEST" });
    // Continue is no longer refused for the plan (whatever the cycle then does).
    const pressed = await failure(owner.business.continue({ businessId: hz.A.businessId }));
    expect(pressed?.code).not.toBe("PAYMENT_REQUIRED");
  });

  it("a simulated plan never opens live work", async () => {
    expect(await entryPlanOpen(hz.db, { ...hz.deps.env, PAID_ENTRY: true, LIVE_CONNECTORS: "stripe_billing" }, hz.A.businessId)).toBe(false);
    expect(await entryPlanOpen(hz.db, { ...hz.deps.env, PAID_ENTRY: true, MODEL_MODE: "live" }, hz.A.businessId)).toBe(false);
    expect(await entryPlanOpen(hz.db, { ...hz.deps.env, PAID_ENTRY: true, ALLOW_MOCK_PAYMENTS: false }, hz.A.businessId)).toBe(false);
  });

  it("a canceled checkout leaves the work waiting and the request in place", async () => {
    const owner = paid({ userId: hz.B.ownerId });
    expect(await failure(owner.business.continue({ businessId: hz.B.businessId }))).toMatchObject({ code: "PAYMENT_REQUIRED" });
    const opened = await owner.billing.subscribe({ businessId: hz.B.businessId, resume: "continue" });
    await repos.checkouts.markExpired(hz.db, hz.B.businessId, opened.checkout.id);
    expect(await entryPlanOpen(hz.db, { ...hz.deps.env, PAID_ENTRY: true }, hz.B.businessId)).toBe(false);
    expect(await repos.inbox.openBySubject(hz.db, hz.B.businessId, ENTRY_PLAN_REQUEST_SUBJECT)).toHaveLength(1);
    // Pressing again opens a new checkout (the expired one is not reused) and the request is still said once.
    expect((await owner.billing.subscribe({ businessId: hz.B.businessId, resume: "continue" })).checkout.id).not.toBe(opened.checkout.id);
    expect(await failure(owner.business.continue({ businessId: hz.B.businessId }))).toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(await repos.inbox.openBySubject(hz.db, hz.B.businessId, ENTRY_PLAN_REQUEST_SUBJECT)).toHaveLength(1);
  });

  it("sells top-ups as the packs only; an owner's pack removes the Built on mark", async () => {
    const owner = paid({ userId: hz.B.ownerId });
    expect(await failure(owner.billing.topUp({ businessId: hz.B.businessId, amountMinor: 1000 }))).toMatchObject({ code: "BAD_REQUEST" });
    const business = await repos.businesses.get(hz.db, hz.B.businessId);
    const billing = markBilling({ ...hz.deps.env, PAID_ENTRY: true });
    expect(await showsBuiltOnMark(hz.db, business, billing)).toBe(true);
    const pack = await owner.billing.topUp({ businessId: hz.B.businessId, amountMinor: 2000 });
    expect(await showsBuiltOnMark(hz.db, business, billing)).toBe(true);
    expect((await owner.billing.checkout.completeMock({ businessId: hz.B.businessId, checkoutId: pack.checkout.id })).granted).toBe(true);
    expect(await showsBuiltOnMark(hz.db, business, billing)).toBe(false);
    // With the switch off the mark keeps the plan's rule only (the free plan shows it).
    expect(await showsBuiltOnMark(hz.db, business, markBilling(hz.deps.env))).toBe(true);
  });

  it("commit creates the project with its drafts but starts no cycle and no Autopilot without the plan", async () => {
    const email = "entry-commit@test.local";
    const userId = await hz.h.createUser(email);
    const me = paid({ userId, email });
    await me.founder.profile.update({ displayName: "Newcomer", timeCommitment: "full_time", residence: "United States", experience: "first_time", skills: { marketing: 8 }, targetMarkets: ["US"], riskAppetite: "medium", budgetMinor: 50_000, confirmAdult: true });
    const [idea] = (await me.idea.generate({ prompt: "meal plans for night-shift nurses" })).ideas;
    const done = await me.idea.commit({ ideaId: idea!.id, name: "Night Meals", archetype: "b2b_saas", autopilot: true });
    expect(done.business).toBeTruthy();
    expect(done.cycle).toBeNull();
    expect(done.autopilot).toBeNull();
    expect((await repos.businesses.get(hz.db, done.business.id)).autopilotEnabled).toBe(false);
  });

  it("canceling is one press, as subscribing is: the simulated plan cancels and the gate closes again", async () => {
    const owner = paid({ userId: hz.A.ownerId });
    expect((await owner.billing.plan({ businessId: hz.A.businessId })).entryPlan).toMatchObject({ mine: { status: "active" } });
    expect(await owner.billing.manage({ businessId: hz.A.businessId })).toMatchObject({ mode: "mock", canceled: true, url: null });
    expect(await entryPlanOpen(hz.db, { ...hz.deps.env, PAID_ENTRY: true }, hz.A.businessId)).toBe(false);
    expect(await failure(owner.billing.manage({ businessId: hz.A.businessId }))).toMatchObject({ code: "BAD_REQUEST" });
    // Subscribing again is open once more.
    expect((await owner.billing.subscribe({ businessId: hz.A.businessId })).checkout).toMatchObject({ kind: "subscription", status: "open" });
  });
});
