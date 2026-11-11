/**
 * Paying Foundmill (audit 2026-10-12 #22): a top-up opens a real checkout through the gateway and grants nothing by
 * itself; a mock checkout is simulated by the api (no gateway, no vendor) and completed on the Billing tab (labeled)
 * exactly once; simulated payments exist only where ALLOW_MOCK_PAYMENTS allows them (by default development and test)
 * and their credits never fund a live model call (SEC2 S10); the platform's billing has its own live switch
 * (`stripe_billing`), apart from the businesses' Stripe connector; a live checkout cannot be completed from the api; a
 * gateway failure closes the row with a sentence the founder can act on; a paid tier cannot be chosen while its price is
 * to be announced.
 */
import { assertPlatformCredits, periodOf, platformCredits, repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { AppError } from "@foundmill/shared";
import type { ApiGatewayClient, GatewayCheckoutRequest } from "../services/gateway";
import { MOCK_PAYMENTS_OFF_MESSAGE } from "../services/payments";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const asked: GatewayCheckoutRequest[] = [];
let answerMode: "mock" | "live" = "mock";
let failWith: AppError | null = null;

const gateway: ApiGatewayClient = {
  connect: async () => {
    throw new Error("not in these tests");
  },
  health: async () => {
    throw new Error("not in these tests");
  },
  checkDomains: async () => {
    throw new Error("not in these tests");
  },
  generatePortrait: async () => {
    throw new Error("not in these tests");
  },
  repository: async () => {
    throw new Error("not in these tests");
  },
  sendPush: async () => {
    throw new Error("not in these tests");
  },
  validateKey: async () => {
    throw new Error("not in these tests");
  },
  registryLookup: async () => {
    throw new Error("not in these tests");
  },
  confirmFollow: async () => {
    throw new Error("not in these tests");
  },
  async createCheckout(input) {
    asked.push(input);
    if (failWith) throw failWith;
    const id = `cs_test_${input.checkoutId.replace(/-/g, "").slice(0, 20)}`;
    return { mode: answerMode, session: { id, url: answerMode === "live" ? `https://checkout.stripe.com/c/pay/${id}` : input.successUrl, expiresAt: "2026-10-13T15:00:00.000Z", amountTotalMinor: input.amountMinor, currency: "USD" } };
  },
};

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "paycheckout", gateway, env: { APP_URL: "https://foundmill.test" } });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => {
  asked.length = 0;
  answerMode = "mock";
  failWith = null;
  hz.limits.reset();
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};
/** A caller whose api runs with these env values (the harness itself is `test` with mock models). */
const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);
const owner = () => hz.caller({ userId: hz.A.ownerId, email: "owner@paycheckout.test" });
// What the business can spend this month: the balance row, or what its tier includes before the month's first row (a
// top-up that comes first starts the row with the included credits).
const balanceOf = async (businessId: string) => Number((await platformCredits(hz.db, await repos.businesses.get(hz.db, businessId), new Date().toISOString().slice(0, 7))).balanceMinor);

