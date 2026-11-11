/**
 * Structural types for the tRPC responses widgets read through `useWidgetQuery` (apps/api routers, BUILD §8.3).
 * Declared here (not imported from apps/api) so the package depends only on wave-1 packages; every field a widget
 * reads is optional-tolerant where the API may omit it. Dates arrive as ISO strings on the wire.
 */
import type { AgentStatus, AgentTier, ChannelKey, ChannelLine, ConversionKind, DeptColourToken, InboxItemType, InboxState, MilestoneKind, ModelKey, TaskStatus } from "@foundmill/shared";
import type { Chapter, Conversion, JourneyDailyRow, Milestone } from "@foundmill/dugout";

export type Iso = string;
export type DayKey = string;
export type Money = { amountMinor: number; currency: string };

/* department.list */
export interface SquadAgentRow {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  modelKey: ModelKey | string;
  avatarSeed: string;
  /** `agents.persona_key`: the first name and face shown when anthropomorphic agents are on. */
  personaKey?: string | null;
  /** The agent's layer: a `utility` agent is a background helper and keeps its role name. */
  layer?: string | null;
  /** Its tier (packages/shared team-tiers): `background` helpers stay out of the founder's lists and counts. */
  tier?: AgentTier | null;
}
export interface DepartmentRow {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  colourToken: DeptColourToken;
  position: number;
  leadAgentId?: string | null;
  moduleKeys: string[];
  hidden?: boolean;
  lead: { id: string; name: string; status: AgentStatus; avatarSeed: string; role?: string; personaKey?: string | null; layer?: string | null; tier?: AgentTier | null } | null;
  squad: SquadAgentRow[];
  tabs: { id: string; slug: string; title: string; position: number }[];
}

/* journey.ribbon */
export interface RibbonResponse {
  rows: JourneyDailyRow[];
  /** Named by the API (`entityName`) with the Customer Update id (`journeyId`) when there is one. */
  conversions: (Conversion & { occurredAt: Iso; entityName?: string | null; journeyId?: string | null })[];
  /** Conversions in the range (also when `slim` leaves `conversions` empty). */
  conversionCount?: number;
  milestones: (Milestone & { achievedAt: Iso; kind: MilestoneKind })[];
  chapters: Chapter[];
  /**
   * Customers (first payments) as the server counts them, one figure each whatever range was asked (DECISIONS
   * 2026-11-10, one number per fact): `thisWeek` is the business's last 7 days with `today`, `previousWeek` the 7 before,
   * `total` every first payment (the count the customer milestones are reached at). Older responses leave it out.
   */
  customers?: { today: DayKey; thisWeek: number; previousWeek: number; total: number };
  /** First day of the business (the API also returns it as `firstDay`). */
  kickoff: DayKey;
  firstDay?: DayKey;
  today: DayKey;
  forecastLabel?: "Forecast";
}

/* journey.roundup: every conversion of one day, named */
export interface RoundupResponse {
  day: DayKey;
  conversions: RibbonResponse["conversions"];
  /** Ids of the day's wins the volume rule rolled into the daily results table (no full Customer Update). */
  rolledUp?: string[];
}

/* journey.list */
export interface JourneyListRow {
  id: string;
  conversionId: string;
  entityId: string | null;
  kind: ConversionKind;
  convertedAt: Iso;
  viewedAt?: Iso | null;
  amountMinor?: number;
  currency?: string;
  /** Standout agent of the win (the stored column keeps its wave-1 name). */
  playerOfTheMatch?: string | null;
  standoutAgentId?: string | null;
}
export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
  total?: number;
}

/* finance.overview */
export interface ForecastSeriesPoint {
  month?: string;
  day?: string;
  revenueMinor?: number;
  cashMinor?: number;
  baseMinor?: number;
  upsideMinor?: number;
  downsideMinor?: number;
}
export interface ForecastRecord {
  id: string;
  scenario: "base" | "upside" | "downside" | string;
  currency: string;
  series: ForecastSeriesPoint[] | unknown[];
  createdAt?: Iso;
  label: "Forecast";
}
export interface FinanceOverview {
  cash: { amountMinor: number; currency: string; accounts: number; asOf: Iso | null; label: string };
  burn: { netBurnMinor: number; grossBurnMinor: number; months: number; label: "Estimate"; definition?: string };
  runway: { months: number | null; label: "Estimate"; warnings: number[]; blocksContinue: boolean };
  /** Monthly totals; the operating fields leave financing and transfers out (net and gross burn read them). */
  revenue: { monthly: { month: string; inflowMinor: number; outflowMinor: number; netMinor: number; count: number; operatingInflowMinor?: number; operatingOutflowMinor?: number }[]; basis: "cash" | string; label: string; recurring?: boolean | null };
  customers30d: number;
  /** The paying customer base of the trailing full months revenue covers: paid by its end, not churned before (the payback denominator). */
  payingCustomers?: { count: number; months: number; from?: Iso; to?: Iso };
  forecasts: Partial<Record<string, ForecastRecord | null>>;
}

/* business.firstWeek.get: one done flag per first-week item (UX plan §6.2 FirstWeekChecklist), read-only. */
export interface FirstWeekResponse {
  specificationSignedOff: boolean;
  roadmapSignedOff: boolean;
  cycleCompleted: boolean;
  noteRead: boolean;
  conversationReplySent: boolean;
  distributionStarted: boolean;
  bankOrStripeConnected: boolean;
}

/* inbox.list */
export interface InboxItemRow {
  id: string;
  type: InboxItemType;
  fromAgentId: string | null;
  fromUserId?: string | null;
  subject: string;
  bodyMd: string;
  blocksContinue: boolean;
  entityIds: string[];
  state: InboxState;
  createdAt: Iso;
}
export interface InboxListResponse extends Page<InboxItemRow> {
  counts?: Record<string, number>;
  blocking?: number;
}

