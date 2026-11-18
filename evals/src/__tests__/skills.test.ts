/**
 * Skills from the library and skill files: deterministic, offline (every change). A skill's instructions reach the
 * agent's system prompt after the house rules and its instructions, and the house rules still open it; a rule-breaking
 * or hijacking skill file is refused at upload with the reason, so it never reaches a prompt.
 */
import {
  CLUB_RULES_HEADER,
  INSTRUCTIONS_HEADER,
  SKILLS_HEADER,
  buildChannelCreativeRequest,
  buildFoundationsRequest,
  buildPageQuizRequest,
  buildPostDraftRequest,
  buildProjectPageRequest,
  buildResearchPlanRequest,
  buildSourceProposalRequest,
  buildSourceRelevanceRequest,
  buildSystemPrompt,
  buildTeamCallTurnRequest,
  buildTeamCallWrapUpRequest,
  getLibrarySkill,
  getTemplate,
  hasClubRulesPrefix,
  parseSkillFile,
  type AgentPromptParts,
  type AgentSkillPrompt,
  type ResearchPlanInputs,
} from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { describe, expect, it } from "vitest";
import { CHANNEL_CREATIVE_CASES } from "../channel-creative/cases";
import { FOUNDATIONS_CASES } from "../foundations/cases";
import { EVAL_BUSINESS_NAME } from "../harness";
import { PAGE_QUIZ_CASES } from "../page-quiz";
import { POST_DRAFT_CASES, postDraftEvalFacts } from "../post-draft";
import { PROJECT_PAGE_CASES, projectPageInputs } from "../project-page";
import { SKILL_PROMPT_BUILDERS, SKILL_PROMPT_CASES, SKILL_REFUSAL_CASES, type SkillPromptBuilder, type SkillPromptCase } from "../skills/cases";
import { SOURCE_WATCH_CASES } from "../source-watcher/cases";
import { TEAM_CALL_CASES, turnInputFor, wrapUpInputFor } from "../team-call";

/** The skill as the runtime carries it: the library entry, or the file after it passed upload. */
function promptSkill(c: SkillPromptCase): AgentSkillPrompt {
  if (c.skill.source === "library") {
    const s = getLibrarySkill(c.skill.key)!;
    return { key: `library_${s.key}`, name: s.attribute.name, source: "library", whenToUse: s.whenToUse, instructionsMd: s.instructionsMd };
  }
  const parsed = parseSkillFile(c.skill);
  if (!parsed.ok) throw new Error(`${c.id}: ${parsed.error.message}`);
  return { key: `upload_${c.id}`, name: parsed.skill.name, source: "upload", whenToUse: parsed.skill.description, instructionsMd: parsed.skill.instructionsMd };
}

describe("skills eval: instructions reach the prompt after the house rules", () => {
  it("cases are well formed", () => {
    expect(new Set([...SKILL_PROMPT_CASES, ...SKILL_REFUSAL_CASES].map((c) => c.id)).size).toBe(SKILL_PROMPT_CASES.length + SKILL_REFUSAL_CASES.length);
    for (const c of SKILL_PROMPT_CASES) expect(() => getTemplate(c.templateKey), c.id).not.toThrow();
  });

  it("every builder that speaks as a business's agent has a case", () => {
    expect([...new Set(SKILL_PROMPT_CASES.flatMap((c) => (c.builder ? [c.builder] : [])))].sort()).toEqual([...SKILL_PROMPT_BUILDERS].sort());
  });

  for (const c of SKILL_PROMPT_CASES) {
    it(c.id, () => {
      const system = c.builder ? builderSystem(c.builder, agentOf(c)) : buildSystemPrompt({ businessName: EVAL_BUSINESS_NAME, appName: APP_NAME, template: getTemplate(c.templateKey), skills: [promptSkill(c)] });
      expect(hasClubRulesPrefix(system), "the house rules open the prompt").toBe(true);
      expect(system.indexOf(CLUB_RULES_HEADER)).toBe(0);
      const section = system.indexOf(SKILLS_HEADER);
      expect(section, "the Skills section follows the instructions").toBeGreaterThan(system.indexOf(INSTRUCTIONS_HEADER));
      expect(system.indexOf(c.mustContain), "the skill's instructions sit inside the Skills section").toBeGreaterThan(section);
      // The skill text appears once, inside its own block, never before the house rules end.
      expect(system.split(c.mustContain)).toHaveLength(2);
      expect(system.lastIndexOf("</skill>")).toBeGreaterThan(system.indexOf(c.mustContain));
      // Without the agent the builder renders the template alone, as before.
      if (c.builder) expect(builderSystem(c.builder, undefined)).not.toContain(c.mustContain);
    });
  }
});

