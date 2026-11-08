/**
 * Journey group types (BUILD §11.2 Ribbon, §11.4 Customer Update, §11.1 concept cards, DESIGN §8–9).
 *
 * The record shapes mirror `@foundmill/journey` (`packages/journey/src/types.ts`) field for field —
 * JourneyDailyRow, Conversion, Milestone, Chapter, Touch, XcPoint, JourneyAgent, Journey — so a value from that
 * package is assignable here without a cast. Dugout does not depend on the journey package (it depends only on
 * config and shared), so the shapes are declared structurally; vocabulary enums come from @foundmill/shared.
 */
import type { ReactNode } from "react";
import type { AgentStatus, AgentTier, ChannelKey, ConversionKind, DeptColourToken, MatchdayLevel, MilestoneKind } from "@foundmill/shared";
import type { Kit } from "../shell/types";

export type DayKey = string; // YYYY-MM-DD (UTC)
export type IsoDateTime = string;

/** Business brand colours as hex (business data, not design tokens). The shell owns the declaration. */
export type { Kit } from "../shell/types";

/* ---------- Daily rows, conversions, milestones, chapters (journey_daily, conversions, milestones) ---------- */

export interface JourneyDailyRow {
  businessId?: string;
  day: DayKey;
  /** null for the business-wide row. */
  departmentId: string | null;
  agentHours: number;
  tasksDone: number;
  spendMinor: number;
  revenueMinor: number;
  signups: number;
  activations: number;
  payments: number;
  decisions: number;
}

export interface Conversion {
  id: string;
  businessId?: string;
  entityId: string | null;
  kind: ConversionKind;
  amountMinor: number;
  currency: string;
  occurredAt: IsoDateTime;
  sourceEventId?: string | null;
  firstPayment?: boolean;
  /** Display name of the customer when known (the Ribbon's hover card and the round-up table show it). */
  entityName?: string | null;
}

export interface Milestone {
  id?: string;
  businessId?: string;
  kind: MilestoneKind;
  label: string;
  achievedAt: IsoDateTime;
  ref?: Record<string, unknown> | null;
  visibility?: string;
  trophyKey?: string | null;
}

export type ChapterStatus = "past" | "current" | "future";

export interface ChapterSummary {
  days: number;
  agentHours: number;
  tasksDone: number;
  spendMinor: number;
  revenueMinor: number;
  signups: number;
  activations: number;
  payments: number;
  decisions: number;
  milestoneLabels: string[];
}

export interface Chapter {
  id: string; // 2026-Q3
  index: number;
  year: number;
  quarter: number;
  startsOn: DayKey;
  endsOn: DayKey;
  status: ChapterStatus;
  title: string | null;
  provisionalTitle: string;
  summary?: ChapterSummary;
}

/* ---------- Ribbon-only inputs ---------- */

export interface RibbonDepartment {
  id: string;
  name: string;
  dept: DeptColourToken;
}

/** One forecast day (BUILD §11.2 "forecast cone"). Revenue in minor units; always labelled Forecast. */
export interface ForecastPoint {
  day: DayKey;
  baseMinor: number;
  upsideMinor: number;
  downsideMinor: number;
}

/** An upcoming roadmap item drawn as a ghosted flag past Today. */
export interface RoadmapFlag {
  id: string;
  label: string;
  plannedOn: DayKey;
}

/** A live event that ripples into the Today line (`JourneyRibbonHandle.ripple`). */
export interface RibbonEvent {
  kind: "signup" | "activation" | "payment" | "task" | "decision" | "milestone";
  departmentId?: string;
  amountMinor?: number;
  label?: string;
}

export const ZOOM_LEVELS = ["week", "month", "quarter", "all"] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

/* ---------- Journey record (journeys row + derived fields) ---------- */

export type TouchKind =
  | "visit"
  | "ad_click"
  | "email_delivered"
  | "email_open"
  | "email_click"
  | "email_reply"
  | "code_redeemed"
  | "qr_scan"
  | "call"
  | "form_submit"
  | "meeting"
  | "message"
  | "mail_delivered"
  | "social_engagement";

