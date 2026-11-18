/**
 * The ceiling on the platform's Anthropic key (SEC2): every model call the api makes for a business asks the credits
 * gate first, so once the month's credits are used up Refresh, conversations, plan previews and free-text decisions are
 * refused before any call (402, a sentence to act on), on credits or on the business's own key (S2); a task start
 * counts against the plan's concurrent agents (S2); an allowance is given back only when no model was called, and a
 * free-text decision a section wall refuses is refused before the plan compiler when the rule engine already sees the
 * wall (S3); the allow-list trusts an address only when the token shows it is confirmed (S11).
 */
import { TIERS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { gateModelClient, MockModelClient, type CompleteRequest, type CompleteResult, type ModelClient } from "@foundmill/models";
import { TRPCError } from "@trpc/server";
import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createAuthVerifier, emailConfirmedFromPayload } from "../auth";
import { createCaller } from "../router";
import { EMAIL_UNCONFIRMED_MESSAGE } from "../services/access";
import { createComposerClient } from "../services/composer";
import { noteModelCall, withModelCallScope } from "../services/model-calls";
import { MODEL_LIMITS } from "../services/model-limits";
import { apiCreditsGate } from "../services/models";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ceiling", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => hz.limits.reset());

const period = () => new Date().toISOString().slice(0, 7);
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    return { code: err.code, appCode: (err.cause as { code?: string } | undefined)?.code, message: err.message };
  }
};
/** Uses up the business's credits for this month (the balance row, at zero). */
async function useUpCredits(businessId: string) {
  await repos.usage.chargeCredits(hz.db, businessId, period(), 10_000_000, { includedMinor: 500 });
}
const ledgerRows = async (businessId: string) => (await repos.usage.list(hz.db, businessId, { limit: 200 })).items.length;
const decisionItem = (businessId: string, agentId: string) =>
  repos.inbox.createItem(hz.db, businessId, {
    type: "decision",
    from_agent_id: agentId,
    subject: "Which launch plan?",
    body_md: "The team needs a steer on the launch plan for next month.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: "soft", label: "A soft launch", recommended: true, consequence: "A quiet start with the waitlist.", cost_minor: 0, reversible: true },
        { id: "loud", label: "A loud launch", recommended: false, consequence: "Press and a launch event.", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: false,
    source_event_ids: [],
    entity_ids: [],
  });

describe("the credits gate on the api's model calls (S2)", () => {
  it("after the month's credits are used up, Refresh, a conversation, a plan preview and a free-text decision are refused before any call", async () => {
    const B = hz.B.businessId;
    const owner = hz.caller({ userId: hz.B.ownerId });
    // While credits are left the calls run, and are booked.
    await owner.plan.preview({ businessId: B, text: "Pause the ads for a week" });
    expect(await ledgerRows(B)).toBeGreaterThan(0);

    await useUpCredits(B);
    const before = await ledgerRows(B);
    const item = await decisionItem(B, hz.B.agentId);
    const refusals = await Promise.all([
      refusal(owner.inbox.refresh({ businessId: B })),
      refusal(owner.agent.conversation.send({ businessId: B, subject: { kind: "agent", id: hz.B.agentId }, text: "How is the launch going?" })),
      refusal(owner.plan.preview({ businessId: B, text: "Pause the ads for a week" })),
      refusal(owner.inbox.decide({ businessId: B, itemId: item.id, freeText: "Start the soft launch next Monday" })),
    ]);
    for (const r of refusals) expect(r).toMatchObject({ code: "PAYMENT_REQUIRED", appCode: "credits_exhausted", message: expect.stringMatching(/^This month's credits are used up, so Foundmill makes no more model calls for this business\. To keep going, add your own Anthropic key in Settings › Keys/) });
    // Nothing was spent: no ledger row, and the decision is still open.
    expect(await ledgerRows(B)).toBe(before);
    expect((await repos.inbox.get(hz.db, B, item.id)).state).not.toBe("answered");
    // A refusal before any model call gives the allowance back: the planning allowance is untouched.
    for (let i = 0; i < MODEL_LIMITS.plan.user[0]!.limit + 2; i++) expect((await refusal(owner.plan.preview({ businessId: B, text: "Pause the ads" })))?.code).toBe("PAYMENT_REQUIRED");
  });

  it("a business on its own key pays for the api's platform-key calls with its credits too: storing a key does not lift the ceiling", async () => {
    const A = hz.A.businessId;
    await repos.businesses.update(hz.db, A, { modelBilling: "byok" });
    try {
      const owner = hz.caller({ userId: hz.A.ownerId });
      await owner.plan.preview({ businessId: A, text: "Pause the ads for a week" });
      const charged = await repos.usage.creditBalance(hz.db, A, period());
      // A free business's call runs on Haiku 5.5 (WP-13) and costs a fraction of a cent: whole cents plus the carry.
      expect(Number(charged?.spentMinor) * 1_000_000 + Number(charged?.carryMicroMinor ?? 0)).toBeGreaterThan(0);
      await useUpCredits(A);
      expect(await refusal(owner.plan.preview({ businessId: A, text: "Pause the ads for a week" }))).toMatchObject({ code: "PAYMENT_REQUIRED", message: expect.stringMatching(/Your agents keep working on your own Anthropic key\. To keep going, wait for next month's credits on [A-Z][a-z]{2} 1, \d{4}\.$/) });
      // The plan shows those credits for a business on its own key as well.
      expect((await owner.billing.plan({ businessId: A })).credits).toMatchObject({ balanceMinor: 0, exhausted: true });
    } finally {
      await repos.businesses.update(hz.db, A, { modelBilling: "credits" });
      await repos.usage.grantCredits(hz.db, A, period(), 100_000);
    }
  });
});

describe("dev.tasks.start counts against the plan's concurrent agents (S2)", () => {
  it("refuses a start once every agent the tier runs at once is working, with the upgrade error; a finished session frees the place", async () => {
    const A = hz.A.businessId;
    const member = hz.caller({ userId: hz.A.memberId });
    const open = (await repos.agents.listSessions(hz.db, A, { openOnly: true, limit: 100 })).items.length;
    const filler = [];
    for (let i = open; i < TIERS.free.maxConcurrentAgents; i++) filler.push(await repos.agents.createSession(hz.db, A, { agentId: hz.A.agentId }));
    const task = await repos.tasks.create(hz.db, A, { kind: "ops", title: "One task too many", status: "ready", assigneeAgentId: hz.A.agent2Id });
    const refused = await refusal(member.dev.tasks.start({ businessId: A, taskId: task.id }));
    expect(refused).toMatchObject({ code: "FORBIDDEN", appCode: "tier_limit", message: expect.stringMatching(/^The Free plan runs 4 agents at once and all of them are working\./) });
    expect((await repos.tasks.get(hz.db, A, task.id)).status).toBe("ready");
    expect((await repos.agents.listSessions(hz.db, A, { taskId: task.id, limit: 5 })).items).toHaveLength(0);
    for (const s of filler) await repos.agents.endSession(hz.db, A, s.id, { outcome: "done" });
    const started = await member.dev.tasks.start({ businessId: A, taskId: task.id });
    expect(started.workflow.workflowId).toBe(`session:${started.session.id}`);
  });
});

/** A plan compiler that always turns on paid ads, whatever the text says (the rule engine sees no wall in the text). */
function paidAdsPlanner(): ModelClient & { compiles: number } {
  const mock = new MockModelClient();
  const client = {
    mode: "mock" as const,
    compiles: 0,
    async complete(req: CompleteRequest<unknown>): Promise<CompleteResult<unknown>> {
      const out = await mock.complete(req as CompleteRequest<unknown> & { schema?: undefined });
      if (req.route !== "planCompiler") return out;
      client.compiles += 1;
      return { ...out, json: { summary: "Turn on paid ads.", actions: [{ type: "enable_channel", params: { channel: "paid_ads" }, agent_id: null }] } } as CompleteResult<unknown>;
    },
  };
  return client as ModelClient & { compiles: number };
}

describe("allowances are given back only when no model was called (S3)", () => {
  it("a call counts for its request's scope and every scope around it; outside a scope nothing is counted", async () => {
    noteModelCall();
    const { result, scope: outer } = await withModelCallScope(async () => {
      const { scope: inner } = await withModelCallScope(async () => {
        noteModelCall();
        await Promise.resolve();
        noteModelCall();
      });
      // A sibling request running at the same time has its own count.
      const [{ scope: sibling }] = await Promise.all([withModelCallScope(async () => undefined), Promise.resolve().then(noteModelCall)]);
      return { inner: inner.calls, sibling: sibling.calls };
    });
    expect(result).toEqual({ inner: 2, sibling: 0 });
    expect(outer.calls).toBe(3);
  });

  it("Refresh: the composer's credits refusal gives the hit back; a composer failure that may follow a model call keeps it", async () => {
    const B = hz.B.businessId;
    const answer = (status: number, body: Record<string, unknown>) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const withComposer = (fetch: typeof globalThis.fetch) => createCaller({ ...hz.deps, composer: createComposerClient({ url: "http://composer.test", db: hz.db, models: hz.deps.models, log: hz.deps.log, allowFallback: false, fetch }) }, { userId: hz.B.ownerId });
    const refused = withComposer(answer(402, { error: "credits_exhausted", message: "This month's credits are used up.", details: { reason: "exhausted" } }));
    const limit = MODEL_LIMITS.refresh.user[0]!.limit;
    for (let i = 0; i < limit + 2; i++) expect(await refusal(refused.inbox.refresh({ businessId: B }))).toMatchObject({ code: "PAYMENT_REQUIRED", appCode: "credits_exhausted" });
    // Any other refusal from the composer spends the hit, even one whose code is given back before a model call in
    // the api (409): the api cannot tell whether the composer called a model first.
    const failing = withComposer(answer(409, { error: "no_agents", message: "The business has no agents to write from" }));
    for (let i = 0; i < limit; i++) expect((await refusal(failing.inbox.refresh({ businessId: B })))?.code).toBe("CONFLICT");
    expect((await refusal(failing.inbox.refresh({ businessId: B })))?.code).toBe("TOO_MANY_REQUESTS");
  });

  it("a walled member looping free-text decisions the compiled plan is refused for spends the planning allowance", async () => {
    const A = hz.A.businessId;
    await repos.memberships.setSectionPermissions(hz.db, A, hz.A.memberId, { distribution: "read" });
    const planner = paidAdsPlanner();
    // The production wiring: the credits gate notes each call on the request.
    const member = createCaller({ ...hz.deps, models: gateModelClient(planner, apiCreditsGate(hz.db, false)) }, { userId: hz.A.memberId });
    const item = await decisionItem(A, hz.A.agentId);
    const limit = MODEL_LIMITS.plan.user[0]!.limit;
    for (let i = 0; i < limit; i++) expect(await refusal(member.inbox.decide({ businessId: A, itemId: item.id, freeText: "Handle the launch the way we planned" }))).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/write access to distribution/) });
    expect(planner.compiles).toBe(limit);
    // Each refusal came after an Opus compile, so none was given back: the next one is over the allowance.
    expect(await refusal(member.inbox.decide({ businessId: A, itemId: item.id, freeText: "Handle the launch the way we planned" }))).toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^Planning limit reached/) });
    expect(planner.compiles).toBe(limit);
    await repos.memberships.setSectionPermissions(hz.db, A, hz.A.memberId, {});
  });

  it("what the rule engine already sees in the text is refused before the plan compiler, and that refusal costs nothing", async () => {
    const A = hz.A.businessId;
    await repos.memberships.setSectionPermissions(hz.db, A, hz.A.memberId, { distribution: "read" });
    const planner = paidAdsPlanner();
    const member = createCaller({ ...hz.deps, models: gateModelClient(planner, apiCreditsGate(hz.db, false)) }, { userId: hz.A.memberId });
    const item = await decisionItem(A, hz.A.agentId);
    for (let i = 0; i < MODEL_LIMITS.plan.user[0]!.limit + 3; i++) expect(await refusal(member.inbox.decide({ businessId: A, itemId: item.id, freeText: "Turn on paid ads for the launch" }))).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/write access to distribution/) });
    expect(planner.compiles).toBe(0);
    // Someone with write access decides it (the model compiles the plan).
    const owner = createCaller({ ...hz.deps, models: gateModelClient(planner, apiCreditsGate(hz.db, false)) }, { userId: hz.A.ownerId });
    await expect(owner.inbox.decide({ businessId: A, itemId: item.id, freeText: "Turn on paid ads for the launch" })).resolves.toMatchObject({ plan: { actions: [expect.objectContaining({ type: "enable_channel" })] } });
    expect(planner.compiles).toBe(1);
    await repos.memberships.setSectionPermissions(hz.db, A, hz.A.memberId, {});
  });
});