/* founder.profile.get (only what the widgets read) */
export interface FounderProfileResponse {
  profile: { userId?: string; displayName?: string } | null;
}

/* distribution.channels.list */
export interface ChannelFormSummary {
  channelId: string;
  channelKey: ChannelKey;
  line: ChannelLine;
  spendMinor: number;
  impressions: number;
  leads: number;
  signups: number;
  activations: number;
  customers: number;
  days: number;
}
export interface ChannelRow {
  id: string;
  channelKey: ChannelKey;
  enabled: boolean;
  line: ChannelLine;
  fit: number;
  potential: number | string;
  recommended: boolean;
  budgetMinor: number;
  currency: string;
  meta?: { label: string; line: ChannelLine; coreMetric: string };
  form: ChannelFormSummary | null;
}
export interface ChannelsListResponse {
  channels: ChannelRow[];
  lines: Record<ChannelLine, string[]>;
  blended: Omit<ChannelFormSummary, "channelId" | "channelKey" | "line">;
}

/* distribution.channels.metrics */
export interface ChannelMetricRow {
  channelId: string;
  day: DayKey;
  spendMinor: number;
  impressions?: number;
  leads?: number;
  signups?: number;
  activations?: number;
  customers: number;
}

/* product.roadmap.list */
export interface RoadmapTaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  progress: number | string;
}
export interface RoadmapItemRow {
  id: string;
  title: string;
  horizon: "now" | "next" | "later";
  targetStart: DayKey | null;
  targetEnd: DayKey | null;
  confidence: number;
  status: string;
  position: number;
  tasks: RoadmapTaskRef[];
}
export interface RoadmapListResponse {
  items: RoadmapItemRow[];
  dependencies: { fromId?: string; toId?: string; itemId?: string; dependsOnId?: string }[];
}

/* dev.tasks.list */
export interface TaskRow {
  id: string;
  kind: string;
  title: string;
  /** The title in the founder's words (0070); null or absent until the Composer writes it, and the screens fall back to `title`. */
  founderTitle?: string | null;
  departmentId: string | null;
  assigneeAgentId: string | null;
  status: TaskStatus;
  progress: number | string;
  phase?: string | null;
  startedAt?: Iso | null;
  endedAt?: Iso | null;
  updatedAt?: Iso;
  roadmapItemId?: string | null;
}

/* team.agents.list: apps/api returns `{ agents, templates }`; a bare array is accepted for older hosts and fixtures. */
export type TeamAgentsListResponse = TeamAgentRow[] | { agents: TeamAgentRow[]; templates?: readonly string[] };
export interface TeamAgentRow {
  id: string;
  name: string;
  role: string;
  agentType?: string;
  layer?: string | null;
  /** Leads first: a `background` helper is never the agent of the week. */
  tier?: AgentTier | null;
  status: AgentStatus;
  modelKey: ModelKey | string;
  avatarSeed: string;
  /** `agents.persona_key`: the first name and face shown when anthropomorphic agents are on. */
  personaKey?: string | null;
  departmentIds: string[];
  departments: { id: string; name: string; colourToken: DeptColourToken }[];
  currentTask: TaskRow | null;
  skills: { skillKey?: string; displayed: number; tested?: number; proven?: number }[];
  rating: number | null;
  wage: { costMinor: number; capMinor: number | null; period: string; label: "Estimate" };
  form?: ("success" | "partial" | "failure")[];
}

/* legal.compliance.list */
export interface ComplianceResponse {
  events?: { id: string; title?: string; dueAt?: Iso | null; status?: string }[];
  deadlines?: { id: string; title?: string; kind?: string; dueAt: Iso | null; status?: string }[];
  filings?: { id: string; kind: string; title: string; dueAt: Iso | null; filedAt: Iso | null; status: string }[];
}

/* live.communities.* */
export interface CommunityRow {
  id: string;
  name: string;
  slug?: string;
  memberCount?: number;
  /** The founder's role in it; null when they have not joined (the feed is for members). Absent on older answers. */
  role?: string | null;
}
export interface CommunityPostRow {
  id: string;
  communityId: string;
  authorUserId: string;
  authorName?: string | null;
  bodyMd: string;
  createdAt: Iso;
  replyCount?: number;
  /** `pending_review`: the founder's own post, held by moderation (nobody else sees it until a moderator approves it). */
  status?: string;
}

/* dashboard.customMetric.* (custom-metric widget contract; see custom-metric.tsx) */
export type CustomMetricFormat = "compact" | "integer" | "decimal" | "percent" | "money";
export interface CompiledMetric {
  /** Named query id when the sentence matched a known query, otherwise null. */
  queryId: string | null;
  /** Read-only SQL against business-scoped views (validated server-side, AC-11.2.5). */
  sql: string;
  label: string;
  format: CustomMetricFormat;
  /** Where the number comes from, in plain words. */
  provenance?: string;
  estimate?: "forecast" | "estimate" | null;
}
export interface CustomMetricResult {
  value: number | null;
  currency?: string;
  format?: CustomMetricFormat;
  label?: string;
  asOf?: Iso | null;
  provenance?: string;
  estimate?: "forecast" | "estimate" | null;
  series?: number[];
}
/** dashboard.customMetric.list: the catalog entries the caller may read. */
export interface MetricCatalogEntry {
  id: string;
  label: string;
  description?: string;
  format?: CustomMetricFormat;
  estimate?: "forecast" | "estimate" | null;
}
export interface CompileMetricResponse extends CompiledMetric {
  preview: CustomMetricResult;
}
