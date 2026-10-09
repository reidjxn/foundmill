/**
 * Zod output schemas for the model routes (BUILD §11.3 Composer schema, §12.3 Plan, §11.1 ideation, §12.4–§12.7).
 *
 * These are the default shapes the mock generators produce and the shapes other packages can import when they call
 * `complete({ schema })`. Shared enums come from @foundmill/shared and are never redeclared here; the few enums
 * that are specific to a single model output (idea attribute keys, chart of accounts, moderation categories) live here.
 */
import {
  Archetype,
  ExhibitKind,
  InboxItemType,
  PlanActionType,
  Severity,
  TaskKind,
} from "@foundmill/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Inbox Composer (BUILD §11.3 "Composer output schema")
// ---------------------------------------------------------------------------------------------------------------------

export const ComposerOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  recommended: z.boolean(),
  consequence: z.string(),
  cost_minor: z.number().int().nonnegative(),
  reversible: z.boolean(),
});
export type ComposerOption = z.infer<typeof ComposerOption>;

export const ComposerStatusMetric = z.object({
  metric: z.string().min(1),
  source: z.string().min(1),
});

export const ComposerDecision = z.object({
  options: z.array(ComposerOption).min(2).max(4),
  free_text: z.boolean(),
  expires_at: z.string().nullable(),
});

export const ComposerOutput = z
  .object({
    type: InboxItemType,
    from_agent_id: z.string().uuid(),
    subject: z.string().min(1).max(80),
    body_md: z.string().min(1),
    status_strip: z.array(ComposerStatusMetric).max(4),
    exhibit: z.object({ kind: ExhibitKind, spec_ref: z.string().nullable() }),
    decision: ComposerDecision.nullable(),
    blocks_continue: z.boolean(),
    source_event_ids: z.array(z.string()),
  })
  .refine((v) => v.decision === null || v.decision.options.filter((o) => o.recommended).length === 1, {
    message: "exactly one option must be recommended",
    path: ["decision", "options"],
  })
  .refine((v) => v.exhibit.kind === "none" || v.exhibit.spec_ref !== null, {
    message: "an exhibit other than 'none' must reference a named query",
    path: ["exhibit", "spec_ref"],
  });
export type ComposerOutput = z.infer<typeof ComposerOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Plan compiler (BUILD §12.3 "Return JSON {summary, actions:[{type, params, agent_id}]}")
// ---------------------------------------------------------------------------------------------------------------------

export const PlanAction = z.object({
  type: PlanActionType,
  params: z.record(z.string(), z.unknown()),
  agent_id: z.string().nullable(),
});
export type PlanAction = z.infer<typeof PlanAction>;

export const PlanOutput = z.object({
  summary: z.string().min(1),
  actions: z.array(PlanAction).min(1),
});
export type PlanOutput = z.infer<typeof PlanOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Ideation (BUILD §11.1: 6–12 cards, 10 attributes 1–20 with evidence, ≥ 2 citations)
// ---------------------------------------------------------------------------------------------------------------------

export const IDEA_ATTRIBUTE_KEYS = [
  "market_pull",
  "market_size",
  "competition",
  "speed_to_first_customer",
  "capital_intensity",
  "agent_executability",
  "founder_fit",
  "defensibility",
  "regulatory_load",
  "distribution_clarity",
] as const;
export const IdeaAttributeKey = z.enum(IDEA_ATTRIBUTE_KEYS);
export type IdeaAttributeKey = (typeof IDEA_ATTRIBUTE_KEYS)[number];

export const IDEA_ATTRIBUTE_LABELS: Record<IdeaAttributeKey, string> = {
  market_pull: "Market pull",
  market_size: "Market size",
  competition: "Competition",
  speed_to_first_customer: "Speed to first customer",
  capital_intensity: "Capital intensity",
  agent_executability: "Agent-executability",
  founder_fit: "Founder fit",
  defensibility: "Defensibility",
  regulatory_load: "Regulatory load",
  distribution_clarity: "Distribution clarity",
};

export const IdeaAttribute = z.object({
  key: IdeaAttributeKey,
  /** 1–20 where higher is more favourable for the founder (so low capital intensity and low regulatory load score high). */
  value: z.number().int().min(1).max(20),
  evidence: z.string().min(1),
});

export const IdeaCitation = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  note: z.string(),
});

export const ConceptCard = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  pitch: z.string().min(1),
  archetype: Archetype,
  stars_current: z.number().int().min(1).max(5),
  stars_potential: z.number().int().min(1).max(5),
  attributes: z.array(IdeaAttribute).length(10),
  citations: z.array(IdeaCitation).min(2),
  crest_seed: z.string().min(1),
});
export type ConceptCard = z.infer<typeof ConceptCard>;

