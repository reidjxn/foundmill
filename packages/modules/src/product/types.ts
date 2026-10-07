/**
 * Structural types for the tRPC responses the product screens read (apps/api/src/routers/product.ts, BUILD §8.3).
 * Declared here so the package depends only on wave-1 packages. Dates arrive as ISO strings (or Dates through
 * superjson); every formatter accepts both.
 */
import type { HunkDecision, ProposalStatus, RoadmapHorizon, Severity, SourceKind } from "@foundmill/shared";
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
  [key: string]: unknown;
}
export type SourcesListResponse = Page<SourceRow>;
