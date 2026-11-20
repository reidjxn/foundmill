/**
 * Structural types for the tRPC responses the distribution screens read through `useWidgetQuery`
 * (apps/api/src/routers/distribution.ts, crm.ts, journey.ts, team.ts; BUILD §8.3). Declared here so the package
 * depends only on wave-1 packages; dates arrive as ISO strings on the wire and every field the API may omit is
 * optional-tolerant.
 */
import type { PostDraft } from "@foundmill/shared/post-draft";
import type { PostOutcomeCounts } from "@foundmill/shared/post-outcomes";
import type { AgentStatus, ApprovalState, AssetKind, CampaignStatus, ChannelAvailabilityRow, ChannelKey, ChannelLine, ConversionKind, DeptColourToken, EntityKind, MatchdayLevel } from "@foundmill/shared";

export type Iso = string;

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

/* ---------- distribution.channels.list ---------- */

/** Per-channel totals over the trailing 35 days (`repos.channels.metricsSummary`). */
export interface ChannelSummaryRow {
  channelId: string;
  channelKey: ChannelKey;
  line: ChannelLine;
  spendMinor: number;
  impressions: number;
  leads: number;
  signups: number;
  activations: number;
  customers: number;
  /** spend ÷ customers, minor units; null without customers. Labelled Estimate. */
  cpaMinor: number | null;
  days: number;
  /** True when any folded day is simulated (the mock engine's week): every figure is then an Estimate. */
  estimate?: boolean;
}

export type BlendedSummary = Omit<ChannelSummaryRow, "channelId" | "channelKey" | "line">;

export interface ChannelRow {
  id: string;
  channelKey: ChannelKey;
  enabled: boolean;
  line: ChannelLine;
  /** 1–20 from the Distribution Strategist. */
  fit: number;
  /** Stored 0–100 (stars × 20); numeric columns may arrive as strings. */
  potential: number | string;
  recommended: boolean;
  whyMd?: string;
  /** When the Distribution Strategist last scored the channel; null until it has (fit and potential mean nothing then). */
  scoredAt?: Iso | null;
  budgetMinor: number;
  currency: string;
  /** Offline tracking: the engine prepares materials and a founder task instead of calling a booking API. */
  kitMode?: boolean;
  ownerAgentId?: string | null;
  engineWorkflowId?: string | null;
  meta?: { label: string; line: ChannelLine; coreMetric: string; kitModeByDefault?: boolean };
  form: ChannelSummaryRow | null;
  updatedAt?: Iso;
  /**
   * Whether the channel can really act for this business, why, and one plain sentence when it cannot (founder,
   * 2026-11-11). Computed by the API; absent only in an older response, which reads as available.
   */
  availability?: ChannelAvailabilityRow;
}

export interface ChannelsListResponse {
  channels: ChannelRow[];
  lines: Record<ChannelLine, string[]>;
  blended: BlendedSummary;
  /** Every channel's availability by key, so a channel with no stored row has one too. */
  availability?: Partial<Record<ChannelKey, ChannelAvailabilityRow>>;
  /** The sentence for a Board with no channel that can run; null or absent otherwise. */
  noChannel?: string | null;
}

/* ---------- distribution.channels.metrics ---------- */

export interface ChannelMetricRow {
  id?: string;
  channelId: string;
  campaignId?: string | null;
  /** YYYY-MM-DD */
  day: string;
  spendMinor: number;
  currency?: string;
  impressions?: number;
  leads?: number;
  signups?: number;
  activations?: number;
  customers: number;
  cpaMinor?: number | null;
  /** `estimate` for the mock engine's simulated week (labeled Estimate). */
  source?: "measured" | "estimate";
}

/* ---------- distribution.recommend ---------- */

export interface RecommendationRow {
  channel: ChannelKey;
  fit: number;
  /** 1–5 stars. */
  potential: number;
  recommended: boolean;
  /** low ≤ high; null when the Strategist gave no usable range. */
  cpa_range_minor: { low: number; high: number } | null;
  why: string;
}

export interface RecommendResponse {
  channels: ChannelRow[];
  recommendation: RecommendationRow[];
  cpaLabel: "Estimate";
  /** Why nothing is recommended, when no channel can run (one plain sentence); null otherwise. */
  note?: string | null;
}

