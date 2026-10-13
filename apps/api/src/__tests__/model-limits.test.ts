/**
 * Allowances on every model-backed procedure (SEC-13, audit 2026-10-12 #31): each procedure spends from its own rule and
 * from the shared ceiling, per person and per business; a full window answers TOO_MANY_REQUESTS with a sentence the
 * founder can act on and calls no model; a request refused before the model gets its hit back; Inbox Refresh, plan
 * previews, task planning, the recommenders, foundations retries, training, Continue, registry lookups, Compare and the
 * Studio are all covered; plan.preview needs Inbox write.
 */
import { repos } from "@foundmill/db";
import { MockModelClient, type ModelClient } from "@foundmill/models";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "../router";
import { IDEATION_LIMITS, takeIdeationAllowance } from "../services/ideation";
import { MODEL_LIMITS, modelLimitEntries, SHARED_MODEL_LIMITS, type ModelLimitName } from "../services/model-limits";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let models: MockModelClient;
let original: ModelClient;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "modellimits" });
  original = hz.deps.models;
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => {
  hz.limits.reset();
  models = new MockModelClient();
  hz.deps.models = models;
});

const as = (userId: string, email: string | null = null) => createCaller({ ...hz.deps, models }, { userId, email });
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    return { code: err.code, message: err.message };
  }
};

/** Fills every window of `name`'s own rule for `who` ("user" or "business"), as earlier requests would have. */
async function fill(name: ModelLimitName | "shared", scope: { userId: string; businessId?: string }, who: "user" | "business") {
  const rule = name === "shared" ? SHARED_MODEL_LIMITS : MODEL_LIMITS[name];
  const windows: readonly { limit: number; windowMs: number }[] = (who === "user" ? ("user" in rule ? rule.user : undefined) : "business" in rule ? rule.business : undefined) ?? [];
  const id = who === "user" ? scope.userId : scope.businessId!;
  for (const w of windows) for (let i = 0; i < w.limit; i++) await hz.limits.take([{ key: `model:${name}:${who}:${w.windowMs}:${id}`, rule: w }]);
}

describe("modelLimitEntries", () => {
  it("spends the rule's windows and the shared ceiling, for the person and, inside a business, the business", () => {
    const keys = modelLimitEntries("plan", { userId: "u1", businessId: "b1" }).map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["model:plan:user:60000:u1", "model:plan:business:3600000:b1", "model:shared:user:60000:u1", "model:shared:business:3600000:b1"]));
    expect(modelLimitEntries("ideation", { userId: "u1" }).every((e) => e.key.startsWith("model:shared:user:"))).toBe(true);
  });
});

