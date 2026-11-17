/**
 * Offline checks of the mentor eval (WP-04 T10), run in CI: the Chief of Staff's conversation request and the Composer's
 * request carry the founder as trusted JSON (never in the instructions), the founder-facing line no longer says the
 * founder "only reads and decides", the template teaches with a free first move, and the rubric catches what it must.
 * The live run is mentor.eval.test.ts (`pnpm evals`, nightly), which skips without a key.
 */
import { HOUSE_RULES_FOUNDER_LINE, MENTOR_RULES, buildConversationRequest, buildSystemPrompt, chiefOfStaff, voiceRegister } from "@foundmill/agents";
import { MockModelClient } from "@foundmill/models";
import { founderBriefSection, founderContextJson } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { FREE_OPTION_ID, MENTOR_CASES, explainedIdeas, guessedNames, mentorComposerInputs, mentorComposerSystem, mentorConversationInput, mentorProblems, missingHit, runMentorCase, type MentorCase } from "../mentor";

const caseOf = (kind: MentorCase["kind"]) => MENTOR_CASES.find((c) => c.kind === kind)!;
const userJson = (content: string) => JSON.parse(content.replace(/^```json\n|\n```$/g, "")) as Record<string, unknown>;

describe("mentor: the requests carry the founder", () => {
  it("covers the four founders of the spec", () => {
    expect(MENTOR_CASES.map((c) => c.kind)).toEqual(["first_time_no_budget", "operator", "two_cofounders", "no_name"]);
  });

  it("the Chief of Staff's conversation prompt has the founder block in its inputs, and the founder's words never reach the instructions", () => {
    for (const c of MENTOR_CASES) {
      const req = buildConversationRequest(mentorConversationInput(c));
      const inputs = userJson(req.messages[0].content);
      expect(inputs.founder, c.id).toEqual(founderContextJson(c.founder));
      expect(req.system[1]).toContain("founder (who you are talking with");
      if (c.founder.firstName) expect(req.system.join("\n")).not.toContain(c.founder.firstName);
    }
    // The Chief of Staff's own instructions carry the mentor rules.
    const system = buildConversationRequest(mentorConversationInput(caseOf("first_time_no_budget"))).system[0];
    for (const rule of MENTOR_RULES) expect(system).toContain(rule);
  });

  it("the Composer's prompt names the founder input, and its inputs carry the founder as JSON", () => {
    for (const c of MENTOR_CASES) {
      const [, rules] = mentorComposerSystem(c);
      expect(rules).toContain("`founder`, who the note is written to");
      expect(rules).toContain("recommend a free option");
      expect(mentorComposerInputs(c).founder).toEqual(founderContextJson(c.founder));
      if (c.founder.firstName) expect(rules).not.toContain(c.founder.firstName);
    }
  });

  it("a one-founder project's context says nothing about other people; two founders are both named", () => {
    for (const c of MENTOR_CASES.filter((x) => x.founder.others.length === 0)) expect(Object.keys(founderContextJson(c.founder))).not.toContain("other_founders");
    expect(founderContextJson(caseOf("two_cofounders").founder).other_founders).toEqual(["Sam"]);
  });
});

describe("mentor: the stable prefix stays cacheable (free accounts on Haiku 5.5 and GLM-5.3 Flash)", () => {
  const maya = caseOf("first_time_no_budget");
  const dev = caseOf("operator");
  /** Characters to tokens, as the orchestrator's brief budget counts them (about four characters a token). */
  const tokens = (text: string) => Math.ceil(text.length / 4);

  it("the conversation's system blocks (house rules, instructions, skills, then the conversation rules) are byte-identical for two founders", () => {
    const a = buildConversationRequest(mentorConversationInput(maya));
    const b = buildConversationRequest(mentorConversationInput(dev));
    expect(a.system[0]).toBe(b.system[0]);
    expect(a.system[1]).toBe(b.system[1]);
    expect(a.messages[0].content).not.toBe(b.messages[0].content);
    for (const c of [maya, dev]) for (const v of [c.founder.firstName!, ...c.founder.strengths]) expect(a.system.join("\n")).not.toContain(v);
  });

  it("the Composer's system blocks are byte-identical for two founders; the founder is only in the inputs", () => {
    expect(mentorComposerSystem(maya)).toEqual(mentorComposerSystem(dev));
    expect(mentorComposerSystem(maya).join("\n")).not.toMatch(/\d{4}-\d{2}-\d{2}T|Maya|Dev\b/);
  });

  it("a brief with the founder in it comes after the stable block, so the prefix up to the brief is the same for any founder", () => {
    const withBrief = (c: MentorCase) => buildSystemPrompt({ businessName: "Fernway Candles", appName: "Foundmill", template: chiefOfStaff, brief: `# Fernway Candles\n\n${founderBriefSection(c.founder)}` });
    const [a, b] = [withBrief(maya), withBrief(dev)];
    const cut = a.indexOf("## Business brief");
    expect(cut).toBeGreaterThan(0);
    expect(b.indexOf("## Business brief")).toBe(cut);
    expect(a.slice(0, cut)).toBe(b.slice(0, cut));
    expect(a.slice(0, cut)).not.toMatch(/Maya|Dev\b|Name: /);
  });

  it("the whole platform prompt stays under 100K tokens", () => {
    for (const c of MENTOR_CASES) {
      const req = buildConversationRequest(mentorConversationInput(c));
      expect(tokens([...req.system, req.messages[0].content].join("\n")), c.id).toBeLessThan(100_000);
      expect(tokens([...mentorComposerSystem(c), JSON.stringify(mentorComposerInputs(c))].join("\n")), c.id).toBeLessThan(100_000);
    }
  });
});

