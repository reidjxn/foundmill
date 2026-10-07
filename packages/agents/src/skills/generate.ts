/**
 * Skill test-set generation (BUILD §11.10 "Test set per skill: 12–30 tasks with rubrics … Half held out, never shown").
 *
 * A test set is `blueprints × scenarios`: every skill has hand-written task blueprints (see ./blueprints) with `{field}`
 * placeholders, and each blueprint is instantiated against several fictional businesses from ./scenarios. The result is
 * deterministic (same key → same ids, same held-out split), varied (different products, markets, currencies) and
 * meaningful (each prompt is a real task with rubric lines a grader can score).
 *
 * Held-out tests are marked `heldOut: true`; `getSkillTests` strips them by default and `redactHeldOut` removes the task
 * and rubric from any held-out test that must still be counted (AC-11.10.2).
 */
import { type DeterministicCheck, type Rubric, SkillTest, type SkillTask } from "../types";
import { type Blueprint, type BlueprintSet } from "./blueprints/_types";
import { CORE_BLUEPRINTS } from "./blueprints/core";
import { CHANNEL_BLUEPRINTS } from "./blueprints/channels";
import { ENGINEERING_BLUEPRINTS } from "./blueprints/engineering";
import { LEAD_BLUEPRINTS } from "./blueprints/leads";
import { SPECIALIST_BLUEPRINTS } from "./blueprints/specialists";
import { UTILITY_BLUEPRINTS } from "./blueprints/utilities";
import { fillScenario, fnv1a, SCENARIOS, type Scenario } from "./scenarios";

/** Minimum tests per skill (BUILD §11.10 "12–30 tasks"). */
export const MIN_TESTS_PER_SKILL = 12;
export const MAX_TESTS_PER_SKILL = 30;

export const ALL_BLUEPRINTS: BlueprintSet = Object.freeze({
  ...CORE_BLUEPRINTS,
  ...LEAD_BLUEPRINTS,
  ...ENGINEERING_BLUEPRINTS,
  ...CHANNEL_BLUEPRINTS,
  ...SPECIALIST_BLUEPRINTS,
  ...UTILITY_BLUEPRINTS,
});

export const BLUEPRINT_SKILL_KEYS: readonly string[] = Object.freeze(Object.keys(ALL_BLUEPRINTS));

export class UnknownSkillError extends Error {
  constructor(readonly skillKey: string) {
    super(`No test blueprints for skill "${skillKey}"`);
    this.name = "UnknownSkillError";
  }
}

/** How many scenarios each blueprint is instantiated against so the set reaches the minimum with an even count. */
export function scenariosPerBlueprint(blueprintCount: number, minTests = MIN_TESTS_PER_SKILL): number {
  if (blueprintCount <= 0) return 0;
  let s = Math.ceil(minTests / blueprintCount);
  if ((s * blueprintCount) % 2 !== 0) s += 1; // exactly half held out needs an even total
  return Math.min(s, SCENARIOS.length);
}

/** Fixture refs and ids need slugs, not display names ("Northwind Skincare" → "northwind_skincare"). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fillSlug(text: string, scenario: Scenario): string {
  return text.replace(/\{([a-z_]+)\}/g, (_m, field: string) => {
    if (!(field in scenario)) throw new Error(`Unknown scenario field {${field}} in fixture ref "${text}"`);
    return slugify(scenario[field as keyof Scenario]);
  });
}

function fillCheck(check: DeterministicCheck, scenario: Scenario): DeterministicCheck {
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(check.params)) {
    if (typeof v === "string") params[k] = fillScenario(v, scenario);
    else if (Array.isArray(v)) params[k] = v.map((x) => (typeof x === "string" ? fillScenario(x, scenario) : x));
    else params[k] = v;
  }
  return { kind: check.kind, params };
}

/** Deterministic held-out assignment: alternates across the blueprint × scenario grid so every blueprint and every
 *  scenario contributes to both halves. With an even total exactly half are held out. */
export function isHeldOut(blueprintIndex: number, scenarioIndex: number): boolean {
  return (blueprintIndex + scenarioIndex) % 2 === 1;
}

/** Every task closes with the business context the sandbox would otherwise lack (no brief is mounted in a skill test). */
export function scenarioContext(scenario: Scenario): string {
  return `Context: ${scenario.business} sells ${scenario.product} to ${scenario.customer} in ${scenario.market} at ${scenario.price}; founder ${scenario.founder}; business currency ${scenario.currency}.`;
}

