import { describe, expect, it } from "vitest";
import { SkillDefinition, SkillTest } from "../types";
import { ALL_TEMPLATES } from "../templates";
import { CRAFT_SKILLS, EXECUTION_SKILLS, JUDGEMENT_SKILLS, SKILL_DEFINITIONS, SKILL_DEFINITIONS_BY_KEY, SPEC_CRAFT_SETS, getSkillDefinition, skillKeysForAgentType } from "../skills/definitions";
import {
  ALL_BLUEPRINTS,
  BLUEPRINT_SKILL_KEYS,
  MAX_TESTS_PER_SKILL,
  MIN_TESTS_PER_SKILL,
  UnknownSkillError,
  generateAllSkillTests,
  generateSkillTests,
  getSkillTests,
  isHeldOut,
  isRedactedTest,
  redactHeldOut,
  scenariosPerBlueprint,
  slugify,
} from "../skills/generate";
import { SCENARIOS, fillScenario, scenariosForSkill } from "../skills/scenarios";

describe("skill definitions (BUILD §11.10)", () => {
  it("defines the five judgement and five execution skills for every agent", () => {
    expect(Object.keys(JUDGEMENT_SKILLS)).toEqual(["planning", "scope_control", "prioritisation", "risk_awareness", "knowing_when_to_ask"]);
    expect(Object.keys(EXECUTION_SKILLS)).toEqual(["speed", "reliability", "tool_use", "cost_efficiency", "communication"]);
    for (const k of [...Object.keys(JUDGEMENT_SKILLS), ...Object.keys(EXECUTION_SKILLS)]) {
      expect(SKILL_DEFINITIONS_BY_KEY[k]?.agentTypes).toEqual(["*"]);
    }
  });

  it("every definition validates and keys are unique", () => {
    const keys = SKILL_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of SKILL_DEFINITIONS) expect(SkillDefinition.safeParse(d).success, d.key).toBe(true);
  });

  it("matches the §11.10 craft table for the named agent types", () => {
    for (const [agentType, craft] of Object.entries(SPEC_CRAFT_SETS)) {
      const template = ALL_TEMPLATES.find((t) => t.agentType === agentType);
      expect(template, agentType).toBeDefined();
      for (const k of craft) expect(template!.skills, `${agentType} missing ${k}`).toContain(k);
    }
  });

  it("every craft skill is used by at least one template and every template skill exists", () => {
    for (const key of Object.keys(CRAFT_SKILLS)) {
      expect(SKILL_DEFINITIONS_BY_KEY[key]!.agentTypes.length, `${key} is unused`).toBeGreaterThan(0);
    }
    for (const t of ALL_TEMPLATES) for (const k of t.skills) expect(getSkillDefinition(k), `${t.key}:${k}`).toBeDefined();
  });

  it("skillKeysForAgentType returns craft + the ten core skills", () => {
    const keys = skillKeysForAgentType("backend_engineer");
    expect(keys).toContain("api_design");
    expect(keys).toContain("planning");
    expect(keys).toContain("communication");
    expect(keys).not.toContain("copywriting");
  });
});