describe("mentor: the Chief of Staff's words", () => {
  it("the founder line runs the team beside the founder, not so they only read and decide", () => {
    expect(HOUSE_RULES_FOUNDER_LINE).not.toMatch(/only read and decide/);
    expect(HOUSE_RULES_FOUNDER_LINE).toBe("I'm your Chief of Staff. I run the team beside you and tell you what matters and why. Some things are always yours: money, signatures, contracts, deleting things.");
    expect(chiefOfStaff.instructions.role).toBe("Chief of Staff: you run the cycle and help the founder learn to run this project: say what happened, what it means, and the one decision that is theirs, with its reason.");
  });

  it("no example in the template is in euros or recommends spending money as the first move", () => {
    for (const e of chiefOfStaff.instructions.examples) {
      expect(`${e.input} ${e.output}`).not.toContain("€");
      expect(e.output).not.toMatch(/set_budget|enable_channel[^}]*paid_ads|amount_minor:\s*[1-9]|budget_minor:\s*[1-9]/);
    }
    expect(chiefOfStaff.instructions.examples[0]!.output).toMatch(/five people/);
  });

  it("each mentor rule gives its reason, and none tells a founder they need someone", () => {
    for (const rule of MENTOR_RULES) expect(rule).toMatch(/\bbecause\b/);
    expect(MENTOR_RULES.join(" ")).toMatch(/One person is a complete team/);
    expect(missingHit(MENTOR_RULES.join(" "))).toBeNull();
  });

  it("the Chief of Staff speaks in the mentor register", () => {
    expect(voiceRegister("assistant", chiefOfStaff.instructions.tone)).toBe("mentor");
    expect(chiefOfStaff.voice.greeting).toBe("Hi. Ask me what happened, what it means, or what to do next.");
  });
});

describe("mentor: the rubric", () => {
  const first = caseOf("first_time_no_budget");

  it("passes a good reply and catches no name, a guessed name, two lessons, a paid first move, the subtext and a missing person", () => {
    expect(mentorProblems(first, "conversation", "Maya, start with five people you know: it's free. Their answers show who to reach next.", FREE_OPTION_ID)).toEqual([]);
    expect(mentorProblems(first, "conversation", "Start with five people you know.", FREE_OPTION_ID).join()).toMatch(/does not address Maya/);
    expect(mentorProblems(caseOf("no_name"), "note", "Hi Alex, start with five people you know.", null).join()).toMatch(/never gave \(Alex\)/);
    expect(mentorProblems(first, "note", "Maya, a funnel means the steps people take. Conversion means the share who buy.", FREE_OPTION_ID).join()).toMatch(/more than one idea/);
    expect(mentorProblems(first, "note", "Maya, run the ad test.", "ads").join()).toMatch(/not the free option/);
    expect(mentorProblems(first, "note", "Maya, keep your day job while you test this.", FREE_OPTION_ID).join()).toMatch(/subtext/);
    expect(mentorProblems(first, "note", "Maya, you'll want a cofounder for selling.", FREE_OPTION_ID).join()).toMatch(/subtext/);
    expect(mentorProblems(first, "note", "Maya, you are building this alone, so start small.", FREE_OPTION_ID).join()).toMatch(/someone is missing/);
  });

  it("counts explained ideas and guessed names, and lets the known names pass", () => {
    expect(explainedIdeas("A landing page is the one page a stranger sees first, which means it has to say who it is for.")).toBe(1);
    expect(guessedNames("Hi Ana and Sam, here is the plan.", caseOf("two_cofounders").founder)).toEqual([]);
    expect(guessedNames("Hi there, here is the plan.", caseOf("no_name").founder)).toEqual([]);
  });

  it("runs every case end to end on the mock models without an error (what mock-mode founders get)", async () => {
    const client = new MockModelClient();
    for (const c of MENTOR_CASES) {
      const r = await runMentorCase(client, c);
      expect(r.error, c.id).toBeUndefined();
      expect(r.reply, c.id).toBeTruthy();
      expect(r.note, c.id).toBeTruthy();
      expect(missingHit(`${r.reply}\n${r.note}`), c.id).toBeNull();
    }
  });
});
