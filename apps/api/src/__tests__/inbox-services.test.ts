/**
 * The Inbox's decision and plan services after the audit (W13): what choosing a costed option runs and asks, option
 * clicks that run typed actions instead of parsed prose, plans that follow the acting agent's own policy, plans whose
 * dispatch did not reach Temporal, exactly-once confirmation, and who may decide what.
 */
import { getArchetypeSeed } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { agents, agentVersions, businesses, departments, repos, type Business } from "@foundmill/db";
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { MockModelClient, type CompleteRequest, type ModelClient } from "@foundmill/models";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importBoardDecision, importBoardDecisionFromReport } from "../services/commit";
import { buildScoutingReport } from "../services/import";
import { compilePlan, evaluatePlan, ownAgentsOnly, planAgents, redispatchPlans, SPEND_ALLOWANCE_ASK, SPEND_ALLOWANCE_POLICY_ID, type PlanContext } from "../services/plans";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
/** While set, `planExecution` starts fail as an unreachable Temporal would. */
let temporalDown = false;
const flaky = {
  ...temporal,
  workflow: {
    ...temporal.workflow,
    async start(type: string, options: { workflowId: string; taskQueue: string; args?: unknown[] }) {
      if (temporalDown) throw new Error("14 UNAVAILABLE: connection refused");
      return temporal.workflow.start(type, options);
    },
  },
};

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "inbox-services", temporalClient: flaky });
}, 120_000);
afterAll(() => hz.close());

interface Team extends BusinessFixture {
  leadGen: string;
  productLead: string;
  planner: string;
  distribution: string;
  finance: string;
}

/** A business with the agents and departments a Board decision names, and a Product Lead that must not get channel work. */
async function team(slug: string): Promise<Team> {
  const F = await createBusinessFixture(hz.h, slug);
  const [productLead, planner, leadGen] = await hz.db
    .insert(agents)
    .values([
      { businessId: F.businessId, name: "Ines Ortega", role: "Product Lead", agentType: "product_lead", layer: "lead", departmentIds: [F.departmentId] },
      { businessId: F.businessId, name: "Kai Moreau", role: "Planner", agentType: "planner", layer: "worker" },
      { businessId: F.businessId, name: "Lead Generation Engine", role: "Lead generation specialist", agentType: "channel_lead_generation", layer: "worker" },
    ])
    .returning({ id: agents.id });
  const [distribution, finance] = await hz.db
    .insert(departments)
    .values([
      { businessId: F.businessId, name: "Go to market", slug: "go-to-market", moduleKeys: ["distribution"] },
      { businessId: F.businessId, name: "Money", slug: "money", moduleKeys: ["finance"] },
      { businessId: F.businessId, name: "Build", slug: "build", moduleKeys: ["development"] },
      { businessId: F.businessId, name: "Operations", slug: "operations", moduleKeys: ["team"] },
    ])
    .returning({ id: departments.id });
  return { ...F, productLead: productLead!.id, planner: planner!.id, leadGen: leadGen!.id, distribution: distribution!.id, finance: finance!.id };
}

