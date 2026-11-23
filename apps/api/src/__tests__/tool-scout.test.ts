/**
 * The tool scout in the api (founder, Nov 22, 2026): what take charge raises and plans for a money product, when a
 * service is offered booking, and the founder's answer to the recommendation (Yes, or Not now) decided in-process.
 */
import { ideaVersions, repos } from "@foundmill/db";
import { eq } from "drizzle-orm";
import { TOOL_PICK_NOTE } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "scout", temporalClient: fakeTemporalClient(), env: { LIVE_MODE: "1" } });
}, 120_000);
afterAll(() => hz.close());

const PICK = {
  pick: { name: "Twilio", catalogKey: "twilio", route: "api_key" as const, why: "It texts US numbers.", whyNow: "Reminders start this week.", cost: "About $0.01 a message (Estimate).", founderSteps: "You sign up with Twilio and accept its terms yourself: that step is always yours." },
  alternatives: [{ name: "Vonage", line: "Similar price, fewer countries." }],
  sources: [{ url: "https://www.twilio.com/pricing", title: "Twilio pricing" }],
};

const WAVE = {
  pick: { name: "Wave", catalogKey: "wave", route: "browser" as const, why: "Free invoices for a small US business.", whyNow: "The first invoice goes out this week.", cost: "Free to start (Estimate).", founderSteps: "You sign up with Wave and sign in once inside Foundmill." },
  alternatives: [{ name: "Xero", line: "More complete, a monthly fee." }],
  sources: [{ url: "https://www.waveapps.com/pricing", title: "Wave pricing" }],
};

async function recommend(businessId: string, agentId: string, category: "sms" | "analytics" | "invoicing_accounting", pick: typeof PICK | typeof WAVE = PICK) {
  const item = await repos.inbox.createItem(hz.db, businessId, {
    type: "decision",
    from_agent_id: agentId,
    subject: "A tool for text messages: Twilio",
    body_md: "For text messages, I suggest **Twilio**.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: TOOL_PICK_NOTE.options.yes, label: "Yes, I'll sign up with Twilio", recommended: true, consequence: "The team sets it up once you have connected it.", because: "Reminders start this week.", cost_minor: 0, reversible: true },
        { id: TOOL_PICK_NOTE.options.notNow, label: TOOL_PICK_NOTE.notNowLabel, recommended: false, consequence: "Nothing changes.", cost_minor: 0, reversible: true },
      ],
      free_text: false,
      expires_at: null,
      key: `${TOOL_PICK_NOTE.keyPrefix}${category}`,
    },
    blocks_continue: false,
    source_event_ids: [],
    entity_ids: [],
  });
  await repos.toolNeeds.recommend(hz.db, businessId, category, { ...pick, inboxItemId: item.id });
  return item;
}

describe("take charge and the tool scout", () => {
  it("a money product: the specialist joins Legal, the license question is asked, and identity checks wait for the first real users", async () => {
    const userId = await hz.h.createUser("fintech@test.local");
    const caller = hz.caller({ userId, email: "fintech@test.local" });
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Fin", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 10 }, targetMarkets: ["US"], riskAppetite: "low", budgetMinor: null });
    const idea = (await caller.idea.generate({ prompt: "a fintech app that lets housemates split rent" })).ideas[0]!;
    // The founder's own words for the idea (the mock generator writes its own pitch).
    await hz.db.update(ideaVersions).set({ title: "Splitnest", pitch: "A fintech app that lets housemates split rent and holds the money for three days." }).where(eq(ideaVersions.ideaId, idea.id));
    const result = await caller.idea.commit({ ideaId: idea.id, name: "Splitnest", archetype: "consumer_app", gameMode: "personal" });
    const bid = result.business.id;

    const agents = (await repos.agents.list(hz.db, bid, { limit: 500 })).items;
    expect(agents.map((a) => a.agentType)).toContain("financial_regulatory");
    const tasks = (await repos.tasks.list(hz.db, bid, { limit: 100 })).items;
    expect(tasks.map((t) => t.title)).toContain("Does this need a license to handle money?");
    // Nothing is recommended on day one: no tool_need task, and the two needs are recorded for later.
    expect(tasks.filter((t) => t.kind === "tool_need")).toEqual([]);
    const needs = await repos.toolNeeds.list(hz.db, bid);
    expect(needs.map((n) => [n.category, n.stage, n.status]).sort()).toEqual([
      ["aml_screening", "first_customers", "planned"],
      ["kyc_identity", "first_customers", "planned"],
    ]);
  });

  it("an ordinary project gets no specialist, no license question and no planned needs", async () => {
    const userId = await hz.h.createUser("plain@test.local");
    const caller = hz.caller({ userId, email: "plain@test.local" });
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Pat", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 10 }, targetMarkets: ["US"], riskAppetite: "low", budgetMinor: null });
    const idea = (await caller.idea.generate({ prompt: "home cleaning in Austin" })).ideas[0]!;
    const result = await caller.idea.commit({ ideaId: idea.id, name: "Brightside Cleaning", archetype: "services", gameMode: "personal" });
    const bid = result.business.id;
    expect((await repos.agents.list(hz.db, bid, { limit: 500 })).items.map((a) => a.agentType)).not.toContain("financial_regulatory");
    expect(await repos.toolNeeds.list(hz.db, bid)).toEqual([]);
    expect((await repos.tasks.list(hz.db, bid, { kind: "tool_need", limit: 10 })).items).toEqual([]);
  });
});