export interface TouchSource {
  utm?: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null };
  referrer?: string | null;
  referrerHost?: string | null;
  landingUrl?: string | null;
  code?: string | null;
  codeKind?: string | null;
  offlineKey?: string | null;
  provider?: string | null;
  agentId?: string | null;
  /** Free-text label for the replay ("Opened 'Welcome to Ledgerly'"). May carry [[ent:id|Name]] markup. */
  label?: string | null;
}

export interface Touch {
  id: string;
  visitorId?: string | null;
  entityId?: string | null;
  occurredAt: IsoDateTime;
  channelKey: ChannelKey | null;
  campaignId?: string | null;
  kind: TouchKind;
  source?: TouchSource;
  firstParty?: boolean;
}

export interface XcPoint {
  index: number;
  touchId: string | null;
  at: IsoDateTime;
  p: number;
  cumulative: number;
}

export interface JourneyAgent {
  agentId: string;
  name: string;
  role: string | null;
  departmentId: string | null;
  contribution: number;
  touchIds: string[];
  rating: number; // 1–10
}

export interface JourneyChannel {
  channelKey: ChannelKey | null;
  weight: number;
  touchCount: number;
}

export interface JourneyCaptain {
  touchId: string;
  channelKey: ChannelKey | null;
  agentId: string | null;
  weight: number;
}

export interface JourneyStats {
  touchCount: number;
  firstTouchAt: IsoDateTime | null;
  lastTouchAt: IsoDateTime | null;
  timeToConvertHours: number | null;
  /** Estimate: Σ weight × channel/campaign CPA; null when no cost data. */
  acquisitionCostMinor: number | null;
  currency: string;
}

/** A commentary line from the composer (`POST /v1/commentary`). Text may carry [[ent:id|Name]] markup. */
export interface CommentaryLine {
  touchId?: string | null;
  text: string;
  /** Highlight rows are kept in Highlights speed. */
  highlight?: boolean;
}

export interface Journey {
  id?: string;
  businessId?: string;
  conversionId: string;
  entityId: string | null;
  kind: ConversionKind;
  touchIds: string[];
  weights: Record<string, number>;
  xcSeries: XcPoint[];
  commentary: unknown[];
  agents: JourneyAgent[];
  matchdayLevel: MatchdayLevel;
  viewedAt?: IsoDateTime | null;
  channels: JourneyChannel[];
  captain: JourneyCaptain | null;
  playerOfTheMatch: string | null;
  attributionModel: string;
  xcModelSource: string;
  consent: string;
  partialJourney: boolean;
  nthOfKind: number;
  fullMatchDay: boolean;
  stats: JourneyStats;
  convertedAt: IsoDateTime;
  /** Amount of the conversion (payments); 0 for signups and activations. */
  amountMinor?: number;
  currency?: string;
}

/** Customer facts shown on the Customer Update rails (left). */
export interface CustomerFacts {
  name: string;
  kind?: "person" | "organisation";
  entityId?: string | null;
  facts: Array<{ label: string; value: string }>;
}

/** Agent presentation data the stage needs beyond the journey record (avatar seed, department colour, status). */
export interface StageAgentMeta {
  agentId: string;
  seed: string | number;
  dept: DeptColourToken;
  status?: AgentStatus;
  model?: string;
  /** `agents.persona_key`: the name and face shown when anthropomorphic agents are on. */
  personaKey?: string | null;
}

/* ---------- Concept cards (BUILD §11.1) ---------- */