/** The Board's first decision for an archetype, written the way Commit writes it. */
async function boardItem(t: Team, archetype: "b2b_saas" | "consumer_app" | "content_media" | "hardware") {
  const seed = getArchetypeSeed(archetype);
  return repos.inbox.createItem(hz.db, t.businessId, {
    type: "decision",
    from_agent_id: t.agentId,
    subject: seed.boardDecision.subject,
    body_md: seed.boardDecision.bodyMd,
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: { options: seed.boardDecision.options.map((o) => ({ id: o.id, label: o.label, recommended: o.recommended, consequence: o.consequence, ...(o.because ? { because: o.because } : {}), cost_minor: o.costMinor, reversible: o.reversible, actions: o.actions })), free_text: true, expires_at: null },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

const owner = (t: BusinessFixture) => hz.caller({ userId: t.ownerId });

describe("choosing a costed option (audit FR-10, OL-11)", () => {
  it("carries the cost into the plan as a budget policy checks, and asks before anything runs", async () => {
    const t = await team("costed-option");
    const item = await boardItem(t, "b2b_saas");
    // The Board's recommended option keeps its reason ("because", UX plan §7.19) through the Composer schema; the others have none.
    const options = (item.decision as { options: { recommended: boolean; because?: string }[] }).options;
    expect(options.find((o) => o.recommended)?.because).toMatch(/^Recommended because /);
    expect(options.filter((o) => !o.recommended).every((o) => o.because === undefined)).toBe(true);
    const r = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "outbound" });

    const budget = r.plan.actions.find((a) => a.type === "set_budget");
    expect(budget?.params).toMatchObject({ channel: "lead_generation", amount_minor: LIMITS.approvalThresholdMinorDefault * 2, decided_option: "outbound" });
    expect(budget?.policyOutcome).toBe("ask");
    // Twice the approval threshold: "Here is what will happen" first, with nothing started.
    expect(r.requiresConfirmation).toBe(true);
    expect(r.plan.status).toBe("pending_confirmation");
    expect(r.executed).toEqual([]);
    expect((await repos.tasks.list(hz.db, t.businessId, { kind: "channel", limit: 50 })).items).toEqual([]);
    expect(r.followUp).toBeNull();
  });

  it("an option that costs nothing runs at once; a costed one runs when the founder confirms", async () => {
    const t = await team("free-option");
    const item = await boardItem(t, "b2b_saas");
    const free = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "design_partners" });
    expect(free.requiresConfirmation).toBe(false);
    expect(free.plan.actions.map((a) => a.type)).toEqual(["create_task", "create_task"]);
    expect(free.plan.status).toBe("done");

    const costed = await boardItem(t, "b2b_saas");
    const asked = await owner(t).inbox.decide({ businessId: t.businessId, itemId: costed.id, chosenOption: "inbound" });
    expect(asked.requiresConfirmation).toBe(false);
    const outbound = await boardItem(t, "b2b_saas");
    const pending = await owner(t).inbox.decide({ businessId: t.businessId, itemId: outbound.id, chosenOption: "outbound" });
    const confirmed = await owner(t).plan.confirm({ businessId: t.businessId, planId: pending.plan.id });
    expect(confirmed.exec.executed.length).toBe(pending.plan.actions.length);
    const channel = await repos.channels.getByKey(hz.db, t.businessId, "lead_generation");
    expect(channel).toMatchObject({ enabled: true, budgetMinor: LIMITS.approvalThresholdMinorDefault * 2 });
  });
});

describe("option clicks run what the option says (audit IAE-20, AC-01, FR-20, VAC-X1)", () => {
  it("a channel's work goes to the agent that runs the channel, work to the template it names, each in its department", async () => {
    const t = await team("typed-option");
    const item = await boardItem(t, "b2b_saas");
    const pending = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "outbound" });
    await owner(t).plan.confirm({ businessId: t.businessId, planId: pending.plan.id });

    const tasks = (await repos.tasks.list(hz.db, t.businessId, { limit: 200 })).items;
    const prospects = tasks.find((x) => x.title === "Build the first prospect list");
    // The Lead Generation Engine, never whichever role has "Lead" in its title (the Product Lead).
    expect(prospects?.assigneeAgentId).toBe(t.leadGen);
    expect(prospects?.assigneeAgentId).not.toBe(t.productLead);
    expect(prospects?.departmentId).toBe(t.distribution);
    const demo = tasks.find((x) => x.title === "Build the demo path outbound needs");
    expect(demo?.assigneeAgentId).toBe(t.planner);
    // No task is titled after a fragment of the option's consequence.
    expect(tasks.some((x) => /^(?:the |lead generation and )/i.test(x.title))).toBe(false);
  });

  it("a task with no channel lands in its agent's department, else the department of its kind of work", async () => {
    const t = await team("task-department");
    const item = await boardItem(t, "b2b_saas");
    await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "design_partners" });
    const tasks = (await repos.tasks.list(hz.db, t.businessId, { limit: 200 })).items;
    const guide = tasks.find((x) => x.title === "Design-partner interview guide");
    expect(guide?.assigneeAgentId).toBe(t.productLead);
    expect(guide?.departmentId).toBe(t.departmentId);

    const free = await owner(t).inbox.decide({
      businessId: t.businessId,
      itemId: (await boardItem(t, "hardware")).id,
      chosenOption: "waitlist",
    });
    expect(free.plan.status).not.toBe("failed");
    const after = (await repos.tasks.list(hz.db, t.businessId, { limit: 200 })).items;
    expect(after.filter((x) => x.title.length > 0 && x.departmentId === null)).toEqual([]);
  });

  it("the follow-up reports each action as it ended, not as it began (audit VRUI-X1)", async () => {
    const t = await team("followup-status");
    const item = await boardItem(t, "b2b_saas");
    const r = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "design_partners" });
    expect(r.followUp?.bodyMd).toContain("— done");
    expect(r.followUp?.bodyMd).not.toContain("— pending");
    expect(r.followUp?.bodyMd).toMatch(/2 done now, 0 handed to the team\./);
  });
});

