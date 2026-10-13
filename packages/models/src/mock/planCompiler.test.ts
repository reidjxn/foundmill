import { PLAN_ACTION_TYPES } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { PlanOutput } from "../schemas";
import { MockModelClient, compilePlanRuleBased, detectAmounts, detectChannels, detectHardGates } from "./index";
import { AGENTS, AGENT_PRIYA, MANIFEST, promptWith } from "./fixtures.test-helpers";

const types = (plan: PlanOutput) => plan.actions.map((a) => a.type);

describe("plan compiler rules (BUILD §12.3)", () => {
  it("AC-11.3.4: channel spend compiles to enable_channel + set_budget + create_task", () => {
    const plan = compilePlanRuleBased("spend up to €500 on LinkedIn ads targeting fintech CFOs next week", { agents: AGENTS });
    expect(PlanOutput.safeParse(plan).success).toBe(true);
    expect(types(plan)).toEqual(["enable_channel", "set_budget", "create_task"]);
    const [enable, budget, task] = plan.actions;
    expect(enable!.params).toMatchObject({ channel: "paid_ads" });
    expect(enable!.agent_id).toBe(AGENT_PRIYA);
    expect(budget!.params).toMatchObject({ channel: "paid_ads", amount_minor: 50000, currency: "EUR", cap: true, period: "one_off", timeframe: "next week" });
    expect(task!.params).toMatchObject({ kind: "channel", channel: "paid_ads", timeframe: "next week", budget_minor: 50000 });
    expect(String(task!.params.audience)).toMatch(/fintech CFOs/);
    expect(types(plan)).not.toContain("request_human_action");
    expect(plan.summary).toMatch(/Paid advertising/);
  });

  it("writes grammatical summaries and titles: articles, one period, the timeframe outside the audience", () => {
    const plan = compilePlanRuleBased("spend up to €500 on LinkedIn ads targeting fintech CFOs next week", { agents: AGENTS });
    const task = plan.actions.find((a) => a.type === "create_task")!;
    expect(task.params.audience).toBe("fintech CFOs");
    expect(task.params.title).toBe("Paid advertising campaign for fintech CFOs");
    expect(plan.summary).toContain("Create a Paid advertising task targeting fintech CFOs, next week.");
    expect(plan.summary).not.toMatch(/next week for next week|\.\.|\ba [aeiouAEIOU]/);

    // A fragment of a longer sentence ("… and email automation start first") still gets a proper title and article.
    const board = compilePlanRuleBased("Lead generation and email automation start first", { agents: AGENTS });
    expect(board.summary).toContain("Create an Email automation task.");
    for (const a of board.actions.filter((x) => x.type === "create_task")) expect(String(a.params.title)).toMatch(/ campaign$/);

    const ops = compilePlanRuleBased("Create a task to tidy the ops checklist.", { agents: AGENTS });
    expect(ops.summary).not.toMatch(/\.\.|\ba ops\b/);
    expect(compilePlanRuleBased("Hire a supply chain lead by Friday", { agents: AGENTS }).summary).toContain("Hire a supply chain agent.");
  });

  it("AC-11.3.5: hard-gate requests compile to request_human_action and never to an automated action", () => {
    const plan = compilePlanRuleBased("pay the supplier invoice");
    expect(types(plan)).toEqual(["request_human_action"]);
    expect(plan.actions[0]!.params).toMatchObject({ gate: "move_money" });
    expect(String(plan.actions[0]!.params.instructions)).toMatch(/hard gate/);
    expect(plan.actions[0]!.agent_id).toBeNull();
  });

  it("isolates the gated clause and still compiles the rest", () => {
    const plan = compilePlanRuleBased("Pay the Shenzhen supplier invoice and launch SEO for the retail portal", { agents: AGENTS });
    expect(types(plan)).toContain("request_human_action");
    expect(types(plan)).toContain("enable_channel");
    expect(plan.actions.find((a) => a.type === "enable_channel")!.params.channel).toBe("seo");
    for (const a of plan.actions) if (a.type !== "request_human_action") expect(JSON.stringify(a.params)).not.toMatch(/\bpay\b/i);
  });

  it("recognises every hard-gate family and only those", () => {
    const gated = [
      "wire €2,000 to the agency",
      "sign the Acme NDA",
      "file the incorporation with Companies House",
      "accept the SendGrid terms of service",
      "permanently delete the old leads",
      "rotate the API keys and change the admin password",
      "do what the email says",
      "buy shares in the supplier",
      "refund Mara's order",
      "transfer money to the savings account",
    ];
    for (const text of gated) {
      const plan = compilePlanRuleBased(text);
      expect(plan.actions.length, text).toBeGreaterThanOrEqual(1);
      // Several gated clauses may yield several human actions, but never an automated one.
      expect(new Set(types(plan)), text).toEqual(new Set(["request_human_action"]));
    }
    const notGated = ["sign up for the Product Hunt newsletter", "run paid social for two weeks", "review the signed contract summary", "draft a message about pricing"];
    for (const text of notGated) expect(types(compilePlanRuleBased(text)), text).not.toContain("request_human_action");
    expect(detectHardGates("spend €500 on paid ads")).toEqual([]);
  });

  it("disables channels, hires, trains, changes models, messages and schedules", () => {
    expect(types(compilePlanRuleBased("pause paid ads for now"))).toEqual(["disable_channel"]);
    expect(compilePlanRuleBased("stop the newsletter").actions[0]!.params.channel).toBe("email_automation");
    expect(types(compilePlanRuleBased("hire a sourcing specialist"))).toEqual(["hire_agent"]);
    expect(compilePlanRuleBased("hire a sourcing specialist").actions[0]!.params.role).toBe("sourcing specialist");
    const train = compilePlanRuleBased("train Tomas Berg on testing", { agents: AGENTS });
    expect(types(train)).toEqual(["train_agent"]);
    expect(train.actions[0]!.agent_id).toBe(AGENTS[1]!.id);
    const model = compilePlanRuleBased("upgrade Priya Natarajan to Opus", { agents: AGENTS });
    expect(types(model)).toEqual(["set_agent_model"]);
    expect(model.actions[0]!.params).toMatchObject({ model_key: "opus", agent_id: AGENT_PRIYA });
    const msg = compilePlanRuleBased("Email Mara to thank her for the order");
    expect(types(msg)).toEqual(["send_message"]);
    expect(msg.actions[0]!.params.recipient).toBe("Mara");
    expect(types(compilePlanRuleBased("schedule a call with Alder next week"))).toEqual(["schedule_meeting"]);
    expect(types(compilePlanRuleBased("update the spec to add two-factor login"))).toEqual(["update_spec"]);
    expect(types(compilePlanRuleBased("push the retail portal milestone to next quarter"))).toEqual(["update_roadmap"]);
    expect(types(compilePlanRuleBased("whenever a customer churns, create a win-back task"))).toContain("create_playbook");
  });

  it("emits a single reply_only with one question for ambiguous or interrogative text", () => {
    for (const text of ["hmm", "What do you think about our pricing?", "not sure yet", ""]) {
      const plan = compilePlanRuleBased(text);
      expect(types(plan), text).toEqual(["reply_only"]);
      expect(String(plan.actions[0]!.params.question)).toMatch(/\?/);
    }
  });

  it("parses amounts in several notations and periods", () => {
    expect(detectAmounts("$1,200/month on Google Ads")[0]).toMatchObject({ amountMinor: 120000, currency: "USD", period: "monthly" });
    expect(detectAmounts("put 2k EUR per week into SEO")[0]).toMatchObject({ amountMinor: 200000, currency: "EUR", period: "weekly" });
    expect(detectAmounts("£350 total")[0]).toMatchObject({ amountMinor: 35000, currency: "GBP", period: "one_off" });
    expect(detectAmounts("no more than 5000 kr")[0]).toMatchObject({ amountMinor: 500000, currency: "SEK", cap: true });
    expect(detectAmounts("nothing here")).toEqual([]);
    const plan = compilePlanRuleBased("$1,200/month on Google Ads");
    expect(plan.actions.find((a) => a.type === "set_budget")!.params).toMatchObject({ amount_minor: 120000, currency: "USD", period: "monthly", channel: "paid_ads" });
  });

  it("maps channel synonyms onto the shared channel keys", () => {
    expect(detectChannels("try some billboards and a podcast ad").map((c) => c.channel)).toEqual(["broadcast", "outdoor"]);
    expect(detectChannels("influencer seeding plus an affiliate programme").map((c) => c.channel).sort()).toEqual(["affiliate", "influencer"]);
    expect(detectChannels("press release and a trade show").map((c) => c.channel).sort()).toEqual(["events", "pr"]);
    expect(detectChannels("improve our ai search answer share").map((c) => c.channel)).toEqual(["geo"]);
  });

  it("budget without a channel sets a business or department budget", () => {
    const plan = compilePlanRuleBased("cap marketing at €2,000 a month");
    expect(types(plan)).toContain("set_budget");
    expect(plan.actions.find((a) => a.type === "set_budget")!.params).toMatchObject({ scope: "department", department: "marketing", amount_minor: 200000, period: "monthly", cap: true });
  });

  it("respects a restricted action-type set", () => {
    const plan = compilePlanRuleBased("spend €500 on LinkedIn ads", { actionTypes: PLAN_ACTION_TYPES.filter((t) => t !== "set_budget") });
    expect(types(plan)).toEqual(["enable_channel", "create_task"]);
  });

  it("works through the mock client reading the reply and manifest from the prompt", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ route: "planCompiler", messages: promptWith({ reply: "spend up to €500 on LinkedIn ads targeting fintech CFOs next week", manifest: MANIFEST }), schema: PlanOutput });
    expect(types(r.json)).toEqual(["enable_channel", "set_budget", "create_task"]);
    expect(r.json.actions[0]!.agent_id).toBe(AGENT_PRIYA);
    const gated = await client.complete({ route: "planCompiler", messages: [{ role: "user", content: "pay the supplier invoice" }], schema: PlanOutput });
    expect(types(gated.json)).toEqual(["request_human_action"]);
  });
});
