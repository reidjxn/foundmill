/**
 * Agent package vocabulary (BUILD §9.2, §11.10, §12).
 *
 * Shared enums (ModelKey, SkillGroup, AgentLayer, TaskKind, ChannelKey, ModuleKey, Archetype, ...) come from
 * `@foundmill/shared` and are never redeclared here. This file adds the Zod specs that are specific to agent
 * templates, agent versions, skills and skill tests.
 */
import { z } from "zod";
import type { ROUTES as ModelRoutes } from "@foundmill/models/routing";
import {
  AgentLayer,
  Archetype,
  ChannelKey,
  DeptColourToken,
  EventType,
  ModelKey,
  ModuleKey,
  SkillGroup,
  TaskKind,
} from "@foundmill/shared";

// ---------------------------------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------------------------------

/** snake_case identifier used for template keys, skill keys and connector keys. */
export const SnakeKey = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key expected");
export type SnakeKey = z.infer<typeof SnakeKey>;

/** Route keys from packages/models/src/routing.ts (BUILD §10.1). Kept as a literal union so this package never imports model ids. */
export const ROUTE_KEYS = [
  "inboxComposer",
  "planCompiler",
  "chiefOfStaff",
  "departmentLead",
  "planner",
  "codeReview",
  "ideation",
  "skillGrader",
  "coach",
  "worker",
  "journeyCommentary",
  "nightlyBatch",
  "linker",
  "classifier",
  "categoriser",
  "quarantinedReader",
  "moderation",
] as const;
export const RouteKey = z.enum(ROUTE_KEYS);
export type RouteKey = (typeof ROUTE_KEYS)[number];

/** Compile-time guard: the local route list must match packages/models exactly (both directions). */
type RoutesMatch = [keyof typeof ModelRoutes] extends [RouteKey] ? ([RouteKey] extends [keyof typeof ModelRoutes] ? true : never) : never;
const _routesMatch: RoutesMatch = true;
void _routesMatch;

/** Default model per route (mirror of BUILD §10.1; the authoritative table is packages/models/src/routing.ts). */
export const ROUTE_DEFAULT_MODEL: Record<RouteKey, ModelKey> = {
  inboxComposer: "opus",
  planCompiler: "opus",
  chiefOfStaff: "opus",
  departmentLead: "opus",
  planner: "opus",
  codeReview: "opus",
  ideation: "opus",
  skillGrader: "opus",
  coach: "opus",
  worker: "sonnet",
  journeyCommentary: "sonnet",
  nightlyBatch: "sonnet",
  linker: "haiku",
  classifier: "haiku",
  categoriser: "haiku",
  quarantinedReader: "haiku",
  moderation: "haiku",
};

// ---------------------------------------------------------------------------------------------------------------------
// Agent version (BUILD §9.2) — exactly the shape stored in `agent_versions`
// ---------------------------------------------------------------------------------------------------------------------

export const AgentExample = z.object({
  input: z.string().min(1),
  output: z.string().min(1),
});
export type AgentExample = z.infer<typeof AgentExample>;

export const AgentInstructions = z.object({
  role: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  rules: z.array(z.string().min(1)).min(1),
  playbook: z.array(z.string().min(1)).min(1),
  tone: z.string().min(1),
  examples: z.array(AgentExample),
});
export type AgentInstructions = z.infer<typeof AgentInstructions>;

/** MCP tools reachable through the gateway: a connector key plus the tool names on that connector. */
export const ToolGrant = z.object({
  connectorKey: SnakeKey,
  tools: z.array(z.string().min(1)).min(1),
});
export type ToolGrant = z.infer<typeof ToolGrant>;

export const AUTONOMY_MODES = ["inherit", "lower", "higher"] as const;
export const AutonomyMode = z.enum(AUTONOMY_MODES);
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const Autonomy = z.object({
  mode: AutonomyMode,
  spendCapMinor: z.number().int().nonnegative(),
  approvalThresholdMinor: z.number().int().nonnegative(),
});
export type Autonomy = z.infer<typeof Autonomy>;

export const Negotiation = z.object({
  enabled: z.boolean(),
  priceMinMinor: z.number().int().nonnegative().optional(),
  priceMaxMinor: z.number().int().nonnegative().optional(),
  walkAwayMinor: z.number().int().nonnegative().optional(),
  maxConcessionPct: z.number().min(0).max(100).optional(),
  topics: z.array(z.string().min(1)),
});
export type Negotiation = z.infer<typeof Negotiation>;

export const Schedule = z.object({
  cron: z.string().min(1).optional(),
  triggers: z.array(EventType).optional(),
});
export type Schedule = z.infer<typeof Schedule>;

