/**
 * Structural types for the tRPC responses the product screens read (apps/api/src/routers/product.ts, BUILD §8.3).
 * Declared here so the package depends only on wave-1 packages. Dates arrive as ISO strings (or Dates through
 * superjson); every formatter accepts both.
 */
import type { HunkDecision, ProposalStatus, ResearchArtifactKind, ResearchArtifactStatus, ResearchStatus, RoadmapHorizon, Severity, SourceKind } from "@foundmill/shared";
import type { Page, RoadmapItemRow, RoadmapListResponse } from "@foundmill/widgets";

export type DateLike = string | Date;
export type PmDoc = Record<string, unknown>;
export type AuthorKind = "user" | "agent" | "system";

/* product.spec.get */
export interface SpecBlockRow {
  id: string;
  section: string;
  position: number;
  content: PmDoc;
  sources: string[];
  authoredByKind: AuthorKind;
  authoredBy: string | null;
  pinned: boolean;
  version: number;
  createdAt?: DateLike;
  updatedAt?: DateLike;
}
export interface SpecVersionRow {
  id: string;
  version: number;
  snapshot: { blocks?: SpecBlockRow[] } & Record<string, unknown>;
  changelogMd: string;
  publishedBy: string | null;
  publishedAt: DateLike;
}
export interface SpecGetResponse {
  blocks: SpecBlockRow[];
  latestVersion: SpecVersionRow | null;
  versionCount: number;
}
/* product.spec.compare */
export interface SpecCompareResponse {
  from: SpecVersionRow;
  to: SpecVersionRow;
}

/* product.foundations.get (apps/api services/foundations.ts `FoundationsView`) */
export type FoundationsStatusKey = "none" | "pending" | "drafting" | "ready" | "failed";
export interface FoundationsVision {
  statement: string;
  forWhom: string;
  problem: string;
  whyNow: string;
  principles: { title: string; detail: string }[];
  northStar: { metric: string; definition: string; target: string; label: "Estimate" | "Forecast" };
}
/** What the drafting has stored so far (apps/api `FoundationsView.progress`, packages/agents `FoundationsProgressView`). */
export type FoundationsStage = "vision" | "specification" | "roadmap" | "finishing";
export interface FoundationsProgressSection {
  section: string;
  /** The section's heading once it is written. */
  title: string | null;
  /** The one sentence the plan says it will argue. */
  thesis: string | null;
  done: boolean;
  /** The written section (plain text Tiptap JSON) once stored. */
  content: PmDoc | null;
}
export interface FoundationsProgress {
  stage: FoundationsStage;
  author: { agentId: string | null; name: string | null; role: string | null } | null;
  sections: FoundationsProgressSection[];
  sectionsDone: number;
  sectionsTotal: number;
  roadmap: { title: string; horizon: RoadmapHorizon; written: boolean }[];
  roadmapWritten: number;
  roadmapDone: boolean;
}
export interface FoundationsResponse {
  status: FoundationsStatusKey;
  door: "ideation" | "import" | null;
  attempt: number;
  runner: "temporal" | "local" | null;
  startedAt: DateLike | null;
  finishedAt: DateLike | null;
  error: string | null;
  /** Once ready, and while drafting as soon as the plan has streamed it. */
  vision: FoundationsVision | null;
  /** While drafting (or after a failed attempt): what has been written so far. */
  progress?: FoundationsProgress | null;
  summary: {
    sectionsWritten?: number;
    sectionsTotal?: number;
    sectionsKept?: { section: string; reason: string }[];
    roadmap?: { now?: number; next?: number; later?: number };
    importedIssues?: number;
    openQuestions?: string[];
    [key: string]: unknown;
  };
  importLinked: boolean;
  stale?: boolean;
}

