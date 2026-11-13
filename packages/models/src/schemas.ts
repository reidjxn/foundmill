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
  PAGE_ABOUT_MAX,
  PAGE_FOR_WHOM_MAX,
  PAGE_PITCH_MAX,
  PAGE_STAGES,
  PlanActionType,
  ResearchArtifactKind,
  RoadmapHorizon,
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
  /**
   * One sentence on why this option is recommended ("Recommended because it is free and reversible."; UX plan §7.19,
   * voice guide §8.1 rule 4). The live prompt requires it on the recommended option; optional in the schema so notes
   * stored before it existed still validate. The DecisionBar shows it under the consequence.
   */
  because: z.string().optional(),
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
    // plain-allow: model-facing (a validation message the Composer reads on its retry; founders never see it)
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

/**
 * Ideation slate (route `ideationSlate`, audit P2): the names and angles of the set, drafted first in a short call so
 * the cards can then be written in parallel (one `ideation` call per card). Same 6–12 as the cards (AC-11.1.2).
 */
export const IdeationSlateItem = z.object({
  /** Carried into the card call and kept as the card's id. */
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  archetype: Archetype,
  /** One sentence: who it serves and how it wins. */
  angle: z.string().min(1).max(240),
});
export type IdeationSlateItem = z.infer<typeof IdeationSlateItem>;

export const IdeationSlateOutput = z.object({
  slate: z.array(IdeationSlateItem).min(6).max(12),
});
export type IdeationSlateOutput = z.infer<typeof IdeationSlateOutput>;

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
  /** The touch (0-based, in order) the line narrates; null for the first touch line and the debrief line, which belong to no single touch. */
  touch_index: z.number().int().nonnegative().nullable(),
  text: z.string().min(1),
  /** `goal` is the win moment (the line for the touch that closes the win); it is the one the replay highlights. */
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

// ---------------------------------------------------------------------------------------------------------------------
// Founder titles (founder, 2026-11-01): a task's title in the founder's words, at most ten, no engineering terms.
// ---------------------------------------------------------------------------------------------------------------------

export const FounderTitlesOutput = z.object({
  titles: z.array(z.object({ id: z.string().min(1), title: z.string().min(1).max(120) })),
});
export type FounderTitlesOutput = z.infer<typeof FounderTitlesOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// The goal (founder, 2026-11-07): the founder's "Change it" words read as a kind, a target and a date. Every word the
// founder reads is written by packages/shared goals.ts from these fields; the model never writes the sentence.
// ---------------------------------------------------------------------------------------------------------------------

export const GoalProposalOutput = z.object({
  /** False when the words name no change the goal can take (then nothing is replaced and the founder is asked again). */
  changed: z.boolean(),
  kind: z.enum(["paying_customers", "signups", "revenue_month", "custom"]),
  /** A count, or an amount in whole units of the business's currency for revenue_month; null for custom. */
  target: z.number().nonnegative().nullable(),
  /** "2027-01-31": after today, at most two years ahead. */
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** A custom goal's outcome in a few plain words ("Launch the booking page"); null for the measured kinds. */
  custom_words: z.string().max(120).nullable(),
});
export type GoalProposalOutput = z.infer<typeof GoalProposalOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// A project's public page (package 1.2): the Product lead's first draft from the founder's own words. The limits are
// the shared page schema's (packages/shared project-page.ts); packages/agents `finaliseProjectPage` checks the answer
// against `ProjectPageDraft` and never sets `showFounders` (that is the founder's choice).
// ---------------------------------------------------------------------------------------------------------------------

export const ProjectPageOutput = z.object({
  /** One line, 1 to 140 characters. */
  pitch: z.string().min(1).max(PAGE_PITCH_MAX),
  /** 1 to 1,500 characters; paragraphs split on blank lines. */
  about: z.string().min(1).max(PAGE_ABOUT_MAX),
  /** "Who it is for", at most 300 characters; empty unless the inputs name an audience. */
  for_whom: z.string().max(PAGE_FOR_WHOM_MAX),
  stage: z.enum(PAGE_STAGES),
});
export type ProjectPageOutput = z.infer<typeof ProjectPageOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// A post the social agent drafts for the founder to share by tap (docs/NETWORK.md F3, F7; packages/agents
// `post-draft.ts`). Words only: the link and the picture are attached by code, never by the model. packages/agents
// checks the answer (`finalisePostDraft`) before anything is stored.
// ---------------------------------------------------------------------------------------------------------------------