/** Stored per agent version (BUILD §9.2 `AgentVersion`). */
export const AgentVersionSpec = z.object({
  agentId: z.string().min(1),
  version: z.number().int().positive(),
  description: z.string().min(1),
  instructions: AgentInstructions,
  tools: z.array(ToolGrant),
  modelKey: ModelKey,
  skills: z.array(SnakeKey),
  autonomy: Autonomy,
  negotiation: Negotiation.optional(),
  schedule: Schedule.optional(),
});
export type AgentVersionSpec = z.infer<typeof AgentVersionSpec>;

// ---------------------------------------------------------------------------------------------------------------------
// Agent template (catalogue entry a business hires from; AC-11.1.6 "initial skills from template baselines")
// ---------------------------------------------------------------------------------------------------------------------

export const TEMPLATE_FAMILIES = ["assistant", "lead", "worker", "channel", "specialist", "utility"] as const;
export const TemplateFamily = z.enum(TEMPLATE_FAMILIES);
export type TemplateFamily = (typeof TEMPLATE_FAMILIES)[number];

/** A trait is a short label derived from the instructions ("Writes tests first"). */
export const Trait = z.string().min(3).max(48);

export const AgentTemplate = z
  .object({
    key: SnakeKey,
    /** Display name used when the agent is hired (the founder can rename). */
    name: z.string().min(1),
    /** Job title shown on the profile header and squad table. */
    role: z.string().min(1),
    layer: AgentLayer,
    family: TemplateFamily,
    /** `agent_type` in the agents table; the key skill definitions and craft sets are indexed by. */
    agentType: SnakeKey,
    /** Which module's department hires this agent by default (null for cross-cutting agents such as the Chief of Staff). */
    module: ModuleKey.nullable(),
    /** Set for the 15 channel engine agents. */
    channelKey: ChannelKey.optional(),
    /** Task kinds this template is staffed for (BUILD §7.2 tasks.kind). */
    taskKinds: z.array(TaskKind).min(1),
    description: z.string().min(40),
    instructions: AgentInstructions,
    tools: z.array(ToolGrant),
    /** Routing entry in packages/models (BUILD §10.1). */
    route: RouteKey,
    modelKey: ModelKey,
    skills: z.array(SnakeKey).min(1),
    autonomy: Autonomy,
    negotiation: Negotiation.optional(),
    schedule: Schedule.optional(),
    /** Derived from instructions by `deriveTraits`; stored so the UI never re-derives. */
    traits: z.array(Trait).min(1).max(8),
    /** Baseline tested rating (1–20) applied to every skill when the agent is hired (AC-11.1.6). */
    baselineRating: z.number().int().min(1).max(20),
    /** Approximate monthly wage cap in minor units (tokens + sandbox + tools), labelled Estimate in the UI. */
    wageCapMinor: z.number().int().nonnegative(),
    /** Capabilities this template never has, surfaced on the profile as "Never does". */
    neverDoes: z.array(z.string().min(1)).min(1),
  })
  .superRefine((t, ctx) => {
    if (t.family === "channel" && !t.channelKey) {
      ctx.addIssue({ code: "custom", path: ["channelKey"], message: "channel templates must set channelKey" });
    }
    if (t.family !== "channel" && t.channelKey) {
      ctx.addIssue({ code: "custom", path: ["channelKey"], message: "only channel templates may set channelKey" });
    }
    if (t.modelKey !== ROUTE_DEFAULT_MODEL[t.route]) {
      ctx.addIssue({
        code: "custom",
        path: ["modelKey"],
        message: `modelKey ${t.modelKey} does not match the default for route ${t.route} (${ROUTE_DEFAULT_MODEL[t.route]})`,
      });
    }
    const layerForFamily: Record<TemplateFamily, AgentLayer> = {
      assistant: "assistant",
      lead: "lead",
      worker: "worker",
      channel: "worker",
      specialist: "worker",
      utility: "utility",
    };
    if (layerForFamily[t.family] !== t.layer) {
      ctx.addIssue({ code: "custom", path: ["layer"], message: `family ${t.family} implies layer ${layerForFamily[t.family]}` });
    }
  });
export type AgentTemplate = z.infer<typeof AgentTemplate>;

// ---------------------------------------------------------------------------------------------------------------------
// Skills (BUILD §11.10)
// ---------------------------------------------------------------------------------------------------------------------

export const SkillDefinition = z.object({
  key: SnakeKey,
  name: z.string().min(1),
  description: z.string().min(20),
  group: SkillGroup,
  /** Agent types this skill applies to. `["*"]` means every agent (judgement and execution skills). */
  agentTypes: z.array(z.string().min(1)).min(1),
  custom: z.boolean().default(false),
});
export type SkillDefinition = z.infer<typeof SkillDefinition>;

/** One rubric line the grader scores 0–1 (BUILD §12.5). */
export const RubricLine = z.object({
  criterion: z.string().min(8),
  /** Relative weight; the grader's per-line scores are combined with these weights. */
  weight: z.number().positive().default(1),
});
export type RubricLine = z.infer<typeof RubricLine>;