describe("the allow-list trusts a confirmed address only (S11)", () => {
  const secret = new TextEncoder().encode("spend-ceiling-test-jwt-secret-0123456789");
  const sign = (claims: Record<string, unknown>, sub: string) => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(secret);
  const now = () => Math.floor(Date.now() / 1000);

  it("reads confirmation from the token: an inbox-proving sign-in only; never an anonymous one, never the user-writable user_metadata", () => {
    expect(emailConfirmedFromPayload({ email: "a@x.test", user_metadata: { email_verified: true } })).toBe(false);
    expect(emailConfirmedFromPayload({ email: "a@x.test", amr: [{ method: "password", timestamp: now() }], user_metadata: { email_verified: true } })).toBe(false);
    expect(emailConfirmedFromPayload({ email: "a@x.test", amr: [{ method: "magiclink", timestamp: now() }] })).toBe(true);
    expect(emailConfirmedFromPayload({ email: "a@x.test", amr: [{ method: "otp", timestamp: now() }] })).toBe(true);
    expect(emailConfirmedFromPayload({ email: "a@x.test", amr: [{ method: "password", timestamp: now() }] })).toBe(false);
    expect(emailConfirmedFromPayload({ email: "a@x.test", amr: [{ method: "oauth", timestamp: now() }], user_metadata: { email_verified: false } })).toBe(false);
    expect(emailConfirmedFromPayload({ email: "a@x.test", is_anonymous: true, amr: [{ method: "otp", timestamp: now() }] })).toBe(false);
    expect(emailConfirmedFromPayload({ amr: [{ method: "otp", timestamp: now() }] })).toBe(false);
    expect(emailConfirmedFromPayload({ email: "", amr: [{ method: "otp", timestamp: now() }] })).toBe(false);
  });

  it("over HTTP: a listed address is refused until the token shows it confirmed; an anonymous sign-in and a self-written user_metadata never pass", async () => {
    const auth = createAuthVerifier({ appEnv: "production", hsKey: secret });
    const deps = { ...hz.deps, auth, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "owner@ceiling.test" } };
    const app = createApp(deps);
    const call = async (token: string) => {
      const res = await app.request("/trpc/founder.preferences.get", { headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json()) as { error?: { json: { message: string; data: { appCode?: string; details?: { reason?: string } } } } };
      return { status: res.status, message: body.error?.json.message, appCode: body.error?.json.data.appCode, reason: body.error?.json.data.details?.reason };
    };
    // An oauth sign-in that is not Google's proves nothing about the inbox. (A password session is refused before the
    // list is read: the product never issues one, auth.ts `passwordOnlyFromPayload`.)
    const unconfirmed = await call(await sign({ email: "owner@ceiling.test", amr: [{ method: "oauth", timestamp: now() }] }, hz.A.ownerId));
    expect(unconfirmed).toEqual({ status: 403, message: EMAIL_UNCONFIRMED_MESSAGE, appCode: "not_invited", reason: "email_unconfirmed" });
    expect((await call(await sign({ email: "owner@ceiling.test", amr: [{ method: "password", timestamp: now() }] }, hz.A.ownerId))).status).toBe(401);
    const anonymous = await call(await sign({ email: "owner@ceiling.test", is_anonymous: true, amr: [{ method: "anonymous", timestamp: now() }], user_metadata: { email_verified: true } }, hz.A.ownerId));
    expect(anonymous).toMatchObject({ status: 403, appCode: "not_invited", reason: "email_unconfirmed" });
    const forged = await call(await sign({ email: "owner@ceiling.test", amr: [{ method: "oauth", timestamp: now() }], user_metadata: { email_verified: true } }, hz.A.ownerId));
    expect(forged).toMatchObject({ status: 403, appCode: "not_invited", reason: "email_unconfirmed" });
    const stranger = await call(await sign({ email: "someone@else.test", amr: [{ method: "magiclink", timestamp: now() }] }, hz.A.ownerId));
    expect(stranger).toMatchObject({ status: 403, appCode: "not_invited", reason: "not_listed" });
    expect((await call(await sign({ email: "owner@ceiling.test", amr: [{ method: "magiclink", timestamp: now() }] }, hz.A.ownerId))).status).toBe(200);
    expect((await call(await sign({ email: "owner@ceiling.test", amr: [{ method: "otp", timestamp: now() }] }, hz.A.ownerId))).status).toBe(200);
    // Without a list nothing about the address is checked.
    const open = createApp({ ...deps, env: { ...deps.env, SIGNUP_ALLOWLIST: undefined } });
    const res = await open.request("/trpc/founder.preferences.get", { headers: { authorization: `Bearer ${await sign({ email: "owner@ceiling.test", amr: [{ method: "oauth", timestamp: now() }] }, hz.A.ownerId)}` } });
    expect(res.status).toBe(200);
  });
});