export interface GenerateOptions {
  /** Override the scenario count per blueprint (bounded by the scenario catalogue). */
  scenariosPerBlueprint?: number;
}

export interface SkillTestSet {
  skillKey: string;
  tests: SkillTest[];
  heldOutCount: number;
  publicCount: number;
}

export function instantiateBlueprint(skillKey: string, blueprint: Blueprint, blueprintIndex: number, scenario: Scenario, scenarioIndex: number): SkillTest {
  const task: SkillTask = {
    title: fillScenario(blueprint.title, scenario),
    prompt: `${fillScenario(blueprint.prompt, scenario)}\n\n${scenarioContext(scenario)}`,
    fixtures: Object.fromEntries(Object.entries(blueprint.fixtures ?? {}).map(([k, v]) => [k, fillSlug(v, scenario)])),
    mockTools: [...(blueprint.mockTools ?? [])],
  };
  const rubric: Rubric = {
    lines: blueprint.rubric.map((criterion) => ({ criterion: fillScenario(criterion, scenario), weight: 1 })),
    passThreshold: 0.6,
  };
  const scenarioKey = scenario.key;
  const test = {
    id: `${skillKey}.${blueprintIndex + 1}.${scenarioKey}`,
    skillKey,
    task,
    rubric,
    checks: (blueprint.checks ?? []).map((c) => fillCheck(c, scenario)),
    heldOut: isHeldOut(blueprintIndex, scenarioIndex),
    scenarioKey,
  };
  return SkillTest.parse(test);
}

/** Generate the full (public + held-out) test set for one skill. Throws for a skill without blueprints. */
export function generateSkillTests(skillKey: string, options: GenerateOptions = {}): SkillTestSet {
  const blueprints = ALL_BLUEPRINTS[skillKey];
  if (!blueprints || blueprints.length === 0) throw new UnknownSkillError(skillKey);
  const perBlueprint = Math.min(options.scenariosPerBlueprint ?? scenariosPerBlueprint(blueprints.length), SCENARIOS.length);
  const start = fnv1a(skillKey) % SCENARIOS.length;
  const tests: SkillTest[] = [];
  blueprints.forEach((blueprint, bi) => {
    for (let si = 0; si < perBlueprint; si++) {
      // Each blueprint walks a different window of the scenario ring so the set covers more businesses.
      const scenario = SCENARIOS[(start + bi * perBlueprint + si) % SCENARIOS.length]!;
      tests.push(instantiateBlueprint(skillKey, blueprint, bi, scenario, si));
    }
  });
  const heldOutCount = tests.filter((t) => t.heldOut).length;
  return { skillKey, tests, heldOutCount, publicCount: tests.length - heldOutCount };
}

const CACHE = new Map<string, SkillTestSet>();

/** Cached accessor; sets are immutable data so one instance per process is enough. */
export function getSkillTestSet(skillKey: string): SkillTestSet {
  let set = CACHE.get(skillKey);
  if (!set) {
    set = generateSkillTests(skillKey);
    CACHE.set(skillKey, set);
  }
  return set;
}

export interface GetSkillTestsOptions {
  /** Only the training runner may pass true; APIs and the UI never see held-out tests (AC-11.10.2). */
  includeHeldOut?: boolean;
}

/** Tests for a skill. By default held-out tests are excluded entirely. */
export function getSkillTests(skillKey: string, options: GetSkillTestsOptions = {}): SkillTest[] {
  const set = getSkillTestSet(skillKey);
  return options.includeHeldOut ? [...set.tests] : set.tests.filter((t) => !t.heldOut);
}

/** A held-out test with its content removed: safe to count and display as "held out" without revealing the task. */
export interface RedactedSkillTest {
  id: string;
  skillKey: string;
  heldOut: true;
  scenarioKey: string;
}
export type PublicSkillTest = SkillTest | RedactedSkillTest;

export function isRedactedTest(t: PublicSkillTest): t is RedactedSkillTest {
  return !("task" in t);
}

/** Replace every held-out test with its redacted form; public tests pass through unchanged. */
export function redactHeldOut(tests: readonly SkillTest[]): PublicSkillTest[] {
  return tests.map((t) => (t.heldOut ? { id: t.id, skillKey: t.skillKey, heldOut: true as const, scenarioKey: t.scenarioKey } : t));
}

/** Generate every skill's test set (used by tests and by the training seed). */
export function generateAllSkillTests(): Record<string, SkillTestSet> {
  const out: Record<string, SkillTestSet> = {};
  for (const key of BLUEPRINT_SKILL_KEYS) out[key] = getSkillTestSet(key);
  return out;
}
