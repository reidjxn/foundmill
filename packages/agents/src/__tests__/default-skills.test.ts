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
  it("is the second release of defaults: T13's two coding skills (founder, Nov 18, 2026)", () => {
    expect(DEFAULT_SKILLS_VERSION).toBe(2);
    expect(defaultSkillKeysFor("backend_engineer", 1)).toEqual(["smallest_change", "terse_working_notes"]);
    expect(defaultSkillKeysFor("chief_of_staff", 1)).toEqual([]);
  });

  it("gives every role that writes code both coding skills, loaded up front when the preload switch is on", () => {
    const code = ALL_TEMPLATES.filter((t) => t.taskKinds.includes("code")).map((t) => t.key);
    expect(code.length).toBeGreaterThan(0);
    for (const key of code) expect(defaultSkillKeysFor(key), key).toEqual(expect.arrayContaining(["coding_discipline", "smallest_change", "terse_working_notes"]));
    for (const key of ["smallest_change", "terse_working_notes"]) expect(getLibrarySkill(key)!.loadAlways, key).toBe(true);
    expect(SKILL_LIBRARY.filter((s) => s.loadAlways).map((s) => s.key)).toEqual(["smallest_change", "terse_working_notes"]);
  });

  it("keeps everything a person reads in full sentences: the terse skill says so in its first section", () => {
    const body = getLibrarySkill("terse_working_notes")!.instructionsMd;
    const first = body.slice(0, body.indexOf("## Before you start"));
    for (const words of ["never for anything a person reads", "plain full sentences", "pull request text", "commit messages", "email"]) expect(first, words).toContain(words);
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
