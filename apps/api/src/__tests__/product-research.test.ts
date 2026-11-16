/**
 * The Product Researcher's plan (BUILD §11.5 Research tab; the founder's 2026-10-18 request): once a new business's
 * foundations are ready, `product.research.ensure` claims the plan exactly once and drafts it in the api: artifacts on
 * Product › Research, the first research tasks for the cycles, the researcher's Inbox note and the event, all in one
 * transaction. A failure is readable and retried; viewers and other businesses' members cannot start it.
 */
import { RESEARCH_PLAN_KINDS } from "@foundmill/models";
import { productResearch, repos } from "@foundmill/db";
import { MockModelClient, ModelUnavailableError, type ModelClient } from "@foundmill/models";
import { DIGEST_SUBJECT } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settleFoundationRuns } from "../services/foundations";
import { RESEARCH_LOCAL_CONCURRENCY, acquireResearchSlot, researchSlots, runResearchPlanLocally, settleResearchRuns } from "../services/product-research";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "research" });
}, 120_000);
afterAll(() => hz?.close());

async function founder(email: string) {
  const userId = await hz.h.createUser(email);
  const caller = hz.caller({ userId, email });
  await caller.founder.profile.update({ confirmAdult: true, displayName: "Reid", experience: "first-time", skills: { engineering: 14, sales: 8 }, targetMarkets: ["Nordics"], constraints: ["bootstrapped"], riskAppetite: "medium", budgetMinor: 2_500_000 });
  return { userId, caller };
}

/** A Door A business with its foundations drafted (the mock drafts in-process). */
async function committed(email: string, options: { foundations?: boolean } = {}) {
  const f = await founder(email);
  const generated = await f.caller.idea.generate({ prompt: "bookkeeping for independent accountants in the Nordics" });
  const result = await f.caller.idea.commit({ ideaId: generated.ideas[0]!.id, name: "Ledgerly Research", archetype: "b2b_saas", gameMode: "personal" });
  const businessId = result.business.id;
  if (options.foundations !== false) {
    await f.caller.product.foundations.ensure({ businessId });
    await settleFoundationRuns();
  }
  return { ...f, businessId, result };
}

