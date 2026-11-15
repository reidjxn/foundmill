import { describe, expect, it } from "vitest";
import { TeamCallTurnsOutput, TeamCallWrapUpOutput } from "../team-call-schema";
import { MockModelClient } from "./index";
import { MOCK_TEAM_CALL_FALLBACK } from "./teamCall";
import { promptWith } from "./fixtures.test-helpers";

const COS = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const GROWTH = "33333333-3333-4333-8333-333333333333";

const participants = [
  { id: COS, name: "Chief of Staff", display_name: "Chief of Staff", role: "Chief of Staff", department: null, remit: "I run the team so you only read and decide.", talks_like: { greeting: "Hi.", ack: ["Got it.", "Noted."] }, is_chief_of_staff: true },
  { id: PRODUCT, name: "Product Lead", display_name: "Ada", role: "Product lead", department: "Product", remit: "I turn your idea into a specification and a roadmap of what to build first.", talks_like: { greeting: "Hi.", ack: ["Understood. More to come."] }, is_chief_of_staff: false },
  { id: GROWTH, name: "Distribution Strategist", display_name: "Rio", role: "Distribution strategist", department: "Marketing", remit: "I pick the channels that reach your first customers and plan the launch email.", talks_like: null, is_chief_of_staff: false },
];

const turnInput = (over: Record<string, unknown>) => ({ business: { name: "Shiftly", currency: "GBP" }, founder_name: "Sam", kind: "team", mode: "founder_spoke", topic: null, agent_rounds_since_founder: 0, participants, founder_lines: [], founder_just_said: null, ...over });

async function turns(over: Record<string, unknown>, untrusted?: Record<string, unknown>) {
  const messages = promptWith(turnInput(over));
  if (untrusted) messages[0]!.content += `\n\n<untrusted_content kind="call_transcript">\n${JSON.stringify(untrusted)}\n</untrusted_content>`;
  const r = await new MockModelClient().complete({ route: "teamCallTurn", messages, schema: TeamCallTurnsOutput });
  expect(r.repaired).toBe(false);
  return r.json;
}