export const IdeationOutput = z.object({
  concepts: z.array(ConceptCard).min(6).max(12),
});
export type IdeationOutput = z.infer<typeof IdeationOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Logo designer (business logo marks as SVG; packages/agents prompt `logo_designer`). The SVG is untrusted output: the
// api passes every mark through the strict sanitiser (@foundmill/shared/logo) before it reaches a browser.
// ---------------------------------------------------------------------------------------------------------------------

export const LOGO_SVG_MAX_CHARS = 12_000;

export const LogoMarkDraft = z.object({
  /** One to three words naming the idea ("Orbit", "Folded page"). */
  name: z.string().min(1).max(40),
  /** What the mark shows and why it fits the business (one sentence). */
  concept: z.string().min(1).max(240),
  /** A complete `<svg>` document on a 0 0 100 100 viewBox. */
  svg: z.string().min(40).max(LOGO_SVG_MAX_CHARS),
});
export type LogoMarkDraft = z.infer<typeof LogoMarkDraft>;

export const LogoDesignOutput = z.object({
  marks: z.array(LogoMarkDraft).min(1).max(8),
});
export type LogoDesignOutput = z.infer<typeof LogoDesignOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Chief of Staff cycle plan (BUILD §12.4)
// ---------------------------------------------------------------------------------------------------------------------

export const CycleTaskStart = z.object({
  task_id: z.string().min(1),
  agent_id: z.string().nullable(),
  priority: z.number().int().min(1).max(5),
  reason: z.string(),
});

export const CycleDepartmentPlan = z.object({
  department_id: z.string().min(1),
  priorities: z.array(z.string()),
  tasks_to_start: z.array(CycleTaskStart),
});

export const CyclePlanOutput = z.object({
  summary: z.string().min(1),
  time_box_hours: z.number().positive(),
  departments: z.array(CycleDepartmentPlan),
  deferred: z.array(z.object({ task_id: z.string().min(1), reason: z.string() })),
  approvals_needed: z.array(z.string()),
});
export type CyclePlanOutput = z.infer<typeof CyclePlanOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Department lead
// ---------------------------------------------------------------------------------------------------------------------

export const DepartmentLeadOutput = z.object({
  department_id: z.string().min(1),
  assignments: z.array(
    z.object({
      task_id: z.string().min(1),
      agent_id: z.string().min(1),
      instructions: z.string().min(1),
      priority: z.number().int().min(1).max(5),
    }),
  ),
  blockers: z.array(z.object({ task_id: z.string().min(1), reason: z.string().min(1) })),
  report_md: z.string().min(1),
});
export type DepartmentLeadOutput = z.infer<typeof DepartmentLeadOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Planner task graph (BUILD §11.6 "goal, acceptance criteria, test expectations, file-scope hints, dependencies")
// ---------------------------------------------------------------------------------------------------------------------

export const PlannedTask = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  kind: TaskKind,
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  test_expectations: z.array(z.string()),
  file_scope_hints: z.array(z.string()),
  depends_on: z.array(z.string()),
  estimate_hours: z.number().positive(),
  hard: z.boolean(),
  roadmap_item_id: z.string().nullable(),
});
export type PlannedTask = z.infer<typeof PlannedTask>;

export const TaskGraphOutput = z.object({
  tasks: z.array(PlannedTask).min(1),
});
export type TaskGraphOutput = z.infer<typeof TaskGraphOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Code review
// ---------------------------------------------------------------------------------------------------------------------

export const CODE_REVIEW_VERDICTS = ["approve", "comment", "request_changes"] as const;
export const CodeReviewVerdict = z.enum(CODE_REVIEW_VERDICTS);

export const CodeReviewFinding = z.object({
  severity: Severity,
  file: z.string().min(1),
  line: z.number().int().positive().nullable(),
  title: z.string().min(1),
  detail: z.string().min(1),
  suggestion: z.string().nullable(),
});

export const CodeReviewOutput = z.object({
  verdict: CodeReviewVerdict,
  summary: z.string().min(1),
  findings: z.array(CodeReviewFinding),
});
export type CodeReviewOutput = z.infer<typeof CodeReviewOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Skill grader (BUILD §12.5 "Return JSON {score, lines:[{criterion, score, reason}]}")
// ---------------------------------------------------------------------------------------------------------------------