describe("billing.topUp (mock)", () => {
  it("opens a simulated checkout without the gateway, grants nothing, and sends the founder to it", async () => {
    const before = await balanceOf(hz.A.businessId);
    const r = await owner().billing.topUp({ businessId: hz.A.businessId, amountMinor: 5000 });
    expect(r).toMatchObject({ mode: "mock", label: "Mock checkout (no money moves)", checkout: { status: "open", amountMinor: 5000, currency: "USD" } });
    expect(r.checkoutUrl).toBe(`https://foundmill.test/b/${hz.A.businessId}/settings/billing?checkout=${r.checkout.id}`);
    // No vendor is called in mock mode, so the gateway is not either (the e2e, CI and local stacks run without one).
    expect(asked).toHaveLength(0);
    expect(await repos.checkouts.get(hz.db, hz.A.businessId, r.checkout.id)).toMatchObject({ mode: "mock", externalId: expect.stringMatching(/^cs_mock_/), checkoutUrl: r.checkoutUrl });
    expect(await balanceOf(hz.A.businessId)).toBe(before);
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "billing.checkout_started" });
    expect(audit.items.find((a) => (a.target as { id?: string }).id === r.checkout.id)).toMatchObject({ actorKind: "user", actorId: hz.A.ownerId });
  });

  it("completeMock grants the credits once, labeled; the status shows it paid", async () => {
    const before = await balanceOf(hz.A.businessId);
    const r = await owner().billing.topUp({ businessId: hz.A.businessId, amountMinor: 2500 });
    const done = await owner().billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: r.checkout.id });
    expect(done).toMatchObject({ granted: true, label: "Mock top-up (no money moved)", checkout: { status: "paid" } });
    expect(await balanceOf(hz.A.businessId)).toBe(before + 2500);
    const again = await owner().billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: r.checkout.id });
    expect(again.granted).toBe(false);
    expect(await balanceOf(hz.A.businessId)).toBe(before + 2500);
    const status = await hz.caller({ userId: hz.A.adminId }).billing.checkout.status({ businessId: hz.A.businessId, checkoutId: r.checkout.id });
    expect(status).toMatchObject({ checkout: { status: "paid", mode: "mock" }, label: "Mock top-up (no money moved)" });
  });

  it("only the owner opens or completes a checkout; another business's checkout is not found", async () => {
    const r = await owner().billing.topUp({ businessId: hz.A.businessId, amountMinor: 2500 });
    expect(await code(hz.caller({ userId: hz.A.adminId }).billing.topUp({ businessId: hz.A.businessId, amountMinor: 2500 }))).toBe("FORBIDDEN");
    expect(await code(hz.caller({ userId: hz.A.memberId }).billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: r.checkout.id }))).toBe("FORBIDDEN");
    expect(await code(hz.caller({ userId: hz.B.ownerId }).billing.checkout.completeMock({ businessId: hz.B.businessId, checkoutId: r.checkout.id }))).toBe("NOT_FOUND");
    expect(await code(hz.caller({ userId: hz.B.ownerId }).billing.checkout.status({ businessId: hz.B.businessId, checkoutId: r.checkout.id }))).toBe("NOT_FOUND");
    expect(await code(owner().billing.topUp({ businessId: hz.A.businessId, amountMinor: 100 }))).toBe("BAD_REQUEST");
  });

  it("never funds live model calls with simulated money outside development and test", async () => {
    const staging = callerWith({ APP_ENV: "staging", MODEL_MODE: "live" }, { userId: hz.A.ownerId });
    const plan = await staging.billing.plan({ businessId: hz.A.businessId });
    expect(plan.topUp).toMatchObject({ mode: "mock", available: false, reason: MOCK_PAYMENTS_OFF_MESSAGE });
    await expect(staging.billing.topUp({ businessId: hz.A.businessId, amountMinor: 5000 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: MOCK_PAYMENTS_OFF_MESSAGE });
    expect(asked).toHaveLength(0);
    // A mock checkout opened earlier cannot be completed there either.
    const r = await owner().billing.topUp({ businessId: hz.A.businessId, amountMinor: 2500 });
    expect(await code(staging.billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: r.checkout.id }))).toBe("PRECONDITION_FAILED");
    // The api's own MODEL_MODE is not the test (the orchestrator may run live sessions on the platform key): outside
    // development and test simulated payments need ALLOW_MOCK_PAYMENTS (SEC2 S10).
    expect((await callerWith({ APP_ENV: "staging", MODEL_MODE: "mock" }, { userId: hz.A.ownerId }).billing.plan({ businessId: hz.A.businessId })).topUp.available).toBe(false);
    expect((await callerWith({ APP_ENV: "staging", MODEL_MODE: "mock", ALLOW_MOCK_PAYMENTS: true }, { userId: hz.A.ownerId }).billing.plan({ businessId: hz.A.businessId })).topUp.available).toBe(true);
    expect((await callerWith({ APP_ENV: "test", ALLOW_MOCK_PAYMENTS: false }, { userId: hz.A.ownerId }).billing.plan({ businessId: hz.A.businessId })).topUp.available).toBe(false);
  });

  it("where simulated payments are on, their credits never pay for a live model call (SEC2 S10)", async () => {
    const userId = await hz.h.createUser("mock-only@test.local");
    const business = await repos.businesses.create(hz.db, { name: "Mock Only Credits", createdBy: userId, planTier: "scale" });
    await repos.memberships.add(hz.db, business.id, { userId, role: "owner" });
    const flagged = callerWith({ APP_ENV: "staging", MODEL_MODE: "live", ALLOW_MOCK_PAYMENTS: true }, { userId });
    // The month opened with nothing included (the founder's pool was used): a top-up that opens a period also grants the tier's included credits.
    await repos.usage.ensurePeriodCredits(hz.db, business.id, periodOf(new Date()), 0);
    const r = await flagged.billing.topUp({ businessId: business.id, amountMinor: 2500 });
    expect(r).toMatchObject({ mode: "mock", label: "Mock checkout (no money moves)" });
    await flagged.billing.checkout.completeMock({ businessId: business.id, checkoutId: r.checkout.id });
    // The only credits this month came from the simulation: labeled on the plan, refused for a live call, fine for a mock one.
    const plan = await flagged.billing.plan({ businessId: business.id });
    expect(plan.credits).toMatchObject({ balanceMinor: 2500, mockMinor: 2500 });
    await expect(assertPlatformCredits(hz.db, business.id, { live: true })).rejects.toMatchObject({ code: "credits_exhausted", details: { reason: "mock_only" } });
    await expect(assertPlatformCredits(hz.db, business.id, { live: false })).resolves.toMatchObject({ ok: true });
  });
});