/** The business's agent of the case's role, carrying the case's skill (what packages/db `resolveAgentPrompt` returns). */
function agentOf(c: SkillPromptCase): AgentPromptParts {
  const t = getTemplate(c.templateKey);
  return { instructions: t.instructions, description: t.description, skills: [promptSkill(c)] };
}

const researchInputs: ResearchPlanInputs = {
  businessId: "00000000-0000-4000-8000-0000000000aa",
  businessName: EVAL_BUSINESS_NAME,
  archetype: "b2b_saas",
  currency: "USD",
  icp: "Bookkeepers at small accounting firms",
  visionStatement: "Month-end close in a day",
  targetMarkets: ["US"],
  constraints: [],
  roadmapNow: ["Bank feed import"],
  sections: [{ section: "Problem", text: "Month-end reconciliation takes days." }],
  specVersion: 1,
  researcherAgentId: null,
  researcherName: null,
};

/** The first system block of the builder's request, with or without the agent. */
function builderSystem(builder: SkillPromptBuilder, agent: AgentPromptParts | undefined): string {
  const watch = SOURCE_WATCH_CASES[0]!;
  const call = TEAM_CALL_CASES[0]!;
  const relevance = { summary: "", blocks: watch.blocks.map((b) => ({ blockId: b.id, score: 0.9, reason: "" })), topics: [], severity: "normal" as const };
  const requests: Record<SkillPromptBuilder, () => { system: readonly string[] }> = {
    project_page: () => buildProjectPageRequest({ ...projectPageInputs(PROJECT_PAGE_CASES[0]!), agent }),
    foundations: () => buildFoundationsRequest({ ...FOUNDATIONS_CASES[0]!.inputs, agent }),
    page_quiz: () => buildPageQuizRequest({ ...PAGE_QUIZ_CASES[0]!.facts, agent }),
    post_draft: () => buildPostDraftRequest({ ...postDraftEvalFacts(POST_DRAFT_CASES[0]!), agent }),
    channel_creative: () => buildChannelCreativeRequest({ ...CHANNEL_CREATIVE_CASES.find((k) => k.input.channelKey === "email_automation")!.input, agent }),
    research_plan: () => buildResearchPlanRequest({ ...researchInputs, agent }),
    source_relevance: () => buildSourceRelevanceRequest({ businessName: watch.businessName, source: watch.source, content: watch.content, candidates: watch.blocks, agent }),
    source_proposal: () => buildSourceProposalRequest({ businessName: watch.businessName, source: watch.source, content: watch.content, relevance, blocks: watch.blocks, agent }),
    team_call_turn: () => buildTeamCallTurnRequest({ ...turnInputFor(call, "founder_spoke", call.transcript ?? [], 0), chiefOfStaff: agent }),
    team_call_wrap_up: () => buildTeamCallWrapUpRequest({ ...wrapUpInputFor(call, call.transcript ?? []), chiefOfStaff: agent }),
  };
  return requests[builder]().system[0]!;
}

describe("skills eval: rule-breaking and hijacking skill files are refused at upload", () => {
  for (const c of SKILL_REFUSAL_CASES) {
    it(c.id, () => {
      const r = parseSkillFile({ fileName: c.fileName, content: c.content });
      expect(r.ok, `${c.id} must be refused`).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe(c.code);
      expect(r.error.message).toMatch(c.reason);
    });
  }

  it("refuses 100% of the cases (the gate for prompt injection is 100% blocked)", () => {
    const passed = SKILL_REFUSAL_CASES.filter((c) => parseSkillFile({ fileName: c.fileName, content: c.content }).ok);
    expect(passed.map((c) => c.id)).toEqual([]);
  });
});