export const SkillGradeLine = z.object({
  criterion: z.string().min(1),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const SkillGradeOutput = z.object({
  score: z.number().min(0).max(1),
  lines: z.array(SkillGradeLine).min(1),
});
export type SkillGradeOutput = z.infer<typeof SkillGradeOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Coach (BUILD §12.6 "up to 3 instruction edits as diffs")
// ---------------------------------------------------------------------------------------------------------------------

export const INSTRUCTION_FIELDS = ["role", "goals", "rules", "playbook", "tone", "examples"] as const;
export const InstructionField = z.enum(INSTRUCTION_FIELDS);

export const CoachEdit = z.object({
  skill: z.string().min(1),
  field: InstructionField,
  before: z.string(),
  after: z.string().min(1),
  /** Expected skill-point gain on the 1–20 scale. */
  expected_gain: z.number().int().min(0).max(5),
  rationale: z.string().min(1),
});

export const CoachOutput = z.object({
  summary: z.string().min(1),
  edits: z.array(CoachEdit).max(3),
});
export type CoachOutput = z.infer<typeof CoachOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Journey commentary (BUILD §11.4 "touches as events with Sonnet commentary")
// ---------------------------------------------------------------------------------------------------------------------

export const COMMENTARY_TONES = ["build_up", "chance", "setback", "goal", "neutral"] as const;
export const CommentaryTone = z.enum(COMMENTARY_TONES);

export const CommentaryLine = z.object({
  touch_index: z.number().int().nonnegative(),
  text: z.string().min(1),
  tone: CommentaryTone,
});

export const CommentaryOutput = z.object({
  headline: z.string().min(1),
  lines: z.array(CommentaryLine),
});
export type CommentaryOutput = z.infer<typeof CommentaryOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Entity linker sweep (BUILD §11.3 "exact → alias → fuzzy; ambiguous → Which one?; unknown → draft entity")
// ---------------------------------------------------------------------------------------------------------------------

export const LINK_STATUSES = ["linked", "ambiguous", "unknown"] as const;
export const LinkStatus = z.enum(LINK_STATUSES);

export const LinkerMention = z.object({
  text: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  entity_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  status: LinkStatus,
  candidates: z.array(z.string()),
});

export const LinkerOutput = z.object({
  mentions: z.array(LinkerMention),
});
export type LinkerOutput = z.infer<typeof LinkerOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Classifier / categoriser (BUILD §11.8 "Haiku categorises bank transactions into a standard chart of accounts")
// ---------------------------------------------------------------------------------------------------------------------

export const ClassifierOutput = z.object({
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutput>;

export const CHART_OF_ACCOUNTS = [
  "revenue",
  "refunds",
  "cost_of_goods_sold",
  "software_and_hosting",
  "marketing_and_advertising",
  "salaries_and_contractors",
  "professional_services",
  "rent_and_facilities",
  "travel_and_meals",
  "equipment",
  "insurance",
  "bank_fees_and_interest",
  "taxes_and_government",
  "shipping_and_fulfilment",
  "transfers",
  "financing",
  "uncategorised",
] as const;
export const AccountCategory = z.enum(CHART_OF_ACCOUNTS);
export type AccountCategory = (typeof CHART_OF_ACCOUNTS)[number];

export const CategorisedTransaction = z.object({
  id: z.string().min(1),
  category: AccountCategory,
  confidence: z.number().min(0).max(1),
  rule: z.string().min(1),
});

export const CategoriserOutput = z.object({
  transactions: z.array(CategorisedTransaction),
});
export type CategoriserOutput = z.infer<typeof CategoriserOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Quarantined reader (BUILD §12.7): typed fields only; the caller usually passes its own object schema.
// ---------------------------------------------------------------------------------------------------------------------

export const QuarantinedValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const QuarantinedReaderOutput = z.record(z.string(), QuarantinedValue);
export type QuarantinedReaderOutput = z.infer<typeof QuarantinedReaderOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Moderation (BUILD §2.3 honest-agent code, pre-send checker)
// ---------------------------------------------------------------------------------------------------------------------

export const MODERATION_CATEGORIES = [
  "claims_to_be_human",
  "fabricated_urgency",
  "fake_testimonial",
  "unsubstantiated_claim",
  "missing_unsubscribe",
  "missing_sender_identity",
  "pii_exposure",
  "harassment",
  "prohibited_automation",
] as const;
export const ModerationCategory = z.enum(MODERATION_CATEGORIES);

export const ModerationFlag = z.object({
  category: ModerationCategory,
  severity: Severity,
  excerpt: z.string(),
});

export const ModerationOutput = z.object({
  allowed: z.boolean(),
  flags: z.array(ModerationFlag),
  rationale: z.string().min(1),
});
export type ModerationOutput = z.infer<typeof ModerationOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Generic worker / nightly batch
// ---------------------------------------------------------------------------------------------------------------------

export const WorkerOutput = z.object({
  summary: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  artifacts: z.array(z.string()),
});
export type WorkerOutput = z.infer<typeof WorkerOutput>;

export const NightlyBatchOutput = z.object({
  summary: z.string().min(1),
  items: z.array(z.object({ id: z.string().min(1), result: z.string().min(1) })),
});
export type NightlyBatchOutput = z.infer<typeof NightlyBatchOutput>;