describe("the import's first decisions run what they say (audit IAE-20, SOAK-11)", () => {
  it("rebuilding the specification is the Product Lead's spec task, not a task titled after the consequence", async () => {
    const t = await team("import-board");
    const report = buildScoutingReport([{ key: "github", value: "acme/ledgerly" }, { key: "stripe", value: "" }]);
    expect(report.firstDecisions.every((d) => (d.actions?.length ?? 0) > 0)).toBe(true);
    const board = importBoardDecision("Ledgerly", { jobId: "job", status: { job: { sources: [{ key: "github" }, { key: "stripe" }] } }, report } as never)!;
    const item = await repos.inbox.createItem(hz.db, t.businessId, {
      type: "decision",
      from_agent_id: t.agentId,
      subject: board.subject,
      body_md: board.bodyMd,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: { options: board.options.map((o) => ({ id: o.id, label: o.label, recommended: o.recommended, consequence: o.consequence, cost_minor: o.costMinor, reversible: o.reversible, ...(o.actions ? { actions: o.actions } : {}) })), free_text: true, expires_at: null },
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    const r = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "spec" });
    expect(r.plan.status).toBe("done");
    expect(r.plan.summaryMd).not.toMatch(/\ba ops\b|\.\./);
    const task = (await repos.tasks.list(hz.db, t.businessId, { limit: 50 })).items.find((x) => x.title === "Rebuild the specification from the imported sources");
    expect(task?.assigneeAgentId).toBe(t.productLead);
    expect((await repos.tasks.list(hz.db, t.businessId, { limit: 50 })).items.some((x) => /^you review it/i.test(x.title))).toBe(false);
  });

  it("a first decision's reason travels with its option when the report wrote one, and is left out when it did not (UX plan §7.19)", () => {
    const decision = (id: string, recommended: boolean, because?: string) => ({ id, label: `Option ${id}`, recommended, consequence: "Something happens.", reversible: true, ...(because !== undefined ? { because } : {}) });
    const board = importBoardDecisionFromReport("Ledgerly", { summary: "Two sources read.", firstDecisions: [decision("a", true, "  Recommended because the code is already there.  "), decision("b", false), decision("c", false, "")] }, 2)!;
    expect(board.options.map((o) => o.because)).toEqual(["Recommended because the code is already there.", undefined, undefined]);
    expect(board.options.map((o) => "because" in o)).toEqual([true, false, false]);
  });
});