describe("each model-backed procedure is limited", () => {
  const A = () => hz.A.businessId;
  const cases: { name: ModelLimitName; who: "user" | "business"; call: () => Promise<unknown> }[] = [
    { name: "refresh", who: "user", call: () => as(hz.A.ownerId).inbox.refresh({ businessId: A() }) },
    { name: "refresh", who: "business", call: () => as(hz.A.memberId).inbox.refresh({ businessId: A() }) },
    { name: "plan", who: "user", call: () => as(hz.A.ownerId).plan.preview({ businessId: A(), text: "Pause the ads for a week" }) },
    { name: "planner", who: "business", call: () => as(hz.A.ownerId).dev.tasks.plan({ businessId: A(), goal: "Ship the signup page" }) },
    { name: "recommend", who: "user", call: () => as(hz.A.ownerId).legal.recommend({ businessId: A() }) },
    { name: "recommend", who: "business", call: () => as(hz.A.ownerId).distribution.recommend({ businessId: A() }) },
    { name: "foundations", who: "business", call: () => as(hz.A.ownerId).product.foundations.retry({ businessId: A() }) },
    { name: "training", who: "business", call: () => as(hz.A.ownerId).agent.training.run({ businessId: A(), agentId: hz.A.agentId, versionId: hz.A.agentVersionId }) },
    { name: "training", who: "user", call: () => as(hz.A.ownerId).agent.model.set({ businessId: A(), agentId: hz.A.agentId, modelKey: "sonnet" }) },
    { name: "continue", who: "business", call: () => as(hz.A.ownerId).business.continue({ businessId: A() }) },
    { name: "lookup", who: "user", call: () => as(hz.A.ownerId).legal.import.lookup({ businessId: A(), country: "gb", regNo: "12345678" }) },
    { name: "domains", who: "user", call: () => as(hz.A.ownerId).idea.domainCheck({ name: "Ledgerly" }) },
  ];
  for (const c of cases) {
    it(`${c.name} (${c.who})`, async () => {
      await fill(c.name, { userId: hz.A.ownerId, businessId: A() }, c.who);
      expect(await refusal(c.call())).toEqual({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(new RegExp(`^${MODEL_LIMITS[c.name].what} limit reached\\. Try again in (a minute|\\d+ minutes)\\.$`)) });
      expect(models.history).toHaveLength(0);
    });
  }

  it("the Studio, Compare and Ask spend the shared ceiling; Compare also spends a draft", async () => {
    const userId = await hz.h.createUser("studio-limits@test.local");
    await as(userId).founder.profile.update({ displayName: "Ana", experience: "operator", skills: { sales: 12 }, targetMarkets: ["EU"], riskAppetite: "low" });
    const ideas = (await as(userId).idea.generate({ prompt: "a newsletter" })).ideas;
    // Compare takes a draft from the drafting allowance (no business to book the Opus call to).
    hz.limits.reset();
    for (let i = 0; i < IDEATION_LIMITS.hour.limit; i++) await takeIdeationAllowance(hz.limits, userId);
    const before = models.history.length;
    expect(await refusal(as(userId).idea.compare({ ideaIds: ideas.slice(0, 2).map((i) => i.id) }))).toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^Drafting limit reached/) });
    expect(models.history).toHaveLength(before);
    // The shared ceiling stops the rest of the Studio too (the message names what the founder pressed).
    hz.limits.reset();
    await fill("shared", { userId }, "user");
    const studio: [() => Promise<unknown>, RegExp][] = [
      [() => as(userId).idea.generate({ prompt: "x" }), /^Drafting limit reached/],
      [() => as(userId).idea.compare({ ideaIds: ideas.slice(0, 2).map((i) => i.id) }), /^Drafting limit reached/],
      [() => as(userId).idea.ask({ ideaId: ideas[0]!.id, question: "Who pays?" }), /^Conversation limit reached/],
    ];
    for (const [call, message] of studio) expect(await refusal(call())).toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(message) });
    expect(models.history).toHaveLength(before);
  });

  it("the person and the business are separate: another member keeps their own allowance", async () => {
    await fill("plan", { userId: hz.A.ownerId }, "user");
    expect((await refusal(as(hz.A.ownerId).plan.preview({ businessId: hz.A.businessId, text: "Pause ads" })))?.code).toBe("TOO_MANY_REQUESTS");
    expect(await refusal(as(hz.A.memberId).plan.preview({ businessId: hz.A.businessId, text: "Pause ads" }))).toBeNull();
  });
});

describe("refunds and conditions", () => {
  it("a request refused before the model (bad input) gets its hit back", async () => {
    const limit = MODEL_LIMITS.planner.user[0]!.limit;
    for (let i = 0; i < limit + 3; i++) expect((await refusal(as(hz.A.ownerId).dev.tasks.plan({ businessId: hz.A.businessId })))?.code).toBe("BAD_REQUEST");
    expect(await refusal(as(hz.A.ownerId).dev.tasks.plan({ businessId: hz.A.businessId, goal: "Ship the pricing page" }))).toBeNull();
  });

  it("deciding with an option spends nothing; deciding with free text spends the planning allowance", async () => {
    const item = () =>
      repos.inbox.createItem(hz.db, hz.A.businessId, {
        type: "decision",
        from_agent_id: hz.A.agentId,
        subject: "Which channel first?",
        body_md: "The team needs a steer on the first channel. Outbound is the recommended route for a narrow ICP.",
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: {
          options: [
            { id: "outbound", label: "Outbound to a narrow ICP", recommended: true, consequence: "Lead generation starts first.", cost_minor: 25000, reversible: true },
            { id: "content", label: "Content first", recommended: false, consequence: "SEO and content start first.", cost_minor: 0, reversible: true },
          ],
          free_text: true,
          expires_at: null,
        },
        blocks_continue: true,
        source_event_ids: [],
        entity_ids: [],
      });
    await fill("plan", { userId: hz.A.ownerId }, "user");
    expect(await refusal(as(hz.A.ownerId).inbox.decide({ businessId: hz.A.businessId, itemId: (await item()).id, chosenOption: "outbound" }))).toBeNull();
    expect(await refusal(as(hz.A.ownerId).inbox.decide({ businessId: hz.A.businessId, itemId: (await item()).id, freeText: "Do outbound but cap it at $200" }))).toMatchObject({ code: "TOO_MANY_REQUESTS", message: expect.stringMatching(/^Planning limit reached/) });
  });

  it("plan.preview needs Inbox write: a viewer cannot loop it on the platform key", async () => {
    expect((await refusal(as(hz.A.viewerId).plan.preview({ businessId: hz.A.businessId, text: "Pause ads" })))?.code).toBe("FORBIDDEN");
    expect(models.history).toHaveLength(0);
  });
});

afterAll(() => {
  if (hz) hz.deps.models = original;
});
