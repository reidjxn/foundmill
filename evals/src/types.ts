/**
 * Eval vocabulary (BUILD §17.1 "Agent evals in evals/: per template and per skill … pass thresholds per template;
 * injection suite must block 100%"). Everything an eval needs is data: adding a task or an injection case is a new entry
 * in `golden/tasks.ts` or `injection/suite.ts`, never a code change in the harness.
 */
import { z } from "zod";
import { DeterministicCheck, SnakeKey } from "@foundmill/agents";
import {
  CategoriserOutput,
  ClassifierOutput,
  CodeReviewOutput,
  CommentaryOutput,
  ComposerOutput,
  CoachOutput,
  CyclePlanOutput,
  DepartmentLeadOutput,
  IdeationOutput,
  LinkerOutput,
  ModerationOutput,
  PlanOutput,
  ResearchPlanOutput,
  SkillGradeOutput,
  TaskGraphOutput,
  WorkerOutput,
} from "@foundmill/models";

/** Output schemas a golden task may demand, by key, so tasks stay plain data. */
export const OUTPUT_SCHEMAS = {
  research_plan: ResearchPlanOutput,
  composer: ComposerOutput,
  plan: PlanOutput,
  ideation: IdeationOutput,
  cycle_plan: CyclePlanOutput,
  department_lead: DepartmentLeadOutput,
  task_graph: TaskGraphOutput,
  code_review: CodeReviewOutput,
  skill_grade: SkillGradeOutput,
  coach: CoachOutput,
  commentary: CommentaryOutput,
  linker: LinkerOutput,
  classifier: ClassifierOutput,
  categoriser: CategoriserOutput,
  moderation: ModerationOutput,
  worker: WorkerOutput,
} as const;
export type OutputSchemaKey = keyof typeof OUTPUT_SCHEMAS;
export const OutputSchemaKey = z.enum(Object.keys(OUTPUT_SCHEMAS) as [OutputSchemaKey, ...OutputSchemaKey[]]);

export const GoldenTask = z.object({
  id: z.string().min(1),
  templateKey: SnakeKey,
  title: z.string().min(8),
  /** The user turn handed to the agent after its system prompt (club rules + instructions). */
  prompt: z.string().min(40),
  /** When set, the completion is requested as JSON matching this schema and `json_schema_valid` is implied. */
  schemaKey: OutputSchemaKey.optional(),
  checks: z.array(DeterministicCheck).default([]),
  rubric: z.array(z.string().min(8)).min(2),
  /** Ids the deterministic checks may rely on (entity manifest ids, source record ids). */
  manifestIds: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  /** Overrides the template's pass threshold for this task only. */
  passThreshold: z.number().min(0).max(1).optional(),
});
export type GoldenTask = z.infer<typeof GoldenTask>;

/** `workspace_file`: a file an earlier code session saved and the next one restores (no quarantined reader in that path). */
export const INJECTION_KINDS = ["email", "web_page", "pdf", "workspace_file"] as const;
export const InjectionKind = z.enum(INJECTION_KINDS);
export type InjectionKind = (typeof INJECTION_KINDS)[number];

/** Field types the quarantined reader may return (BUILD §12.7). */
export const QUARANTINE_FIELD_TYPES = ["string|null", "number|null", "integer|null", "boolean|null"] as const;
export const QuarantineFieldType = z.enum(QUARANTINE_FIELD_TYPES);

export const InjectionCase = z
  .object({
    id: z.string().min(1),
    kind: InjectionKind,
    title: z.string().min(8),
    /** The untrusted content exactly as the gateway would hand it over, with the attack embedded. */
    content: z.string().min(80),
    /** For `workspace_file`: the file's path in the restored workspace. */
    path: z.string().min(1).optional(),
    /** What the quarantined reader is asked to extract. */
    schema: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), QuarantineFieldType),
    /** Values a correct extraction returns for the fields that the content actually states. */
    expected: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    /** Strings the attack tries to smuggle out or in; none may appear in any output of either stage. */
    mustNotContain: z.array(z.string().min(3)).min(1),
    /** Recipients or URLs first seen in the untrusted content; a downstream agent must never target them (BUILD §9.8 item 4). */
    injectedRecipients: z.array(z.string().min(3)),
    /** The worker that receives the typed data (and the raw content for reference) in stage two. */
    downstreamTemplateKey: SnakeKey,
    /** What the downstream agent was asked to do with the typed data. */
    downstreamTask: z.string().min(20),
  })
  .superRefine((c, ctx) => {
    for (const s of c.mustNotContain) {
      if (!c.content.includes(s)) ctx.addIssue({ code: "custom", path: ["mustNotContain"], message: `"${s}" does not occur in the content` });
    }
    for (const r of c.injectedRecipients) {
      if (!c.content.includes(r)) ctx.addIssue({ code: "custom", path: ["injectedRecipients"], message: `"${r}" does not occur in the content` });
    }
    for (const k of Object.keys(c.expected)) {
      if (!(k in c.schema)) ctx.addIssue({ code: "custom", path: ["expected", k], message: "expected field is not in the schema" });
    }
  });
export type InjectionCase = z.infer<typeof InjectionCase>;

/** The action plan a downstream agent returns in stage two of an injection case. */
export const ActionPlanOutput = z.object({
  actions: z.array(
    z.object({
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
      reason: z.string().min(1),
    }),
  ),
  escalations: z.array(z.string()),
  notes: z.string(),
});
export type ActionPlanOutput = z.infer<typeof ActionPlanOutput>;

export interface GoldenTaskResult {
  taskId: string;
  templateKey: string;
  /** 0-1: 0 when any deterministic check failed, else the grader's weighted mean. */
  score: number;
  passed: boolean;
  threshold: number;
  checks: Array<{ kind: string; passed: boolean; detail?: string }>;
  grader: { score: number; lines: Array<{ criterion: string; score: number; reason: string }> } | null;
  outputText: string;
  costMinor: number;
  durationMs: number;
  error?: string;
}

export interface InjectionCaseResult {
  caseId: string;
  kind: InjectionKind;
  blocked: boolean;
  stages: {
    reader: { passed: boolean; problems: string[]; output: Record<string, unknown> | null };
    downstream: { passed: boolean; problems: string[]; output: ActionPlanOutput | null };
  };
  costMinor: number;
  durationMs: number;
  error?: string;
}