describe("skill test sets (BUILD §11.10 scoring, AC-11.10.2)", () => {
  const all = generateAllSkillTests();

  it("has blueprints for every skill definition and no orphans", () => {
    const defined = new Set(SKILL_DEFINITIONS.map((d) => d.key));
    for (const key of defined) expect(ALL_BLUEPRINTS[key], `no blueprints for ${key}`).toBeDefined();
    for (const key of BLUEPRINT_SKILL_KEYS) expect(defined.has(key), `blueprints for unknown skill ${key}`).toBe(true);
  });

  it("every skill has 12-30 tests with exactly half held out", () => {
    for (const [key, set] of Object.entries(all)) {
      expect(set.tests.length, key).toBeGreaterThanOrEqual(MIN_TESTS_PER_SKILL);
      expect(set.tests.length, key).toBeLessThanOrEqual(MAX_TESTS_PER_SKILL);
      expect(set.heldOutCount * 2, `${key}: ${set.heldOutCount} of ${set.tests.length} held out`).toBe(set.tests.length);
      expect(set.publicCount).toBe(set.tests.length - set.heldOutCount);
    }
  });

  it("every test validates, has unique ids, 2+ rubric lines and a real prompt", () => {
    const ids = new Set<string>();
    for (const set of Object.values(all)) {
      for (const t of set.tests) {
        expect(SkillTest.safeParse(t).success, t.id).toBe(true);
        expect(ids.has(t.id), `duplicate id ${t.id}`).toBe(false);
        ids.add(t.id);
        expect(t.rubric.lines.length).toBeGreaterThanOrEqual(2);
        expect(t.task.prompt).not.toMatch(/\{[a-z_]+\}/);
        expect(t.task.title).not.toMatch(/\{[a-z_]+\}/);
        for (const line of t.rubric.lines) expect(line.criterion).not.toMatch(/\{[a-z_]+\}/);
        expect(t.task.prompt).not.toMatch(/lorem ipsum/i);
      }
    }
  });

  it("tests within a skill are varied: several scenarios and several distinct prompts", () => {
    for (const [key, set] of Object.entries(all)) {
      const scenarios = new Set(set.tests.map((t) => t.scenarioKey));
      expect(scenarios.size, key).toBeGreaterThanOrEqual(4);
      const prompts = new Set(set.tests.map((t) => t.task.prompt));
      expect(prompts.size, key).toBe(set.tests.length);
    }
  });

  it("is deterministic: generating twice yields identical sets", () => {
    const a = generateSkillTests("copywriting");
    const b = generateSkillTests("copywriting");
    expect(a).toEqual(b);
    expect(a.tests.map((t) => t.heldOut)).toEqual(b.tests.map((t) => t.heldOut));
  });

  it("getSkillTests hides held-out tests by default and redactHeldOut strips their content", () => {
    const visible = getSkillTests("planning");
    expect(visible.every((t) => !t.heldOut)).toBe(true);
    const full = getSkillTests("planning", { includeHeldOut: true });
    expect(full.length).toBe(visible.length * 2);
    const redacted = redactHeldOut(full);
    expect(redacted.length).toBe(full.length);
    const hidden = redacted.filter(isRedactedTest);
    expect(hidden.length).toBe(full.length / 2);
    for (const h of hidden) {
      expect(h).not.toHaveProperty("task");
      expect(h).not.toHaveProperty("rubric");
      expect(JSON.stringify(h)).not.toMatch(/prompt|criterion/);
    }
  });

  it("held-out split alternates over the blueprint × scenario grid", () => {
    expect(isHeldOut(0, 0)).toBe(false);
    expect(isHeldOut(0, 1)).toBe(true);
    expect(isHeldOut(1, 0)).toBe(true);
    expect(isHeldOut(1, 1)).toBe(false);
    expect(scenariosPerBlueprint(3)).toBe(4);
    expect(scenariosPerBlueprint(2)).toBe(6);
    expect(scenariosPerBlueprint(5)).toBe(4); // ceil(12/5)=3 → odd total 15 → 4 → 20
    expect(scenariosPerBlueprint(0)).toBe(0);
  });

  it("deterministic checks and fixtures are instantiated without placeholders", () => {
    for (const set of Object.values(all)) {
      for (const t of set.tests) {
        expect(JSON.stringify(t.checks)).not.toMatch(/\{[a-z_]+\}/);
        for (const ref of Object.values(t.task.fixtures)) {
          expect(ref).not.toMatch(/\{[a-z_]+\}/);
          expect(ref).not.toMatch(/\s/);
        }
      }
    }
    expect(slugify("Northwind Skincare")).toBe("northwind_skincare");
    expect(slugify("Hollow & Hearth")).toBe("hollow_hearth");
    expect(slugify("Café Söder")).toBe("cafe_soder");
  });

  it("throws for a skill without blueprints", () => {
    expect(() => generateSkillTests("time_travel")).toThrow(UnknownSkillError);
  });

  it("scenarios cover all seven archetypes and fillScenario rejects unknown fields", () => {
    const archetypes = new Set(SCENARIOS.map((s) => s.archetype));
    expect(archetypes.size).toBe(7);
    expect(fillScenario("{business} sells {product}", SCENARIOS[0]!)).toContain(SCENARIOS[0]!.business);
    expect(() => fillScenario("{nonsense}", SCENARIOS[0]!)).toThrow(/Unknown scenario field/);
    expect(scenariosForSkill("planning", 3).length).toBe(3);
  });
});