/* ---------- distribution.channels.enable / disable ---------- */

export interface SetEnabledResponse {
  channel: ChannelRow;
  workflow: { queued: boolean; reason?: string };
}

/* ---------- distribution.campaigns.* ---------- */

export interface CampaignRow {
  id: string;
  channelId: string;
  name: string;
  goal: string;
  status: CampaignStatus;
  budgetMinor: number;
  currency: string;
  startsAt: Iso | null;
  endsAt: Iso | null;
  config?: Record<string, unknown>;
  createdAt?: Iso;
  updatedAt?: Iso;
}

/* ---------- distribution.assets.* ---------- */

export interface AssetRow {
  id: string;
  campaignId: string | null;
  kind: AssetKind;
  title: string;
  contentRef: string | null;
  /** The drafted copy or brief (0028); a mock draft says so in its first line. */
  body?: string | null;
  approvalState: ApprovalState;
  authoredByAgentId: string | null;
  /**
   * A post the team wrote for the founder to share by tap (packages/shared `team-posts.ts`): the words with the link and
   * the picture the api attached, ready for the share panel. Null or absent for every other asset.
   */
  sharePost?: PostDraft | null;
  /**
   * What a team post led to (item 8): real follows and replies when the reader reads the CRM, payments when they read
   * Finance. Null or absent when it led to nothing the reader may see. Visits are never in it.
   */
  postOutcomes?: PostOutcomeCounts | null;
  /** The founder said they posted it (`post.published`): the network (null for a copied link) and the day. Null or absent until then. */
  posted?: { network: string | null; at: Iso } | null;
  createdAt?: Iso;
  updatedAt?: Iso;
}

export interface CampaignGetResponse {
  campaign: CampaignRow;
  assets: AssetRow[];
}

/* ---------- crm.roles.byRole (role "lead") ---------- */

export interface LeadRoleRow {
  id: string;
  entityId: string;
  role: string;
  stage: string | null;
  ownerRef: { kind: "agent" | "user" | "department"; id: string } | null;
  startedAt: Iso;
  endedAt: Iso | null;
}

export interface LeadRow {
  id: string;
  kind: EntityKind;
  displayName: string;
  aliases?: string[];
  /** email, domain, linkedin, … plus engine-written flags such as `suppressed` / `suppression_reason`. */
  identifiers: Record<string, unknown>;
  lawfulBasis: string | null;
  source: string | null;
  createdAt?: Iso;
  role: LeadRoleRow;
  /** When they agreed to email (a follower of the public page, package 1.6); null or absent otherwise. */
  emailConsentAt?: Iso | null;
}

/* ---------- journey.list ---------- */

export interface JourneyRow {
  id: string;
  conversionId: string;
  touchIds: string[];
  /** touchId → weight under the model in use. */
  weights: Record<string, number>;
  matchdayLevel: MatchdayLevel;
  viewedAt?: Iso | null;
  createdAt: Iso;
  /** Consent other than granted: only first-party touches were weighted (the reading journey.get uses). */
  partialJourney: boolean;
  consent?: "unknown" | "granted" | "denied" | "withdrawn";
  conversion: { id: string; entityId: string | null; kind: ConversionKind; amountMinor: number; currency: string; occurredAt: Iso };
}

/* ---------- journey.attribution ---------- */

/** The model in use over the business's whole history (never a page of journeys). */
export interface AttributionSummaryResponse {
  /** Labeled conversions: every first conversion of each kind, repeat payments left out (what `chooseModel` counts). */
  conversionCount: number;
  byKind: Partial<Record<ConversionKind, number>>;
  attributionModel: "position_based_40_20_40" | "data_driven_markov";
  threshold: number;
  remaining: number;
  journeys: number;
  partialJourneys: number;
}

/* ---------- team.agents.list ---------- */

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  avatarSeed: string;
  departmentIds?: string[];
  departments?: { id: string; name: string; colourToken: DeptColourToken }[];
}

/** What `team.agents.list` answers: the agents under `agents` (never a bare array). */
export interface AgentsListResponse {
  agents: AgentRow[];
  templates?: string[];
}
