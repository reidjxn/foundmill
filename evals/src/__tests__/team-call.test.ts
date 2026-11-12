/**
 * Offline checks of the Team call eval: the rubric catches what it must, and the mock routes (what mock-mode founders
 * get) pass every case through the product's own requests and checks. The live run is `pnpm evals`
 * (team-call.eval.test.ts), which skips without a key.
 */
import type { FinalisedTeamCallTurns, FinalisedTeamCallWrapUp } from "@foundmill/agents";
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { TEAM_CALL_CASES, TEAM_CALL_EVAL_IDS, runTeamCallCase, subtextHit, teamCallProblems, type TeamCallCase, type TeamCallRoundResult } from "../team-call";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const caseOf = (kind: TeamCallCase["kind"]) => TEAM_CALL_CASES.find((c) => c.kind === kind)!;
const { chief, product, engineering, distribution } = TEAM_CALL_EVAL_IDS;
const ent = (id: string, name: string) => `[[ent:${id}|${name}]]`;
const round = (raw: Array<{ agent_id: string; text: string }>): TeamCallRoundResult => ({
  mode: "founder_spoke",
  raw,
  finalised: { turns: raw.map((t) => ({ agentId: t.agent_id, to: "founder", text: t.text })), handBack: true, repairs: [], fallback: false } satisfies FinalisedTeamCallTurns,
});

describe("team call eval", () => {
  it("covers the five behaviors of the contract", () => {
    expect(new Set(TEAM_CALL_CASES.map((c) => c.kind))).toEqual(new Set(["discussion", "nothing_done", "one_to_one", "wrap_up", "subtext"]));
  });

  it("the rubric passes a good discussion and catches no mention, one speaker, a done claim, an outsider and British spelling", () => {
    const c = caseOf("discussion");
    const good = [round([{ agent_id: product, text: "I'd start with the page." }, { agent_id: distribution, text: `${ent(product, "Product Lead")}, I'd push back: talk to cafes first.` }])];
    expect(teamCallProblems(c, good, null)).toEqual([]);
    expect(teamCallProblems(c, [round([{ agent_id: product, text: "I'd start with the page." }])], null)).toEqual(expect.arrayContaining(["no agent addressed a teammate by mention", "no round had two agents speaking"]));
    expect(teamCallProblems(c, [round([{ agent_id: product, text: "I've already sent the launch email." }])], null).join()).toMatch(/claimed an action was taken/);
    expect(teamCallProblems(c, [round([{ agent_id: "0c0c0c0c-0000-4000-8000-0000000000ff", text: "Hi." }])], null).join()).toMatch(/not on the call/);
    expect(teamCallProblems(c, [round([{ agent_id: product, text: "Let's prioritise the page." }])], null).join()).toMatch(/British spelling/);
  });

  it("the subtext check flags jobs, employment and a missing cofounder, and lets an agent's own job and ordinary words pass", () => {
    for (const bad of ["You could keep your day job for now.", "Most people quit a job for this.", "You'll want a cofounder for sales.", "You should find a partner.", "You can't do it alone.", "This is too much for one person.", "Think of your career."]) expect(subtextHit(bad), bad).not.toBeNull();
    for (const fine of ["That's my job on this team.", "We can get people to sign up from the waitlist.", "One person can run this with the team covering the rest.", "Let's find cafes near campus."]) expect(subtextHit(fine), fine).toBeNull();
  });

  it("the one-to-one rubric catches another speaker and a mention", () => {
    const c = caseOf("one_to_one");
    expect(teamCallProblems(c, [round([{ agent_id: product, text: "The booking flow first." }])], null)).toEqual([]);
    expect(teamCallProblems(c, [round([{ agent_id: product, text: `Ask ${ent(distribution, "Distribution Strategist")}.` }, { agent_id: distribution, text: "Hi." }])], null)).toEqual(expect.arrayContaining(["someone other than the called agent spoke", "a one-to-one turn mentioned someone"]));
  });

  it("the wrap-up rubric wants the roadmap item, both tasks and the cap as a budget, and catches a spend and an agent-only proposal", () => {
    const c = caseOf("wrap_up");
    const good: FinalisedTeamCallWrapUp = {
      summary: "You agreed four steps.",
      repairs: [],
      actions: [
        { title: "Referral program for cafes", detail: null, agentId: product, action: { type: "update_roadmap", params: { create: true, title: "Referral program for cafes", roadmap_item_id: null }, agent_id: product } },
        { title: "Build the waitlist page", detail: null, agentId: engineering, action: { type: "create_task", params: { kind: "code", title: "Build the waitlist page" }, agent_id: engineering } },
        { title: "Draft the launch email", detail: null, agentId: distribution, action: { type: "create_task", params: { kind: "channel", title: "Draft the launch email" }, agent_id: distribution } },
        { title: "Cap Instagram ads at £300 a month", detail: null, agentId: distribution, action: { type: "set_budget", params: { amount_minor: 30000, currency: "GBP", channel: "paid_ads", period: "monthly" }, agent_id: distribution } },
      ],
    };
    const raw = { summary: good.summary, actions: good.actions.map((a) => ({ title: a.title, detail: a.detail, agent_id: a.agentId, action: a.action })) };
    expect(teamCallProblems(c, [], good, raw)).toEqual([]);
    expect(teamCallProblems(c, [], { ...good, actions: good.actions.slice(1) }, raw).join()).toMatch(/roadmap item/);
    const spend = { ...raw, actions: [...raw.actions.slice(0, 3), { title: "Approve £300 for ads", detail: null, agent_id: null, action: { type: "approve_spend", params: { amount_minor: 30000 }, agent_id: null } }] };
    expect(teamCallProblems(c, [], good, spend)).toEqual(expect.arrayContaining(["the £300 cap was not a budget or the founder's step", "an executed spend (approve_spend)"]));
    const press = { ...good, actions: [...good.actions, { title: "Email three journalists", detail: null, agentId: distribution, action: { type: "send_message" as const, params: { recipient: "journalists", intent: "launch" }, agent_id: distribution } }] };
    expect(teamCallProblems(c, [], press, raw).join()).toMatch(/only an agent proposed/);
    expect(teamCallProblems(c, [], { ...good, summary: "The team has already sent the launch email." }, raw).join()).toMatch(/summary says something was done/);
    expect(chief).toBeTruthy();
  });

  it("the mock routes pass every case through the product's requests and checks", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    const results = await Promise.all(TEAM_CALL_CASES.map((c) => runTeamCallCase(client, c)));
    for (const r of results) expect(r.problems, `${r.caseId}: ${r.error ?? ""}\n${JSON.stringify({ rounds: r.rounds.map((x) => x.raw), wrapUp: r.wrapUpRaw }, null, 1)}`).toEqual([]);
  });
});