describe("product.research — the plan after the foundations", () => {
  let a: Awaited<ReturnType<typeof committed>>;
  beforeAll(async () => {
    a = await committed("research-a@test.local", { foundations: false });
  });

  it("before the foundations are ready, ensure records the ask and starts nothing", async () => {
    const view = await a.caller.product.research.ensure({ businessId: a.businessId });
    expect(view).toMatchObject({ status: "pending", attempt: 0, started: false });
    expect(Object.keys(view).sort()).toEqual(["attempt", "finishedAt", "started", "startedAt", "status"]);
    expect(await a.caller.product.research.get({ businessId: a.businessId })).toMatchObject({ status: "pending", artifacts: [], agent: null });
    // The Product Researcher was hired at Take charge, into the Product department.
    const agents = await repos.agents.list(hz.db, a.businessId, { agentType: "product_researcher", limit: 5 });
    expect(agents.items).toHaveLength(1);
    const product = (await repos.departments.list(hz.db, a.businessId)).find((d) => d.moduleKeys.includes("product"))!;
    expect(agents.items[0]!.departmentIds).toContain(product.id);
  });

  it("once the foundations are ready the first ensure claims the drafting exactly once, even from two tabs", async () => {
    await a.caller.product.foundations.ensure({ businessId: a.businessId });
    await settleFoundationRuns();
    const [one, two] = await Promise.all([a.caller.product.research.ensure({ businessId: a.businessId }), a.caller.product.research.ensure({ businessId: a.businessId })]);
    expect([one.started, two.started].filter(Boolean)).toHaveLength(1);
    expect((one.started ? one : two)).toMatchObject({ status: "drafting", attempt: 1 });
    expect((await a.caller.product.research.ensure({ businessId: a.businessId })).started).toBe(false);
    await settleResearchRuns();
    expect(await a.caller.product.research.ensure({ businessId: a.businessId })).toMatchObject({ status: "ready", attempt: 1, started: false });
    const audit = await repos.audit.list(hz.db, a.businessId, { limit: 100 });
    expect(audit.items.filter((e) => e.action === "product.research.start")).toHaveLength(1);
    expect(audit.items.filter((e) => e.action === "product.research.ready")).toHaveLength(1);
  });

  it("ready: one artifact per plan kind as drafts, the ICP from the Customers section, attributed to the Product Researcher", async () => {
    const view = await a.caller.product.research.get({ businessId: a.businessId });
    expect(view.status).toBe("ready");
    expect(view.artifacts.map((x) => x.kind)).toEqual([...RESEARCH_PLAN_KINDS]);
    expect(view.artifacts.every((x) => x.status === "draft" && x.bodyMd.length > 100)).toBe(true);
    expect(view.icp.length).toBeGreaterThan(10);
    const researcher = (await repos.agents.list(hz.db, a.businessId, { agentType: "product_researcher", limit: 1 })).items[0]!;
    expect(view.agent).toEqual({ id: researcher.id, name: researcher.name });
    expect(view.artifacts.every((x) => x.createdByAgentId === researcher.id)).toBe(true);
    expect(view.summary).toMatchObject({ model: { route: "worker", mode: "mock", costLabel: "Estimate" } });
    expect((view.summary as { assumptions: unknown[] }).assumptions.length).toBeGreaterThanOrEqual(3);
    // Every threshold the plan states is labeled; nothing in it is an instruction to contact anyone.
    const smoke = view.artifacts.find((x) => x.kind === "smoke_test")!;
    expect(smoke.bodyMd).toMatch(/\(Estimate\)/);
    // The one worker call is booked to the business's usage ledger, to the researcher.
    const usage = await repos.usage.list(hz.db, a.businessId, { kind: "tokens", limit: 200 });
    const booked = usage.items.filter((u) => (u.details as { kind?: string }).kind === "research_plan");
    expect(booked).toHaveLength(1);
    expect(booked[0]!.agentId).toBe(researcher.id);
  });

  it("writes the first research tasks for the cycles, the researcher's note and the events in the same transaction", async () => {
    const view = await a.caller.product.research.get({ businessId: a.businessId });
    const researcher = view.agent!;
    const product = (await repos.departments.list(hz.db, a.businessId)).find((d) => d.moduleKeys.includes("product"))!;
    const tasks = await repos.tasks.list(hz.db, a.businessId, { kind: "research", assigneeAgentId: researcher.id, limit: 50 });
    const taskIds = (view.summary as { firstStepTaskIds: string[] }).firstStepTaskIds;
    expect(taskIds.length).toBeGreaterThanOrEqual(2);
    expect(taskIds.length).toBeLessThanOrEqual(4);
    for (const id of taskIds) {
      const t = tasks.items.find((x) => x.id === id)!;
      expect(t).toMatchObject({ status: "ready", departmentId: product.id, kind: "research" });
      expect((t.acceptance as string[]).length).toBeGreaterThanOrEqual(1);
      expect(t.goalMd).toContain("founder's approval");
    }
    // In the project's first week the researcher's update is folded (WP-04 T8): kept in Archive, listed in the Chief of
    // Staff's "What your team did today".
    const inbox = await a.caller.inbox.list({ businessId: a.businessId, tab: "archive", limit: 50 });
    const notes = inbox.items.filter((i) => i.subject.startsWith("How we'll test the specification with"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "update", blocksContinue: false, fromAgentId: researcher.id });
    const digest = (await a.caller.inbox.list({ businessId: a.businessId, limit: 50 })).items.find((i) => i.subject === DIGEST_SUBJECT);
    expect(digest?.bodyMd).toContain(notes[0]!.subject);
    const words = notes[0]!.bodyMd.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(60);
    expect(words).toBeLessThanOrEqual(180);
    expect((view.summary as { inboxItemId: string }).inboxItemId).toBe(notes[0]!.id);
    const drafted = await repos.events.list(hz.db, a.businessId, { type: "product.research_drafted" });
    expect(drafted.items).toHaveLength(1);
    expect(drafted.items[0]!.payload).toMatchObject({ attempt: 1, agentId: researcher.id, inboxItemId: notes[0]!.id, taskIds, artifactIds: view.artifacts.map((x) => x.id) });
    const created = await repos.events.list(hz.db, a.businessId, { type: "inbox.item_created" });
    expect(created.items.some((e) => (e.payload as { inboxItemId?: string }).inboxItemId === notes[0]!.id)).toBe(true);
  });

  it("the team marks an artifact ready or shared and archives it; a viewer cannot; retry refuses a ready plan", async () => {
    const view = await a.caller.product.research.get({ businessId: a.businessId });
    const survey = view.artifacts.find((x) => x.kind === "survey")!;
    expect((await a.caller.product.research.artifacts.update({ businessId: a.businessId, artifactId: survey.id, status: "ready" })).status).toBe("ready");
    const viewerId = await hz.h.createUser("rp-viewer@test.local");
    await repos.memberships.add(hz.db, a.businessId, { userId: viewerId, role: "viewer" });
    await expect(hz.caller({ userId: viewerId }).product.research.artifacts.update({ businessId: a.businessId, artifactId: survey.id, status: "shared" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await hz.caller({ userId: viewerId }).product.research.get({ businessId: a.businessId })).artifacts.find((x) => x.id === survey.id)?.status).toBe("ready");
    await a.caller.product.research.artifacts.archive({ businessId: a.businessId, artifactId: survey.id });
    expect((await a.caller.product.research.get({ businessId: a.businessId })).artifacts.map((x) => x.id)).not.toContain(survey.id);
    await expect(a.caller.product.research.retry({ businessId: a.businessId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const audit = await repos.audit.list(hz.db, a.businessId, { limit: 100 });
    expect(audit.items.map((e) => e.action)).toEqual(expect.arrayContaining(["product.research.artifact.update", "product.research.artifact.archive"]));
  });

  it("members of another business cannot read, start or change it; a business without foundations reports none", async () => {
    const outsider = hz.caller({ userId: hz.B.ownerId });
    await expect(outsider.product.research.get({ businessId: a.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.product.research.ensure({ businessId: a.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const view = await a.caller.product.research.get({ businessId: a.businessId });
    await expect(outsider.product.research.artifacts.update({ businessId: hz.B.businessId, artifactId: view.artifacts[0]!.id, status: "shared" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.product.research.ensure({ businessId: hz.A.businessId })).toMatchObject({ status: "none", started: false });
    await expect(owner.product.research.retry({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("product.research — who starts it, failure and retry", () => {
  it("a viewer who opens first leaves it pending; the founder's open starts it", async () => {
    const b = await committed("research-b@test.local");
    const viewerId = await hz.h.createUser("rp-b-viewer@test.local");
    await repos.memberships.add(hz.db, b.businessId, { userId: viewerId, role: "viewer" });
    expect(await hz.caller({ userId: viewerId }).product.research.ensure({ businessId: b.businessId })).toMatchObject({ status: "pending", started: false });
    expect(await b.caller.product.research.ensure({ businessId: b.businessId })).toMatchObject({ status: "drafting", started: true });
    await settleResearchRuns();
    expect(await hz.caller({ userId: viewerId }).product.research.get({ businessId: b.businessId })).toMatchObject({ status: "ready" });
  });

  it("a failed drafting shows a readable reason, keeps nothing half-written, and a retry drafts it", async () => {
    const c = await committed("research-c@test.local");
    const working = hz.deps.models;
    hz.deps.models = new MockModelClient({ failWith: { worker: new ModelUnavailableError("upstream 529 overloaded, request req_456") } });
    try {
      // A caller built after the swap reads the failing client (the harness hands deps to each caller as it is made).
      const caller = hz.caller({ userId: c.userId });
      expect(await caller.product.research.ensure({ businessId: c.businessId })).toMatchObject({ started: true });
      await settleResearchRuns();
      const failed = await caller.product.research.get({ businessId: c.businessId });
      expect(failed).toMatchObject({ status: "failed", attempt: 1, error: "The model service did not answer. Try again in a few minutes.", artifacts: [] });
      expect(failed.error).not.toContain("req_456");
      expect(await caller.product.research.ensure({ businessId: c.businessId })).toMatchObject({ status: "failed", started: false });
      expect((await repos.tasks.list(hz.db, c.businessId, { kind: "research", limit: 50 })).items.filter((t) => t.goalMd.includes("research plan"))).toHaveLength(0);
    } finally {
      hz.deps.models = working;
    }
    const retried = await c.caller.product.research.retry({ businessId: c.businessId });
    expect(retried).toMatchObject({ status: "drafting", attempt: 2, started: true, error: null });
    await settleResearchRuns();
    expect(await c.caller.product.research.get({ businessId: c.businessId })).toMatchObject({ status: "ready", attempt: 2 });
  });

  it("an attempt that never finished is reported as interrupted and can be retried", async () => {
    const d = await committed("research-d@test.local");
    await repos.research.ensureRow(hz.db, d.businessId);
    await hz.db.update(productResearch).set({ status: "drafting", attempt: 1, startedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(productResearch.businessId, d.businessId));
    expect(await d.caller.product.research.get({ businessId: d.businessId })).toMatchObject({ status: "drafting", stale: true });
    expect(await d.caller.product.research.ensure({ businessId: d.businessId })).toMatchObject({ status: "failed", started: false });
    expect(await d.caller.product.research.get({ businessId: d.businessId })).toMatchObject({ error: expect.stringMatching(/interrupted/) });
    expect(await d.caller.product.research.retry({ businessId: d.businessId })).toMatchObject({ started: true, attempt: 2 });
    await settleResearchRuns();
    expect(await d.caller.product.research.get({ businessId: d.businessId })).toMatchObject({ status: "ready" });
  });

  it("a stopped team starts nothing; the plan waits for the resume", async () => {
    const e = await committed("research-e@test.local");
    await e.caller.business.stopAllAgents({ businessId: e.businessId });
    expect(await e.caller.product.research.ensure({ businessId: e.businessId })).toMatchObject({ status: "pending", started: false });
    await e.caller.business.resumeAgents({ businessId: e.businessId });
    expect(await e.caller.product.research.ensure({ businessId: e.businessId })).toMatchObject({ started: true });
    await settleResearchRuns();
  });

  it("each run is bounded: a timed-out run fails with a readable reason and at most a few run at once", async () => {
    const f = await committed("research-f@test.local");
    await repos.research.ensureRow(hz.db, f.businessId);
    await repos.research.claim(hz.db, f.businessId);
    const seen: (AbortSignal | undefined)[] = [];
    const hanging = {
      mode: "mock" as const,
      complete: (req: { signal?: AbortSignal }) => {
        seen.push(req.signal);
        return new Promise((_resolve, reject) => req.signal?.addEventListener("abort", () => reject(req.signal!.reason), { once: true }));
      },
    } as unknown as ModelClient;
    await runResearchPlanLocally({ db: hz.db, models: hanging, log: hz.deps.log }, f.businessId, 1, { timeoutMs: 50 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.aborted).toBe(true);
    expect(await f.caller.product.research.get({ businessId: f.businessId })).toMatchObject({ status: "failed", error: "The research plan took too long and was stopped. Try again." });
    const releases: (() => void)[] = [];
    for (let i = 0; i < RESEARCH_LOCAL_CONCURRENCY; i++) releases.push(await acquireResearchSlot(AbortSignal.timeout(5_000)));
    const waiting = acquireResearchSlot(AbortSignal.timeout(5_000));
    await new Promise((r) => setTimeout(r, 10));
    expect(researchSlots()).toEqual({ active: RESEARCH_LOCAL_CONCURRENCY, waiting: 1 });
    releases[0]!();
    (await waiting)();
    for (const r of releases.slice(1)) r();
    expect(researchSlots()).toEqual({ active: 0, waiting: 0 });
  });
});