describe("plans follow the acting agent's own settings (audit api-services-03)", () => {
  const spend = "spend up to $200 on LinkedIn ads";

  it("a lowered agent with a zero threshold and cap asks or denies the same spend the business allows", async () => {
    const t = await team("policy-agent");
    const before = await owner(t).plan.preview({ businessId: t.businessId, text: spend });
    expect(before.evaluations.find((e) => e.action.type === "set_budget")?.outcome).toBe("allow");
    expect(before.requiresConfirmation).toBe(false);

    await hz.db.update(agents).set({ autonomy: { mode: "lower", approvalThresholdMinor: 0, spendCapMinor: 0 } }).where(eq(agents.businessId, t.businessId));
    const after = await owner(t).plan.preview({ businessId: t.businessId, text: spend });
    expect(after.evaluations.find((e) => e.action.type === "set_budget")?.outcome).not.toBe("allow");
  });

  it("the business's spend cap per action and the vacation budget ceiling apply to plan spend", async () => {
    const t = await team("policy-business");
    await hz.db.update(businesses).set({ spendCapMinor: 5_000 }).where(eq(businesses.id, t.businessId));
    const capped = await owner(t).plan.preview({ businessId: t.businessId, text: spend });
    expect(capped.evaluations.find((e) => e.action.type === "set_budget")?.outcome).not.toBe("allow");

    const agentsList = await repos.agents.list(hz.db, t.businessId, { limit: 50 });
    const business = { ...(await repos.businesses.get(hz.db, t.businessId)), spendCapMinor: null } as Business;
    const ctx: PlanContext = { business, agents: agentsList.items, holidayActive: true, holidayBudgetMinor: 1_000, currency: "USD" };
    const plan = await compilePlan(hz.deps.models, spend, ctx);
    expect(evaluatePlan(plan.actions, ctx).find((e) => e.action.type === "set_budget")?.outcome).not.toBe("allow");
    expect(evaluatePlan(plan.actions, { ...ctx, holidayActive: false }).find((e) => e.action.type === "set_budget")?.outcome).toBe("allow");
  });
});

describe("a spend assigned to an agent with no allowance asks for the founder's go-ahead", () => {
  const typed = "Spend up to $500 on LinkedIn ads targeting fintech CFOs next week";
  /** Every agent a template that spends nothing itself (what a lead, the Chief of Staff and a channel nobody runs yet are). */
  const noAllowance = (businessId: string) => hz.db.update(agents).set({ autonomy: { mode: "inherit", spendCapMinor: 0, approvalThresholdMinor: LIMITS.approvalThresholdMinorDefault } }).where(eq(agents.businessId, businessId));
  const budgetOf = (r: { evaluations: { action: { type: string }; outcome: string; reasons: string[]; policyIds: string[] }[] }) => r.evaluations.find((e) => e.action.type === "set_budget");

  it("asks, in the agent's words, instead of refusing; nothing runs until the founder confirms, and then the budget is set", async () => {
    const t = await team("allowance-ask");
    await noAllowance(t.businessId);
    const item = await boardItem(t, "content_media");
    const r = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, freeText: typed });

    const budget = r.plan.actions.find((a) => a.type === "set_budget")!;
    expect(budget.policyOutcome).toBe("ask");
    expect(budget.status).toBe("pending");
    expect(r.requiresConfirmation).toBe(true);
    expect(r.plan.status).toBe("pending_confirmation");
    expect(r.denied).toEqual([]);
    // The reason is kept with the action, for a reload and for another device.
    expect(budget.result).toEqual({ policyReasons: [SPEND_ALLOWANCE_ASK] });
    const evaluation = r.evaluations.find((e) => e.action.type === "set_budget")!;
    expect(evaluation.reasons).toEqual([SPEND_ALLOWANCE_ASK]);
    expect(evaluation.policyIds).toEqual([SPEND_ALLOWANCE_POLICY_ID]);
    expect((await repos.channels.getByKey(hz.db, t.businessId, "paid_ads"))?.budgetMinor ?? 0).toBe(0);

    const confirmed = await owner(t).plan.confirm({ businessId: t.businessId, planId: r.plan.id });
    expect(confirmed.exec.denied).toEqual([]);
    expect((await repos.channels.getByKey(hz.db, t.businessId, "paid_ads"))?.budgetMinor).toBe(50_000);
  });

  it("an agent that has an allowance the amount exceeds is still refused", async () => {
    const t = await team("allowance-exceeded");
    await hz.db.update(agents).set({ autonomy: { mode: "inherit", spendCapMinor: 10_000, approvalThresholdMinor: LIMITS.approvalThresholdMinorDefault } }).where(eq(agents.businessId, t.businessId));
    const r = await owner(t).plan.preview({ businessId: t.businessId, text: typed });
    expect(budgetOf(r)).toMatchObject({ outcome: "deny", policyIds: ["spend-cap-exceeded"] });
  });

  it("an active vacation's budget ceiling still refuses, whatever the agent's allowance", async () => {
    const t = await team("allowance-vacation");
    await noAllowance(t.businessId);
    const list = await repos.agents.list(hz.db, t.businessId, { limit: 50 });
    const business = (await repos.businesses.get(hz.db, t.businessId)) as Business;
    const ctx: PlanContext = { business, agents: list.items, holidayActive: true, holidayBudgetMinor: 1_000, currency: "USD" };
    const plan = await compilePlan(hz.deps.models, typed, ctx);
    expect(evaluatePlan(plan.actions, ctx).find((e) => e.action.type === "set_budget")).toMatchObject({ outcome: "deny", policyIds: ["spend-cap-exceeded"] });
    // A ceiling the amount fits under leaves only the missing allowance: the founder is asked.
    expect(evaluatePlan(plan.actions, { ...ctx, holidayBudgetMinor: 100_000 }).find((e) => e.action.type === "set_budget")).toMatchObject({ outcome: "ask", reasons: [SPEND_ALLOWANCE_ASK] });
  });
});

