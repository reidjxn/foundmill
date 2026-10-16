/**
 * Skills from the library and skill files: deterministic, offline (every change). A skill's instructions reach the
 * agent's system prompt after the house rules and its instructions, and the house rules still open it; a rule-breaking
 * or hijacking skill file is refused at upload with the reason, so it never reaches a prompt.
 */
import { CLUB_RULES_HEADER, INSTRUCTIONS_HEADER, SKILLS_HEADER, buildSystemPrompt, getLibrarySkill, getTemplate, hasClubRulesPrefix, parseSkillFile, type AgentSkillPrompt } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { describe, expect, it } from "vitest";
import { EVAL_BUSINESS_NAME } from "../harness";
import { SKILL_PROMPT_CASES, SKILL_REFUSAL_CASES, type SkillPromptCase } from "../skills/cases";

/** The skill as the runtime carries it: the library entry, or the file after it passed upload. */
function promptSkill(c: SkillPromptCase): AgentSkillPrompt {
  if (c.skill.source === "library") {
    const s = getLibrarySkill(c.skill.key)!;
    return { name: s.attribute.name, source: "library", instructionsMd: s.instructionsMd };
  }
  const parsed = parseSkillFile(c.skill);
  if (!parsed.ok) throw new Error(`${c.id}: ${parsed.error.message}`);
  return { name: parsed.skill.name, source: "upload", instructionsMd: parsed.skill.instructionsMd };
}

describe("skills eval: instructions reach the prompt after the house rules", () => {
  it("cases are well formed", () => {
    expect(new Set([...SKILL_PROMPT_CASES, ...SKILL_REFUSAL_CASES].map((c) => c.id)).size).toBe(SKILL_PROMPT_CASES.length + SKILL_REFUSAL_CASES.length);
    for (const c of SKILL_PROMPT_CASES) expect(() => getTemplate(c.templateKey), c.id).not.toThrow();
  });

  for (const c of SKILL_PROMPT_CASES) {
    it(c.id, () => {
      const system = buildSystemPrompt({ businessName: EVAL_BUSINESS_NAME, appName: APP_NAME, template: getTemplate(c.templateKey), skills: [promptSkill(c)] });
      expect(hasClubRulesPrefix(system), "the house rules open the prompt").toBe(true);
      expect(system.indexOf(CLUB_RULES_HEADER)).toBe(0);
      const section = system.indexOf(SKILLS_HEADER);
      expect(section, "the Skills section follows the instructions").toBeGreaterThan(system.indexOf(INSTRUCTIONS_HEADER));
      expect(system.indexOf(c.mustContain), "the skill's instructions sit inside the Skills section").toBeGreaterThan(section);
      // The skill text appears once, inside its own block, never before the house rules end.
      expect(system.split(c.mustContain)).toHaveLength(2);
      expect(system.lastIndexOf("</skill>")).toBeGreaterThan(system.indexOf(c.mustContain));
    });
  }
});

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