export const Rubric = z.object({
  lines: z.array(RubricLine).min(2),
  /** Pass threshold on the weighted mean, used for the deterministic "task passed" boolean. */
  passThreshold: z.number().min(0).max(1).default(0.6),
});
export type Rubric = z.infer<typeof Rubric>;

/** Deterministic checks run before the Opus grader (BUILD §11.10 "deterministic checks first"). */
export const DETERMINISTIC_CHECK_KINDS = [
  "json_schema_valid",
  "tests_pass",
  "policy_respected",
  "entity_links_valid",
  "word_count",
  "contains_all",
  "contains_none",
  "no_tool_calls",
  "cites_source_ids",
] as const;
export const DeterministicCheckKind = z.enum(DETERMINISTIC_CHECK_KINDS);
export type DeterministicCheckKind = (typeof DETERMINISTIC_CHECK_KINDS)[number];

export const DeterministicCheck = z.object({
  kind: DeterministicCheckKind,
  /** Check-specific parameters, e.g. `{ min: 60, max: 180 }` for word_count or `{ terms: [...] }` for contains_*. */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type DeterministicCheck = z.infer<typeof DeterministicCheck>;

export const SkillTask = z.object({
  title: z.string().min(8),
  /** The prompt handed to the agent under test, written in the voice of the lead or founder. */
  prompt: z.string().min(40),
  /** Named fixtures the sandbox mounts (mock tools, recorded data). Keys are stable references, never live data. */
  fixtures: z.record(z.string(), z.string()).default({}),
  /** The sandbox mock tools the task is allowed to call; real email/spend are never available (BUILD §11.10). */
  mockTools: z.array(z.string()).default([]),
});
export type SkillTask = z.infer<typeof SkillTask>;

export const SkillTest = z.object({
  id: z.string().min(1),
  skillKey: SnakeKey,
  task: SkillTask,
  rubric: Rubric,
  checks: z.array(DeterministicCheck).default([]),
  /** Held-out tests are never returned by any API or shown in UI (AC-11.10.2). */
  heldOut: z.boolean(),
  /** Scenario the task was instantiated from (for variety audits and dedupe). */
  scenarioKey: SnakeKey,
});
export type SkillTest = z.infer<typeof SkillTest>;

/** Result of grading one test (deterministic checks + grader). */
export const SkillTestResult = z.object({
  testId: z.string(),
  score: z.number().min(0).max(1),
  lines: z.array(z.object({ criterion: z.string(), score: z.number().min(0).max(1), reason: z.string() })),
  deterministic: z.array(z.object({ kind: DeterministicCheckKind, passed: z.boolean(), detail: z.string().optional() })),
});
export type SkillTestResult = z.infer<typeof SkillTestResult>;

// ---------------------------------------------------------------------------------------------------------------------
// Archetype seeds (BUILD §11.1 "seed departments/agents from archetype", §6.1)
// ---------------------------------------------------------------------------------------------------------------------

export const DepartmentSeed = z.object({
  /** Stable slug; the display name may be renamed by the founder (AC-11.13.1). */
  slug: SnakeKey,
  name: z.string().min(1),
  /** Lucide icon name. */
  icon: z.string().min(1),
  colourToken: DeptColourToken,
  position: z.number().int().nonnegative(),
  moduleKeys: z.array(ModuleKey).min(1),
  leadTemplateKey: SnakeKey,
  memberTemplateKeys: z.array(SnakeKey),
  budgetMinor: z.number().int().nonnegative(),
});
export type DepartmentSeed = z.infer<typeof DepartmentSeed>;

export const FirstCycleTask = z.object({
  kind: TaskKind,
  title: z.string().min(1),
  goal: z.string().min(20),
  acceptance: z.array(z.string().min(1)).min(1),
  assigneeTemplateKey: SnakeKey,
  departmentSlug: SnakeKey,
});
export type FirstCycleTask = z.infer<typeof FirstCycleTask>;

export const BoardDecisionOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  recommended: z.boolean(),
  consequence: z.string().min(1),
  costMinor: z.number().int().nonnegative(),
  reversible: z.boolean(),
});

export const BoardDecision = z
  .object({
    subject: z.string().min(1).max(80),
    bodyMd: z.string().min(40),
    options: z.array(BoardDecisionOption).min(2).max(4),
  })
  .refine((d) => d.options.filter((o) => o.recommended).length === 1, { message: "exactly one option must be recommended" });
export type BoardDecision = z.infer<typeof BoardDecision>;

export const ArchetypeSeed = z.object({
  archetype: Archetype,
  /** Chief of Staff is hired for every archetype; listed here so seeds are self-describing. */
  assistantTemplateKey: SnakeKey,
  departments: z.array(DepartmentSeed).min(1),
  defaultChannels: z.array(ChannelKey).min(3).max(6),
  specOutline: z.array(z.string().min(1)).min(5),
  firstCycleTasks: z.array(FirstCycleTask).min(3),
  boardDecision: BoardDecision,
});
export type ArchetypeSeed = z.infer<typeof ArchetypeSeed>;