describe("the founder's answer to a recommendation", () => {
  it("Yes records the pick as chosen and gives the Chief of Staff one task; the founder's own step stays theirs", async () => {
    const { businessId, ownerId, agentId, memberId } = hz.A;
    const item = await recommend(businessId, agentId, "sms");
    const owner = hz.caller({ userId: ownerId });
    const row = (await owner.today.get({ businessId })).needsYou?.items.find((i) => i.id === item.id);
    expect(row?.quickOption).toEqual({ id: TOOL_PICK_NOTE.options.yes, label: "Yes, I'll sign up with Twilio" });
    await expect(hz.caller({ userId: memberId }).inbox.decide({ businessId, itemId: item.id, chosenOption: TOOL_PICK_NOTE.options.yes })).rejects.toThrow(/choose the project's tools/);
    const out = await owner.inbox.decide({ businessId, itemId: item.id, chosenOption: TOOL_PICK_NOTE.options.yes });
    expect(out.item.state).toBe("answered");
    expect(await repos.toolNeeds.get(hz.db, businessId, "sms")).toMatchObject({ status: "accepted", askAgainAt: null });
    const task = (await repos.tasks.list(hz.db, businessId, { limit: 200 })).items.find((t) => t.title === "Bring Twilio into the project");
    expect(task).toMatchObject({ kind: "ops", status: "ready", assigneeAgentId: agentId });
    expect(task!.goalMd).toContain("Never sign up, accept terms, pay or enter a key for the founder.");
    // No integration was created by the answer.
    expect(await repos.integrations.getByKey(hz.db, businessId, "twilio")).toBeNull();
  });

  it("Yes to a pick by the hosted browser gives the owning department a setup task that states done first and checks by reading back (Part D)", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const finance = await repos.agents.create(hz.db, businessId, { name: "Finance Lead", agentType: "finance_lead", modelKey: "sonnet", initialVersion: { instructions: { role: "finance" }, tools: [] } });
    const item = await recommend(businessId, agentId, "invoicing_accounting", WAVE);
    await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: item.id, chosenOption: TOOL_PICK_NOTE.options.yes });
    const task = (await repos.tasks.list(hz.db, businessId, { limit: 200 })).items.find((t) => t.title === "Set up Wave in its website");
    expect(task).toMatchObject({ kind: "ops", status: "ready", assigneeAgentId: finance.id });
    expect(task!.goalMd).toContain("browser_wave");
    expect(task!.goalMd).toContain("Before the first change, write down in this task what done looks like");
    expect(task!.goalMd).toContain("reported as not verified");
    expect(task!.goalMd).toContain("Never sign up, accept terms, pay or enter a password, a card or a code for the founder.");
    expect(task!.acceptance).toContain("Each setting was checked by reading the page back");
  });

  it("Not now keeps the question away for about a month, and creates no task", async () => {
    const { businessId, ownerId, agentId } = hz.A;
    const item = await recommend(businessId, agentId, "analytics");
    const before = (await repos.tasks.list(hz.db, businessId, { limit: 200 })).items.length;
    await hz.caller({ userId: ownerId }).inbox.decide({ businessId, itemId: item.id, chosenOption: TOOL_PICK_NOTE.options.notNow });
    const need = await repos.toolNeeds.get(hz.db, businessId, "analytics");
    expect(need?.status).toBe("not_now");
    expect(Math.round((need!.askAgainAt!.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect((await repos.tasks.list(hz.db, businessId, { limit: 200 })).items).toHaveLength(before);
    expect(await repos.toolNeeds.raise(hz.db, businessId, { category: "analytics", reason: "x" })).toMatchObject({ raised: false, why: "not_now" });
  });
});