describe("rules first: a hard-gated instruction compiles without a model call (audit MB-3)", () => {
  /** The mock client, counting plan-compiler calls. */
  function counted() {
    const inner = new MockModelClient();
    const calls: string[] = [];
    const models: ModelClient = {
      mode: "live",
      complete: (async (req: CompleteRequest) => {
        if (req.route === "planCompiler") calls.push(req.route);
        return inner.complete(req as never);
      }) as ModelClient["complete"],
    };
    return { models, calls };
  }
  async function contextOf(t: Team): Promise<PlanContext> {
    const list = await repos.agents.list(hz.db, t.businessId, { limit: 50 });
    return { business: (await repos.businesses.get(hz.db, t.businessId)) as Business, agents: list.items, holidayActive: false, currency: "USD" };
  }

  it("a gated clause, alone or beside other work, is the rules' plan: every gate asks the founder, nothing gated is automated", async () => {
    const t = await team("rules-first");
    const ctx = await contextOf(t);
    const { models, calls } = counted();
    for (const text of ["Pay the supplier invoice", "Pay the supplier invoice and draft a LinkedIn post about the launch"]) {
      const plan = await compilePlan(models, text, ctx);
      expect(plan.source).toBe("rules");
      expect(plan.actions[0]).toMatchObject({ type: "request_human_action", params: { gate: "move_money" }, agent_id: null });
      expect(plan.actions.filter((a) => a.type === "request_human_action")).toHaveLength(1);
      expect(evaluatePlan(plan.actions, ctx)[0]).toMatchObject({ hardGate: true });
    }
    expect(calls).toEqual([]);
  });

  it("an instruction with no gate is still compiled by the model; a typed spend still asks for the allowance", async () => {
    const t = await team("rules-first-model");
    await hz.db.update(agents).set({ autonomy: { mode: "inherit", spendCapMinor: 0, approvalThresholdMinor: LIMITS.approvalThresholdMinorDefault } }).where(eq(agents.businessId, t.businessId));
    const ctx = await contextOf(t);
    const { models, calls } = counted();
    const plan = await compilePlan(models, "Spend up to $500 on LinkedIn ads targeting fintech CFOs next week", ctx);
    expect(calls).toEqual(["planCompiler"]);
    expect(plan.source).toBe("model");
    expect(evaluatePlan(plan.actions, ctx).find((e) => e.action.type === "set_budget")).toMatchObject({ outcome: "ask", reasons: [SPEND_ALLOWANCE_ASK] });
  });
});

