/**
 * Default skills (WP-06 T6; founder, Nov 16, 2026: D3, D4, D6 call 3): every role comes with the library skills whose
 * `default_for` names it, marked "Came with the role" and removable. These checks keep the defaults within the limits
 * the prompt index holds to, and never give a role a skill that sends it to a tool it lacks.
 */
import { describe, expect, it } from "vitest";
import { renderSkillIndex } from "../club-rules";
import { MAX_SKILLS_PER_AGENT, SKILL_INDEX_MAX_CHARS } from "../skill-files";
import { DEFAULT_SKILLS_VERSION, SKILL_LIBRARY, defaultSkillKeysFor, getLibrarySkill, librarySkillKey, type LibrarySkill } from "../skill-library";
import { attachedSkills } from "../skill-select";
import { ALL_TEMPLATES } from "../templates";

const rowsFor = (templateKey: string) =>
  defaultSkillKeysFor(templateKey).map((key) => {
    const s = getLibrarySkill(key)!;
    return { skillKey: librarySkillKey(key), name: s.attribute.name, source: "library" as const, description: s.description, instructionsMd: s.instructionsMd };
  });

describe("default skills per role", () => {
  it("is the fourth release of defaults: the tool scout (release 2, Nov 22, 2026), the CLI-Anything skills (release 3) and patent preparation for the Legal Lead (release 4)", () => {
    expect(DEFAULT_SKILLS_VERSION).toBe(4);
    expect(SKILL_LIBRARY.filter((s) => s.defaultSince === 2).map((s) => s.key)).toEqual(["tool_scout"]);
    expect(SKILL_LIBRARY.filter((s) => s.defaultSince === 3).map((s) => s.key).sort()).toEqual(["make_brand_assets", "make_documents_and_decks", "make_media_files"]);
    expect(SKILL_LIBRARY.filter((s) => s.defaultSince === 4).map((s) => s.key)).toEqual(["patent_preparation"]);
  });

  it("lists, in catalog order, the skills whose default_for names the template", () => {
    const expected = SKILL_LIBRARY.filter((s) => s.defaultFor.includes("qa_engineer")).map((s) => s.key);
    expect(defaultSkillKeysFor("qa_engineer")).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(defaultSkillKeysFor("no_such_template")).toEqual([]);
  });

  it("offers only skills added after a release when asked since it", () => {
    const base = SKILL_LIBRARY.find((s) => s.defaultFor.includes("planner"))!;
    const later: LibrarySkill = { ...base, key: "later_default", defaultSince: 2 };
    const library = [base, later];
    expect(defaultSkillKeysFor("planner", 0, library)).toEqual([base.key, "later_default"]);
    expect(defaultSkillKeysFor("planner", 1, library)).toEqual(["later_default"]);
    expect(defaultSkillKeysFor("planner", 2, library)).toEqual([]);
  });

  it("keeps every template's defaults within the skill count and the prompt index", () => {
    for (const t of ALL_TEMPLATES) {
      const rows = rowsFor(t.key);
      expect(rows.length, t.key).toBeLessThanOrEqual(MAX_SKILLS_PER_AGENT);
      expect(renderSkillIndex(attachedSkills(t.skills, rows)).length, t.key).toBeLessThanOrEqual(SKILL_INDEX_MAX_CHARS);
    }
  });

  it("gives customer replies to the Chief of Staff for now (founder, Nov 16, 2026: D4)", () => {
    expect(defaultSkillKeysFor("chief_of_staff")).toEqual(expect.arrayContaining(["support_desk", "churn_prevention"]));
  });

  it("makes a skill that runs the suppression check a default only for roles that hold that check", () => {
    const checking = SKILL_LIBRARY.filter((s) => /suppression check/i.test(s.instructionsMd) && s.defaultFor.length > 0);
    expect(checking.map((s) => s.key)).toContain("cold_email");
    for (const s of checking) {
      for (const key of s.defaultFor) {
        const t = ALL_TEMPLATES.find((x) => x.key === key)!;
        const platform = t.tools.filter((g) => g.connectorKey === "platform").flatMap((g) => g.tools);
        expect(platform, `${s.key} on ${key}`).toContain("suppression.check");
      }
    }
  });
});