export const PostDraftOutput = z.object({
  /** The post: one or two short sentences of plain text. */
  text: z.string().min(1).max(600),
  /** A shorter way to say the same, or an empty string. Used only when `text` is too long for a network. */
  short: z.string().max(300).default(""),
});
export type PostDraftOutput = z.infer<typeof PostDraftOutput>;

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

// ---------------------------------------------------------------------------------------------------------------------
// Foundations: the vision, first specification and first roadmap (BUILD §11.1 commit → first open; §11.5)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The Tiptap (ProseMirror JSON) subset spec blocks are written in: headings, paragraphs, bullet and ordered lists, and
 * text with bold or italic marks. Fixed depth (a list item holds paragraphs, never another list), so the schema has no
 * recursion and stays a valid structured-output schema; the Tiptap StarterKit editor reads every node as is.
 */
export const TIPTAP_MARKS = ["bold", "italic"] as const;
export const TiptapText = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(z.object({ type: z.enum(TIPTAP_MARKS) })).optional(),
});
export const TiptapParagraph = z.object({ type: z.literal("paragraph"), content: z.array(TiptapText).min(1) });
export const TiptapHeading = z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: z.array(TiptapText).min(1) });
export const TiptapListItem = z.object({ type: z.literal("listItem"), content: z.array(TiptapParagraph).min(1) });
export const TiptapBulletList = z.object({ type: z.literal("bulletList"), content: z.array(TiptapListItem).min(1) });
export const TiptapOrderedList = z.object({ type: z.literal("orderedList"), content: z.array(TiptapListItem).min(1) });
export const TiptapBlock = z.discriminatedUnion("type", [TiptapHeading, TiptapParagraph, TiptapBulletList, TiptapOrderedList]);
export const TiptapDoc = z.object({ type: z.literal("doc"), content: z.array(TiptapBlock).min(1) });
export type TiptapText = z.infer<typeof TiptapText>;
export type TiptapParagraph = z.infer<typeof TiptapParagraph>;
export type TiptapBlock = z.infer<typeof TiptapBlock>;
export type TiptapDoc = z.infer<typeof TiptapDoc>;

/** Non-real numbers carry one of these labels (CLAUDE.md "Label every non-real number"). */
export const FIGURE_LABELS = ["Estimate", "Forecast"] as const;
export type FigureLabel = (typeof FIGURE_LABELS)[number];

export const FoundationsPrinciple = z.object({ title: z.string().min(1).max(100), detail: z.string().min(1).max(500) });
export const FoundationsNorthStar = z.object({
  metric: z.string().min(1).max(160),
  definition: z.string().min(1).max(500),
  /** The target with its horizon, e.g. "40 paying teams by the end of the second chapter (Forecast)". */
  target: z.string().min(1).max(300),
  label: z.enum(FIGURE_LABELS),
});
export const FoundationsVision = z.object({
  statement: z.string().min(1).max(600),
  for_whom: z.string().min(1).max(600),
  problem: z.string().min(1).max(1000),
  why_now: z.string().min(1).max(1000),
  principles: z.array(FoundationsPrinciple).min(3).max(6),
  north_star: FoundationsNorthStar,
});
export type FoundationsVision = z.infer<typeof FoundationsVision>;

export const FoundationsSection = z.object({
  /** One of the outline sections, spelled as given. */
  section: z.string().min(1).max(120),
  content: TiptapDoc,
  /** Input references the section relies on (an attribute key, a citation title, an imported source or issue). */
  source_refs: z.array(z.string().min(1).max(300)).max(16),
});
export type FoundationsSection = z.infer<typeof FoundationsSection>;

export const FoundationsRoadmapItem = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  horizon: RoadmapHorizon,
  /** Outline sections this item delivers (the roadmap item links to their spec blocks). */
  sections: z.array(z.string().min(1).max(120)).max(8),
  /** Checkable criteria; empty when the item is research or an open question. */
  acceptance_criteria: z.array(z.string().min(1).max(400)).max(10),
  /** For imported issues: the issue reference from the Import report (e.g. "acme/app issue #42"); null otherwise. */
  source_ref: z.string().max(300).nullable(),
  confidence: z.number().int().min(1).max(5),
});
export type FoundationsRoadmapItem = z.infer<typeof FoundationsRoadmapItem>;