describe("plan agents (audit api-services-28)", () => {
  it("an agent id the model wrote that is not the business's own is dropped, whoever's it is", async () => {
    const t = await team("own-agents");
    const other = await team("other-business");
    const list = await repos.agents.list(hz.db, t.businessId, { limit: 50 });
    const cleaned = ownAgentsOnly(
      [
        { type: "create_task", params: { kind: "ops", title: "Mine" }, agent_id: t.productLead },
        { type: "create_task", params: { kind: "ops", title: "Foreign" }, agent_id: other.productLead },
        { type: "create_task", params: { kind: "ops", title: "Made up" }, agent_id: "5b1dfc03-48cb-4cb4-9d1c-c1f2c2c1c001" },
        { type: "set_agent_model", params: { agent_id: other.agentId, model_key: "haiku" }, agent_id: null },
      ],
      list.items,
    );
    expect(cleaned.map((a) => a.agent_id)).toEqual([t.productLead, null, null, null]);
    expect(cleaned[3]!.params.agent_id).toBeNull();
  });

  it("a decision whose compiled plan names a made-up or foreign agent still decides, with the task unassigned", async () => {
    const t = await team("own-agents-decide");
    const other = await team("own-agents-other");
    const inner = new MockModelClient();
    const models: ModelClient = {
      mode: "live",
      complete: (async (req: CompleteRequest) => {
        const out = await inner.complete(req as never);
        if (req.route !== "planCompiler") return out;
        const json = { summary: "Create a research task.", actions: [{ type: "create_task", params: { kind: "research", title: "Competitor pricing", goal: "Compare pricing." }, agent_id: other.productLead }] };
        return { ...out, json };
      }) as ModelClient["complete"],
    };
    const { createCaller } = await import("../router");
    const caller = createCaller({ ...hz.deps, models }, { userId: t.ownerId, email: "owner@test.local" });
    const item = await boardItem(t, "b2b_saas");
    const r = await caller.inbox.decide({ businessId: t.businessId, itemId: item.id, freeText: "research competitor pricing" });
    expect(r.plan.actions[0]?.agentId).toBeNull();
    const task = (await repos.tasks.list(hz.db, t.businessId, { limit: 50 })).items.find((x) => x.title === "Competitor pricing");
    expect(task?.assigneeAgentId).toBeNull();
  });

  it("a plan that changes a model does what Agent profile › Model does: warns, and queues the retest", async () => {
    const t = await team("plan-model");
    const [live] = await hz.db.insert(agentVersions).values({ businessId: t.businessId, agentId: t.agent2Id, version: 1, state: "live" }).returning({ id: agentVersions.id });
    await hz.db.update(agents).set({ currentVersionId: live!.id }).where(eq(agents.id, t.agent2Id));
    const plan = await repos.plans.create(hz.db, t.businessId, {
      origin: "free_text",
      summaryMd: "Move the engineer to Haiku",
      status: "pending_confirmation",
      actions: [{ type: "set_agent_model", params: { agent_id: t.agent2Id, model_key: "haiku" }, policyOutcome: "ask" }],
    });
    const confirmed = await owner(t).plan.confirm({ businessId: t.businessId, planId: plan.id });
    expect((await repos.agents.get(hz.db, t.businessId, t.agent2Id)).modelKey).toBe("haiku");
    expect(confirmed.exec.models.retests).toHaveLength(1);
    expect(temporal.starts.some((s) => s.type === "trainingRun" && JSON.stringify(s.args).includes(confirmed.exec.models.retests[0]!))).toBe(true);
  });

  it("planAgents tells the compilers which channel each agent runs", async () => {
    const t = await team("plan-agents");
    const list = await repos.agents.list(hz.db, t.businessId, { limit: 50 });
    const seen = planAgents(list.items);
    expect(seen.find((a) => a.id === t.leadGen)).toMatchObject({ channel: "lead_generation", template_key: "channel_lead_generation" });
    expect(seen.find((a) => a.id === t.productLead)?.channel).toBeUndefined();
  });
});