const NO_DIGITS = /\d/;
const DONE = /\b(?:I(?:'ve| have)\s+(?:sent|booked|filed|paid|published|started|created)|has been (?:sent|booked|filed|paid))\b/i;

describe("mock teamCallTurn", () => {
  it("opens with the Chief of Staff greeting the founder by name, one more agent, and hands back with a question", async () => {
    const out = await turns({ mode: "opening", round: 0 });
    expect(out.turns[0]!.agent_id).toBe(COS);
    expect(out.turns[0]!.text).toContain("Sam");
    expect(out.turns).toHaveLength(2);
    expect(out.turns[1]!.text).toContain(`[[ent:${COS}|Chief of Staff]]`);
    expect(out.turns[1]!.text).toMatch(/\?$/);
    expect(out.hand_back).toBe(true);
  });

  it("the agent whose role fits the founder's words answers first, and a second builds on it by mention", async () => {
    const said = "How do we reach our first customers with a launch email?";
    const out = await turns({ round: 1, founder_lines: [{ n: 1, text: said }], founder_just_said: said });
    expect(out.turns[0]!.agent_id).toBe(GROWTH);
    expect(out.turns[0]!.text).toContain("first customers");
    expect(out.turns[0]!.text).toContain("launch email");
    expect(out.turns[1]!.agent_id).not.toBe(GROWTH);
    expect(out.turns[1]!.text).toContain(`[[ent:${GROWTH}|Distribution Strategist]]`);
    // Only the acknowledgement's first sentence is used.
    expect(out.turns.map((t) => t.text).join(" ")).not.toContain("More to come");
  });

  it("hand_back alternates by round, and the last agent-only round before the limit hands back", async () => {
    const said = "What should go on the roadmap first?";
    const odd = await turns({ round: 1, founder_lines: [{ n: 1, text: said }], founder_just_said: said });
    const even = await turns({ round: 2, founder_lines: [{ n: 1, text: said }, { n: 4, text: said }], founder_just_said: said });
    expect(odd.hand_back).toBe(false);
    expect(odd.turns[odd.turns.length - 1]!.to).toEqual({ agent_id: odd.turns[0]!.agent_id });
    expect(even.hand_back).toBe(true);
    expect(even.turns[even.turns.length - 1]!.to).toBe("founder");
    expect(even.turns[even.turns.length - 1]!.text).toMatch(/\?$/);
    const atLimit = await turns({ mode: "continue", round: 3, agent_rounds_since_founder: 2, founder_lines: [{ n: 1, text: said }] });
    expect(atLimit.hand_back).toBe(true);
  });

  it("an agent-only round picks up from whoever spoke last, naming them, and that speaker does not open it", async () => {
    const out = await turns({ mode: "continue", round: 3, agent_rounds_since_founder: 0, founder_lines: [{ n: 1, text: "Let's talk about the roadmap." }] }, { call_transcript: [{ n: 2, agent_id: PRODUCT, text: "earlier" }] });
    expect(out.turns[0]!.agent_id).not.toBe(PRODUCT);
    expect(out.turns[0]!.text).toContain(`[[ent:${PRODUCT}|Product Lead]]`);
  });

  it("a one-to-one call has only the called agent, always handing back", async () => {
    const said = "How are the channels looking?";
    const out = await turns({ kind: "one_to_one", participants: [participants[1]], round: 1, founder_lines: [{ n: 1, text: said }], founder_just_said: said });
    expect(out.turns.every((t) => t.agent_id === PRODUCT)).toBe(true);
    expect(out.turns.every((t) => t.to === "founder")).toBe(true);
    expect(out.hand_back).toBe(true);
  });

  it("is deterministic, carries no figure, no claim of work done, no markup but mentions, and never a self-introduction", async () => {
    const said = "Can we get ten cafes signed up by Friday?";
    const a = await turns({ round: 1, founder_lines: [{ n: 1, text: said }], founder_just_said: said });
    const b = await turns({ round: 1, founder_lines: [{ n: 1, text: said }], founder_just_said: said });
    expect(a).toEqual(b);
    for (const mode of ["opening", "founder_spoke", "continue"]) {
      const out = await turns({ mode, round: 2, founder_lines: [{ n: 1, text: "Talk me through the roadmap." }], founder_just_said: "Talk me through the roadmap." });
      for (const t of out.turns) {
        const prose = t.text.replace(/\[\[ent:[^\]]+\]\]/g, "");
        expect(prose, mode).not.toMatch(NO_DIGITS);
        expect(prose, mode).not.toMatch(DONE);
        expect(prose, mode).not.toMatch(/[*#`_]|https?:/);
        expect(prose, mode).not.toMatch(/\bI(?:'m| am) (?:Chief of Staff|Product Lead|Distribution Strategist|Ada|Rio)\b/);
        expect(prose, mode).not.toMatch(/\b(?:job|employ|career|cofounder|co-founder)/i);
      }
    }
  });

  it("without participants it still answers within the schema with the hand-back line", async () => {
    const out = await turns({ participants: [] });
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0]!.text).toBe(MOCK_TEAM_CALL_FALLBACK);
    expect(out.hand_back).toBe(true);
  });
});

describe("mock teamCallWrapUp", () => {
  const wrap = async (lines: string[]) => {
    const r = await new MockModelClient().complete({
      route: "teamCallWrapUp",
      messages: promptWith({ business: { name: "Shiftly", currency: "GBP" }, founder_name: "Sam", kind: "team", agents: participants.map((p) => ({ id: p.id, name: p.name, role: p.role, department: p.department })), roadmap: [{ id: "44444444-4444-4444-8444-444444444444", title: "Shift booking", horizon: "now" }], founder_lines: lines.map((text, i) => ({ n: i * 2 + 1, text })) }),
      schema: TeamCallWrapUpOutput,
    });
    expect(r.repaired).toBe(false);
    return r.json;
  };

  it("keeps the rule engine's actions sentence by sentence: work, a roadmap item, a budget, and a payment as the founder's step", async () => {
    const out = await wrap(["Let's build a waitlist page. Add a referral program to the roadmap.", "Spend up to £200 on paid ads next month. Pay the designer invoice."]);
    const byType = (t: string) => out.actions.filter((a) => a.action.type === t);
    expect(byType("create_task").map((a) => a.title)).toContain("Build a waitlist page");
    expect(byType("update_roadmap")).toEqual([expect.objectContaining({ title: "Referral program", action: expect.objectContaining({ params: expect.objectContaining({ create: true, title: "Referral program" }) }) })]);
    expect(byType("set_budget")[0]!.action.params).toMatchObject({ amount_minor: 20000, currency: "GBP", channel: "paid_ads" });
    expect(byType("request_human_action").map((a) => a.title)).toEqual(["Pay the designer invoice"]);
    expect(byType("approve_spend")).toEqual([]);
    expect(byType("reply_only")).toEqual([]);
    // One gated sentence never makes the others the founder's step.
    expect(byType("request_human_action")).toHaveLength(1);
    expect(out.summary).toMatch(/^Sam raised four points on the call: let's build a waitlist page; add a referral program to the roadmap;/);
  });

  it("a roadmap change naming an item keeps its id; a question files nothing", async () => {
    const out = await wrap(["Push the shift booking roadmap item to next quarter.", "What do you all think about pricing?"]);
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]!.action).toMatchObject({ type: "update_roadmap", params: { roadmap_item_id: "44444444-4444-4444-8444-444444444444" } });
  });

  it("nothing said, nothing filed", async () => {
    const out = await wrap([]);
    expect(out.actions).toEqual([]);
    expect(out.summary.length).toBeGreaterThan(10);
  });
});