export const FoundationsOutput = z.object({
  vision: FoundationsVision,
  sections: z.array(FoundationsSection).min(1).max(30),
  roadmap: z.array(FoundationsRoadmapItem).min(3).max(40),
  open_questions: z.array(z.string().min(1).max(400)).max(10),
});
export type FoundationsOutput = z.infer<typeof FoundationsOutput>;

/**
 * Foundations skeleton (route `foundationsSkeleton`, audit P3): the full vision, one thesis per outline section and the
 * roadmap's titles, drafted first so the vision shows within seconds and the sections can be written in parallel.
 */
export const FoundationsSkeletonSection = z.object({
  /** One of the outline sections, spelled as given. */
  section: z.string().min(1).max(120),
  /** The one sentence the section will argue. */
  thesis: z.string().min(1).max(400),
});
export type FoundationsSkeletonSection = z.infer<typeof FoundationsSkeletonSection>;

export const FoundationsSkeletonRoadmapItem = z.object({
  title: z.string().min(1).max(200),
  horizon: RoadmapHorizon,
});
export type FoundationsSkeletonRoadmapItem = z.infer<typeof FoundationsSkeletonRoadmapItem>;

export const FoundationsSkeletonOutput = z.object({
  vision: FoundationsVision,
  sections: z.array(FoundationsSkeletonSection).min(1).max(30),
  roadmap: z.array(FoundationsSkeletonRoadmapItem).min(3).max(40),
});
export type FoundationsSkeletonOutput = z.infer<typeof FoundationsSkeletonOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// Product research plan (route `worker`, the Product Researcher; BUILD §11.5 Research tab)
// ---------------------------------------------------------------------------------------------------------------------

/** The artifact kinds a research plan drafts; `demo` and `findings` come later, from the tests themselves. */
export const RESEARCH_PLAN_KINDS = ["interview_plan", "interview_script", "smoke_test", "survey", "demo_script"] as const satisfies readonly ResearchArtifactKind[];

export const ResearchAssumption = z.object({
  /** The claim the specification makes that would hurt most if wrong. */
  assumption: z.string().min(1).max(400),
  /** The specification section it comes from, spelled as in the outline. */
  from_section: z.string().min(1).max(120),
  why_it_matters: z.string().min(1).max(400),
  /** The cheapest test that would move it. */
  test_kind: ResearchArtifactKind,
});
export type ResearchAssumption = z.infer<typeof ResearchAssumption>;

export const ResearchArtifactDraft = z.object({
  kind: ResearchArtifactKind,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(300),
  /** Plain Markdown (headings, lists, paragraphs); no links, images, addresses or entity markup survive the finalizer. */
  body_md: z.string().min(1).max(8000),
});
export type ResearchArtifactDraft = z.infer<typeof ResearchArtifactDraft>;

export const ResearchFirstStep = z.object({
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(600),
  acceptance: z.array(z.string().min(1).max(300)).min(1).max(4),
});
export type ResearchFirstStep = z.infer<typeof ResearchFirstStep>;

/**
 * The research plan: how the specification and the direction will be tested with the ICP before and while the product
 * is built. One each of the five plan kinds is expected; the finalizer adds a placeholder for one the model left out.
 */
export const ResearchPlanOutput = z.object({
  icp_summary: z.string().min(1).max(400),
  riskiest_assumptions: z.array(ResearchAssumption).min(3).max(6),
  artifacts: z.array(ResearchArtifactDraft).min(4).max(6),
  /** The follow-up research tasks the cycles dispatch (recruit interviewees, run the smoke test …). */
  first_steps: z.array(ResearchFirstStep).min(2).max(4),
  open_questions: z.array(z.string().min(1).max(400)).max(6),
});
export type ResearchPlanOutput = z.infer<typeof ResearchPlanOutput>;

// Founder ↔ agent conversation (route `conversation`): QuickReply, AgentReplyOutput and their limits.
export * from "./conversation-schema";