describe("a plan the orchestrator was never told about (audit api-services-15)", () => {
  it("is worded as waiting, stays findable, and starts when Temporal answers again", async () => {
    const t = await team("redispatch");
    const hire = await repos.inbox.createItem(hz.db, t.businessId, {
      type: "decision",
      from_agent_id: t.agentId,
      subject: "Do we add help?",
      body_md: "The team could use another pair of hands.",
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: { options: [{ id: "later", label: "Not now", recommended: true, consequence: "Nothing changes.", cost_minor: 0, reversible: true }, { id: "other", label: "Something else", recommended: false, consequence: "Write it.", cost_minor: 0, reversible: true }], free_text: true, expires_at: null },
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    temporalDown = true;
    const r = await owner(t).inbox.decide({ businessId: t.businessId, itemId: hire.id, freeText: "Hire a growth agent" });
    expect(r.plan.actions.map((a) => a.type)).toEqual(["hire_agent"]);
    expect(r.dispatch?.queued).toBe(false);
    expect(r.followUp?.bodyMd).toMatch(/waiting to start/);
    expect(r.followUp?.bodyMd).not.toMatch(/handed to the team/);
    expect(r.plan.status).toBe("executing");
    expect(r.plan.workflowId).toBeNull();
    expect((await repos.plans.awaitingDispatch(hz.db, t.businessId)).map((p) => p.id)).toEqual([r.plan.id]);

    // Still down: trying again starts nothing and records nothing.
    expect((await redispatchPlans({ db: hz.db, temporal: hz.deps.temporal, businessId: t.businessId })).every((x) => !x.dispatch.queued)).toBe(true);
    expect((await repos.plans.get(hz.db, t.businessId, r.plan.id)).workflowId).toBeNull();

    temporalDown = false;
    const started = await redispatchPlans({ db: hz.db, temporal: hz.deps.temporal, businessId: t.businessId });
    expect(started.map((x) => x.planId)).toEqual([r.plan.id]);
    expect(temporal.starts).toContainEqual({ type: "planExecution", workflowId: `plan:${r.plan.id}`, args: [{ businessId: t.businessId, planId: r.plan.id }] });
    expect((await repos.plans.get(hz.db, t.businessId, r.plan.id)).workflowId).toBe(`plan:${r.plan.id}`);
    expect(await repos.plans.awaitingDispatch(hz.db, t.businessId)).toEqual([]);
  });

  it("a healthy dispatch is worded as handed to the team, and the next decision starts what an earlier one left behind", async () => {
    const t = await team("redispatch-next");
    const make = (subject: string) =>
      repos.inbox.createItem(hz.db, t.businessId, {
        type: "decision",
        from_agent_id: t.agentId,
        subject,
        body_md: "A steer is needed.",
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: { options: [{ id: "later", label: "Not now", recommended: true, consequence: "Nothing changes.", cost_minor: 0, reversible: true }, { id: "other", label: "Something else", recommended: false, consequence: "Write it.", cost_minor: 0, reversible: true }], free_text: true, expires_at: null },
        blocks_continue: true,
        source_event_ids: [],
        entity_ids: [],
      });
    temporalDown = true;
    const first = await owner(t).inbox.decide({ businessId: t.businessId, itemId: (await make("First")).id, freeText: "Hire a growth agent" });
    temporalDown = false;
    const second = await owner(t).inbox.decide({ businessId: t.businessId, itemId: (await make("Second")).id, freeText: "Hire a data agent" });
    expect(second.followUp?.bodyMd).toMatch(/1 handed to the team\./);
    // The decision after the outage started the plan the outage left behind.
    expect((await repos.plans.get(hz.db, t.businessId, first.plan.id)).workflowId).toBe(`plan:${first.plan.id}`);
  });
});

describe("confirming a plan twice (audit api-services-05)", () => {
  it("the second press neither runs, audits nor writes a follow-up again, and a finished plan stays finished", async () => {
    const t = await team("confirm-twice");
    const item = await boardItem(t, "b2b_saas");
    const pending = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "outbound" });
    const first = await owner(t).plan.confirm({ businessId: t.businessId, planId: pending.plan.id });
    expect(first.alreadyConfirmed).toBe(false);
    expect(first.plan.status).toBe("done");

    // The second press had read the plan as waiting, before the first committed (two tabs, two members).
    const stale = await repos.plans.get(hz.db, t.businessId, pending.plan.id);
    const waiting = { ...stale, status: "pending_confirmation" as const, confirmedAt: null };
    const get = vi.spyOn(repos.plans, "get").mockResolvedValueOnce(waiting);
    let second;
    try {
      second = await owner(t).plan.confirm({ businessId: t.businessId, planId: pending.plan.id });
    } finally {
      get.mockRestore();
    }
    expect(second.alreadyConfirmed).toBe(true);
    expect(second.followUp).toBeNull();
    expect(second.exec.executed).toEqual([]);
    expect((await repos.plans.get(hz.db, t.businessId, pending.plan.id)).status).toBe("done");

    const confirmations = (await repos.audit.list(hz.db, t.businessId, { action: "plan.confirm" })).items.filter((a) => (a.target as { id: string }).id === pending.plan.id);
    expect(confirmations).toHaveLength(1);
    const followUps = (await repos.inbox.list(hz.db, t.businessId, { limit: 100 })).items.filter((i) => i.subject.startsWith("Decided:"));
    expect(followUps).toHaveLength(1);
    const budgets = (await repos.tasks.list(hz.db, t.businessId, { kind: "channel", limit: 50 })).items.filter((x) => x.title === "Build the first prospect list");
    expect(budgets).toHaveLength(1);
  });
});

