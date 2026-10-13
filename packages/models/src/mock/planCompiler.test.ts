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

  it("gates signing, never the product words sign-up, sign-in, sign-on or single sign-on (audit VRB-X2)", () => {
    for (const text of ["sign up for the newsletter", "improve the sign-up flow", "fix the sign-in page", "add single sign-on to the roadmap", "sign-on for enterprise customers", "sign off on the brief"]) {
      expect(detectHardGates(text).map((g) => g.gate), text).not.toContain("sign");
    }
    expect(types(compilePlanRuleBased("fix the sign-in page"))).toEqual(["create_task"]);
    expect(types(compilePlanRuleBased("update the spec to add single sign-on to the acceptance criteria"))).toEqual(["update_spec"]);
    for (const text of ["sign the Acme NDA", "countersign the agency contract", "e-sign the lease"]) expect(detectHardGates(text).map((g) => g.gate), text).toContain("sign");
  });

  it("gates moving money, never 'paid', 'refund' or 'payout' as words for it (audit AC-01)", () => {
    const moves = ["pay the supplier invoice", "refund Mara's order", "refund the deposit", "issue a refund to Mara", "make the payout to the creator", "wire €2,000 to the agency", "send them the payment", "settle the invoice"];
    for (const text of moves) expect(detectHardGates(text).map((g) => g.gate), text).toContain("move_money");
    const words = [
      "Small paid test with a hard CPA cap",
      "Free for the first chapter, paid tier at 1,000 subscribers",
      "Paid membership from issue one",
      "Paid pre-orders now",
      "paid acquisition or organic first",
      "a paid plan for teams",
      "Cash earlier, but refunds and consumer-law exposure if certification slips",
      "write the refund policy",
      "Cheaper per install if creators fit; disclosure checked before any payout",
      "find our first paying customers",
      "wire up the Stripe webhook",
      "a pay-as-you-go tier",
    ];
    for (const text of words) expect(detectHardGates(text), text).toEqual([]);
    // The recommended Consumer app option compiles to the paid test it names, not a founder payment.
    expect(types(compilePlanRuleBased("Small paid test with a hard CPA cap", { agents: AGENTS }))).not.toContain("request_human_action");
  });

  it("does not read a sponsorship as the events channel", () => {
    expect(detectChannels("sponsorship starts when reach justifies it")).toEqual([]);
    expect(detectChannels("sponsor a trade show").map((c) => c.channel)).toEqual(["events"]);
  });

  it("templates readable summaries: the right article and no doubled full stop (audit IAE-20)", () => {
    const plan = compilePlanRuleBased("Review the onboarding checklist before launch.");
    expect(plan.summary).toBe("Create an ops task: Review the onboarding checklist before launch.");
    expect(plan.actions[0]!.params.title).toBe("Review the onboarding checklist before launch");
    expect(compilePlanRuleBased("spend €200 on email automation").summary).toMatch(/Create an Email automation task/);
    expect(compilePlanRuleBased("research the three closest competitors").summary).toMatch(/^Create a research task: research the three/);
    expect(compilePlanRuleBased("hire a growth agent").summary).toBe("Hire a growth agent.");
    expect(compilePlanRuleBased("rebuild the specification from the imported sources").actions.map((a) => a.type)).toEqual(["update_spec"]);
  });

  it("only hires when the words name who joins the team (audit VIAE-X1)", () => {
    expect(types(compilePlanRuleBased("Recruit supply by hand, then open demand"))).not.toContain("hire_agent");
    expect(types(compilePlanRuleBased("recruit two engineers for the API"))).toEqual(["hire_agent"]);
  });

  it("gives a channel's task to the agent that runs the channel, never to whoever has 'Lead' in the title (audit FR-20)", () => {
    const team = [
      { id: "product", name: "Ines Ortega", role: "Product Lead" },
      { id: "eng", name: "Kai Moreau", role: "Engineering Lead" },
      { id: "leadgen", name: "Lead Generation Engine", role: "Channel engine" },
    ];
    const byName = compilePlanRuleBased("start lead generation for fintech CFOs", { agents: team });
    expect(byName.actions.find((a) => a.type === "create_task")!.agent_id).toBe("leadgen");
    // With the channel each agent runs, the owner wins whatever its name.
    const owned = compilePlanRuleBased("start lead generation for fintech CFOs", { agents: [team[0]!, { id: "owner", name: "Rafa", role: "Outbound", channel: "lead_generation" }] });
    expect(owned.actions.find((a) => a.type === "create_task")!.agent_id).toBe("owner");
    // Nobody runs it: no agent rather than the Product Lead.
    expect(compilePlanRuleBased("start lead generation", { agents: team.slice(0, 2) }).actions.find((a) => a.type === "create_task")!.agent_id).toBeNull();
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