export const CONCEPT_ATTRIBUTE_KEYS = [
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
export type ConceptAttributeKey = (typeof CONCEPT_ATTRIBUTE_KEYS)[number];

/**
 * Each attribute as a definition: `word` is its label, `short` what it measures and which way it reads (one sentence,
 * shown as a tooltip on the label wherever a bar is drawn: docs/UX_AUDIT_AND_PLAN.md §7.5, A6), `axis` the short name
 * on the radar. Every attribute is 1–20 and higher is always the better side for the business, so a "load" or an
 * "intensity" reads inverted: a high Competition means a less crowded market, a high Capital intensity means less money
 * needed before the first sale.
 */
export const CONCEPT_ATTRIBUTE_DEFINITIONS: Record<ConceptAttributeKey, { word: string; short: string; axis: string }> = {
  market_pull: { word: "Market pull", short: "How strongly people already want this. Higher means more demand.", axis: "Market pull" },
  market_size: { word: "Market size", short: "How many people or businesses could pay for it. Higher means a bigger market.", axis: "Market size" },
  competition: { word: "Competition", short: "How crowded the market is. Higher means less crowded.", axis: "Competition" },
  speed_to_first_customer: { word: "Speed to first customer", short: "How soon the first customer could pay. Higher means sooner.", axis: "Speed" },
  capital_intensity: { word: "Capital intensity", short: "How much money it takes before the first sale. Higher means less money needed.", axis: "Capital" },
  agent_executability: { word: "Agent-executability", short: "How much of the work your agent team can do on its own. Higher means more of it.", axis: "Agents" },
  founder_fit: { word: "Founder fit", short: "How well your skills and constraints match what this needs. Higher means a closer match.", axis: "Founder fit" },
  defensibility: { word: "Defensibility", short: "How hard it is for others to copy. Higher means harder to copy.", axis: "Defensibility" },
  regulatory_load: { word: "Regulatory load", short: "How much regulation applies. Higher means fewer rules to deal with.", axis: "Regulatory" },
  distribution_clarity: { word: "Distribution clarity", short: "How clear the path to the first customers is. Higher means a clearer path.", axis: "Distribution" },
};

const mapAttributes = <T,>(pick: (d: (typeof CONCEPT_ATTRIBUTE_DEFINITIONS)[ConceptAttributeKey]) => T): Record<ConceptAttributeKey, T> =>
  Object.fromEntries(CONCEPT_ATTRIBUTE_KEYS.map((k) => [k, pick(CONCEPT_ATTRIBUTE_DEFINITIONS[k])])) as Record<ConceptAttributeKey, T>;

export const CONCEPT_ATTRIBUTE_LABELS: Record<ConceptAttributeKey, string> = mapAttributes((d) => d.word);

/** What each attribute measures and which way it reads (`CONCEPT_ATTRIBUTE_DEFINITIONS[key].short`). */
export const CONCEPT_ATTRIBUTE_HINTS: Record<ConceptAttributeKey, string> = mapAttributes((d) => d.short);

/** The short axis names on the radar. */
export const CONCEPT_ATTRIBUTE_AXIS_LABELS: Record<ConceptAttributeKey, string> = mapAttributes((d) => d.axis);

export interface ConceptEvidence {
  text: string;
  source?: string;
  url?: string;
}

export interface ConceptAttribute {
  key: ConceptAttributeKey;
  /** 1–20 on the rating ramp. */
  value: number;
  evidence?: ConceptEvidence[];
}

export interface Concept {
  id: string;
  name: string;
  pitch: string;
  /** The chosen logo as a data URL (Commit screen); absent before one is chosen, which draws the initials mark. */
  logoSrc?: string | null;
  kit: Kit;
  monogram?: string;
  /** 0–5 in halves. */
  currentStars: number;
  potentialStars: number;
  attributes: ConceptAttribute[];
  /** "Agent verdict" shown in Compare. */
  verdict?: string;
  citations?: number;
  archetypeLabel?: string;
  version?: number;
  /** The pitch is the founder's own words (a card they wrote or edited): the card says so, and the team builds from them. */
  yourWords?: boolean;
  /** The card was written by the sample (mock) model: the card says so, so sample prose is never taken for the team's judgment. */
  sample?: boolean;
}

export const CONCEPT_ACTIONS = ["shortlist", "edit", "merge", "fork", "ask", "discard"] as const;
export type ConceptAction = (typeof CONCEPT_ACTIONS)[number];

/* ---------- Department cards, squad pulse, milestones (BUILD §11.2, §11.4) ---------- */

export type HealthTone = "good" | "warn" | "bad";

export interface SquadMember {
  id: string;
  name: string;
  seed: string | number;
  /** `agents.persona_key`: the name and face shown when anthropomorphic agents are on. */
  personaKey?: string | null;
  /** The agent's layer: a `utility` agent is a background helper and keeps its role name. */
  layer?: string | null;
  /** Its tier (`department.list`): a `background` helper stays out of the team strip and its count. */
  tier?: AgentTier | null;
  status: AgentStatus;
  role: string;
  model: string;
  task?: string | null;
}

export interface DepartmentMetric {
  label: string;
  value: string;
  series: number[];
  /** "▲ 12%" style text; colour follows `deltaTone`. */
  delta?: string;
  deltaTone?: HealthTone;
  provenance?: "forecast" | "estimate";
  /** What the sparkline plots when it is not the metric itself ("Cash at month end, last 6 months"). */
  seriesLabel?: string;
  /**
   * The TERMS id behind the metric ("runway", "mrr"), so the card can define its label and read its plain-words line
   * from the definitions source (PlainFigure). Absent for a metric the map does not define.
   */
  metricId?: string;
  /** The plain-words line under the figure when it is not the term's own sentence; shown while guidance is on. */
  plain?: ReactNode;
}

export interface DepartmentCardData {
  id: string;
  name: string;
  dept: DeptColourToken;
  /** The lead; `id` (when there is one) is how the card finds it in the team strip, never its name. */
  lead: { id?: string | null; name: string; seed: string | number; status: AgentStatus; role?: string; personaKey?: string | null; layer?: string | null };
  health: HealthTone;
  /** Word next to the health icon ("Healthy", "Waiting", "Failing"). */
  healthWord?: string;
  squad: SquadMember[];
  /** Up to three live lines; [[ent:id|Name]] markup is rendered as entity links. */
  now: string[];
  /** The department's work is still loading: "Now" shows placeholders instead of calling the department quiet. */
  nowLoading?: boolean;
  /**
   * With no "Now" lines: what the department is waiting for or last did, one line from real data (a note waiting in
   * the Inbox, the last task it finished). Without it a quiet card says only that nothing is in progress.
   */
  quiet?: DepartmentQuietLine | null;
  metric: DepartmentMetric;
  nextUp: string;
}

/**
 * A quiet department's one line (DepartmentCard): a kicker, the line, and an optional short detail. `attention`: an
 * agent of the team that needs the founder (failing, down, degraded) or a task that failed; `respond`: a note waiting
 * for the founder's answer; `inbox`: an unread note from the department; `finished`: the last task it finished;
 * `clear`: nothing in progress and nothing waiting on the founder; `error`: the department's work could not be loaded
 * (the card does not call itself quiet, and the line retries).
 */
export interface DepartmentQuietLine {
  kind: "attention" | "respond" | "inbox" | "finished" | "clear" | "error";
  /** "Needs you", "Needs your answer", "New in your Inbox", "Last finished", "All clear", "Couldn't load". */
  label: string;
  /** The note's subject or the task's title. */
  text: string;
  /** "2 more in the Inbox", "31 Aug". */
  detail?: string;
}

export interface TrophyCard {
  key: string;
  label: string;
  description: string;
  achievedAt: IsoDateTime | null;
  /** Customer name when permission to show it is recorded; otherwise anonymised by the caller. */
  customerName?: string | null;
  amountMinor?: number | null;
  currency?: string;
  shareable?: boolean;
  /** The figure behind the milestone is an estimate (an "MRR" milestone of a business without subscriptions): labeled Estimate. */
  estimate?: boolean;
}

export interface SquadPulseCell {
  departmentId: string;
  /** 0–6, index into `days`. */
  dayIndex: number;
  /** 0–23 UTC hour. */
  hour: number;
  agentHours: number;
}