/* product.research.get (apps/api services/product-research.ts `ResearchView`) */
export interface ResearchArtifactRow {
  id: string;
  kind: ResearchArtifactKind;
  title: string;
  summary: string;
  bodyMd: string;
  status: ResearchArtifactStatus;
  specBlockIds: string[];
  taskId: string | null;
  createdByAgentId: string | null;
  createdAt: DateLike;
  updatedAt: DateLike;
}
export interface ResearchResponse {
  /** "none": the business has no plan (set up before the Product Researcher existed). */
  status: "none" | ResearchStatus;
  attempt: number;
  icp: string;
  error: string | null;
  summary: {
    icp?: string;
    assumptions?: { assumption: string; fromSection: string; whyItMatters: string; testKind: string }[];
    openQuestions?: string[];
    firstStepTaskIds?: string[];
    inboxItemId?: string | null;
    [key: string]: unknown;
  };
  artifacts: ResearchArtifactRow[];
  agent: { id: string; name: string } | null;
  startedAt: DateLike | null;
  finishedAt: DateLike | null;
  stale: boolean;
}

/* product.roadmap.list */
export interface RoadmapRow extends RoadmapItemRow {
  descriptionMd?: string;
  ownerRef?: { kind: "agent" | "user" | "department"; id: string } | null;
  specBlockIds?: string[];
  updatedAt?: DateLike;
}
export interface RoadmapResponse extends Omit<RoadmapListResponse, "items" | "dependencies"> {
  items: RoadmapRow[];
  dependencies: { fromItem?: string; toItem?: string; fromId?: string; toId?: string }[];
}
export type { RoadmapHorizon };

/* product.proposals.* */
export interface ProposalRow {
  id: string;
  title: string;
  status: ProposalStatus;
  rationaleMd: string;
  evidence: string[];
  impact: ProposalImpact;
  severity: Severity;
  proposedByAgentId: string | null;
  inboxItemId: string | null;
  resolvedAt: DateLike | null;
  createdAt: DateLike;
}
/** Impact is free-form jsonb written by the Opus drafter; these are the keys the screen understands. */
export interface ProposalImpact {
  dates?: string | { from?: string; to?: string; shiftDays?: number };
  tasks?: number | string[] | { count?: number; titles?: string[] };
  costMinor?: number;
  currency?: string;
  summary?: string;
  [key: string]: unknown;
}
export interface ProposalHunkRow {
  id: string;
  proposalId: string;
  specBlockId: string | null;
  roadmapItemId: string | null;
  base: PmDoc | null;
  ours: PmDoc | null;
  theirs: PmDoc | null;
  decision: HunkDecision;
  position: number;
}
export interface ProposalWithHunks extends ProposalRow {
  hunks: ProposalHunkRow[];
}
export type ProposalsListResponse = Page<ProposalRow>;

/* product.sources.list (repos.product.listSources; see openIssues in the module report) */
export interface SourceRow {
  id: string;
  kind: SourceKind;
  uri: string | null;
  title: string;
  contentRef: string | null;
  relevance: SourceRelevance;
  fetchedAt: DateLike | null;
  createdAt: DateLike;
}
/** Relevance is jsonb from the Source Watcher; competitor cards and research notes read these keys when present. */
export interface SourceRelevance {
  summary?: string;
  blocks?: { blockId: string; score: number }[];
  topics?: string[];
  pricing?: string;
  strengths?: string[];
  weaknesses?: string[];
  marketSizeEstimate?: string;
  citations?: { title?: string; url?: string }[];
  author?: string;
  /** The founder's notes (or pasted text) from Add source. */
  notes?: string;
  /** The Source Watcher's last read: `scored`, `unreachable` (with a reason the founder can read) or `failed`. */
  watch?: { status?: string; reason?: string | null; checkedAt?: string; proposalId?: string | null };
  [key: string]: unknown;
}
export type SourcesListResponse = Page<SourceRow>;

/* product.signoff.get (apps/api services/signoff.ts `SignoffViews`; founder 2026-10-18) */
export type SignoffStatusKey = "pending" | "approved" | "changes_requested" | "declined";
export interface SignoffView {
  id: string;
  kind: "spec" | "roadmap" | "ready_to_sell";
  round: number;
  status: SignoffStatusKey;
  requestedAt: DateLike;
  decidedAt: DateLike | null;
  decidedBy: { kind: "user" | "system"; id: string | null } | null;
  notes: string | null;
  /** The specification version an approval published (spec rounds). */
  specVersion: number | null;
  inboxItemId: string | null;
}
export interface SignoffViews {
  stage: "drafting" | "awaiting_signoff" | "building" | "selling";
  spec: SignoffView | null;
  roadmap: SignoffView | null;
  readyToSell: SignoffView | null;
}