describe("billing.topUp (live)", () => {
  /** Staging with live models and the platform's billing switched live, while every connector (Stripe included) stays mock. */
  const liveBilling = { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe_billing", APP_ENV: "staging", MODEL_MODE: "live" } as const;

  it("answers with Stripe's page; the api never completes a live checkout (the webhook does)", async () => {
    answerMode = "live";
    const live = callerWith(liveBilling, { userId: hz.A.ownerId, email: "owner@paycheckout.test" });
    expect((await live.billing.plan({ businessId: hz.A.businessId })).topUp).toMatchObject({ mode: "live", available: true });
    const r = await live.billing.topUp({ businessId: hz.A.businessId, amountMinor: 10_000 });
    expect(r).toMatchObject({ mode: "live", label: null, checkout: { status: "open", mode: "live" } });
    expect(r.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    expect(asked).toEqual([
      expect.objectContaining({ businessId: hz.A.businessId, checkoutId: r.checkout.id, kind: "credits", amountMinor: 10_000, currency: "USD", customerEmail: "owner@paycheckout.test", successUrl: `https://foundmill.test/b/${hz.A.businessId}/settings/billing?checkout=${r.checkout.id}`, cancelUrl: expect.stringContaining("canceled=1") }),
    ]);
    expect(await code(live.billing.checkout.completeMock({ businessId: hz.A.businessId, checkoutId: r.checkout.id }))).toBe("BAD_REQUEST");
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, r.checkout.id)).externalId).toMatch(/^cs_test_/);
    // INTEGRATIONS_MODE=live takes real payments too.
    expect((await callerWith({ INTEGRATIONS_MODE: "live", APP_ENV: "production", MODEL_MODE: "live" }, { userId: hz.A.ownerId }).billing.plan({ businessId: hz.A.businessId })).topUp).toMatchObject({ mode: "live", available: true });
  });

  it("the businesses' own Stripe connector going live does not take real payments", async () => {
    const plan = await callerWith({ ...liveBilling, LIVE_CONNECTORS: "stripe" }, { userId: hz.A.ownerId }).billing.plan({ businessId: hz.A.businessId });
    expect(plan.topUp).toMatchObject({ mode: "mock", available: false, reason: MOCK_PAYMENTS_OFF_MESSAGE });
  });

  it("a gateway that refuses closes the row and says what to do", async () => {
    failWith = new AppError("payments_unconfigured", "Payments are not set up on this server yet (STRIPE_SECRET_KEY is missing on the gateway)", 503);
    await expect(callerWith(liveBilling, { userId: hz.A.ownerId }).billing.topUp({ businessId: hz.A.businessId, amountMinor: 5000 })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: expect.stringMatching(/^Payments are not set up on this server yet\. Use your own Anthropic key/) });
    const [latest] = await repos.checkouts.listRecent(hz.db, hz.A.businessId, 1);
    expect(latest).toMatchObject({ status: "failed", failure: expect.stringMatching(/not set up/) });
    // A gateway that unexpectedly answers mock where mock payments are off is refused the same way.
    failWith = null;
    answerMode = "mock";
    await expect(callerWith(liveBilling, { userId: hz.A.ownerId }).billing.topUp({ businessId: hz.A.businessId, amountMinor: 5000 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await repos.checkouts.listRecent(hz.db, hz.A.businessId, 1))[0]).toMatchObject({ status: "failed", mode: "live" });
  });
});

describe("billing.changeTier", () => {
  it("refuses a paid tier while its price is to be announced, outside development and test; Free is always allowed", async () => {
    const staging = callerWith({ APP_ENV: "staging" }, { userId: hz.B.ownerId });
    const plan = await staging.billing.plan({ businessId: hz.B.businessId });
    expect(plan.tierChanges).toEqual([
      { tier: "free", available: true, reason: null },
      { tier: "pro", available: false, reason: expect.stringMatching(/^Price to be announced: paid tiers open once their prices are set/) },
      { tier: "scale", available: false, reason: expect.stringMatching(/^Price to be announced/) },
    ]);
    for (const tier of ["pro", "scale"] as const) await expect(staging.billing.changeTier({ businessId: hz.B.businessId, tier })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/Price to be announced/) });
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).planTier).toBe("free");
    // Production refuses the same way; development and test switch freely (seeded demos, tests).
    expect(await code(callerWith({ APP_ENV: "production" }, { userId: hz.B.ownerId }).billing.changeTier({ businessId: hz.B.businessId, tier: "scale" }))).toBe("PRECONDITION_FAILED");
    await hz.caller({ userId: hz.B.ownerId }).billing.changeTier({ businessId: hz.B.businessId, tier: "pro" });
    // Moving down to Free needs no payment, anywhere.
    await staging.billing.changeTier({ businessId: hz.B.businessId, tier: "free" });
    expect((await repos.businesses.get(hz.db, hz.B.businessId)).planTier).toBe("free");
  });
});