describe("who decides what (audit VRUI-X2, RUI-14, RUI-16)", () => {
  it("an Update or a Milestone asks for no decision: free text on it goes to the agent's desk, and inbox.decide refuses", async () => {
    const t = await team("non-decision");
    const update = await repos.inbox.createItem(hz.db, t.businessId, { type: "update", from_agent_id: t.agentId, subject: "Week 1 shipped", body_md: "The first page is live.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
    await expect(owner(t).inbox.decide({ businessId: t.businessId, itemId: update.id, freeText: "Turn on the GEO channel for AI search answers" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const reply = await owner(t).agent.conversation.inboxReply({ businessId: t.businessId, itemId: update.id, text: "Turn on the GEO channel for AI search answers" });
    expect(reply.route).toBe("conversation");
    expect((await repos.inbox.get(hz.db, t.businessId, update.id)).state).not.toBe("answered");
    expect((await repos.inbox.list(hz.db, t.businessId, { limit: 100 })).items.some((i) => i.subject.startsWith("Decided: Decided:"))).toBe(false);
  });

  it("a follow-up never chains 'Decided:' subjects", async () => {
    const t = await team("no-chain");
    const item = await boardItem(t, "b2b_saas");
    const r = await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "design_partners" });
    expect(r.followUp?.subject.startsWith("Decided: Decided:")).toBe(false);
  });

  it("a blocking decision cannot be archived before it is answered", async () => {
    const t = await team("archive-guard");
    const item = await boardItem(t, "b2b_saas");
    await expect(owner(t).inbox.archive({ businessId: t.businessId, itemId: item.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const list = await owner(t).inbox.list({ businessId: t.businessId });
    expect(list.continueState).toMatchObject({ kind: "blocked" });
    await owner(t).inbox.decide({ businessId: t.businessId, itemId: item.id, chosenOption: "design_partners" });
    expect((await owner(t).inbox.archive({ businessId: t.businessId, itemId: item.id })).state).toBe("archived");
  });

  it("each person's read markers are their own, and a viewer can clear theirs", async () => {
    const t = await team("reads");
    const item = await repos.inbox.createItem(hz.db, t.businessId, { type: "update", from_agent_id: t.agentId, subject: "Shipped", body_md: "Done.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
    const stateFor = async (userId: string) => (await hz.caller({ userId }).inbox.get({ businessId: t.businessId, itemId: item.id })).item.state;
    const listed = async (userId: string) => (await hz.caller({ userId }).inbox.list({ businessId: t.businessId, limit: 100 })).items.find((i) => i.id === item.id)?.state;

    expect((await hz.caller({ userId: t.memberId }).inbox.markRead({ businessId: t.businessId, itemId: item.id })).state).toBe("read");
    expect(await stateFor(t.memberId)).toBe("read");
    expect(await stateFor(t.ownerId)).toBe("unread");
    expect(await listed(t.ownerId)).toBe("unread");

    // A viewer's call used to return 200 and change nothing, for ever.
    expect((await hz.caller({ userId: t.viewerId }).inbox.markRead({ businessId: t.businessId, itemId: item.id })).state).toBe("read");
    expect(await listed(t.viewerId)).toBe("read");
    expect(await listed(t.ownerId)).toBe("unread");
  });
});
