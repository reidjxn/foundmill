/**
 * Journey records (BUILD §7.2 "Journey", §11.4). Zod schemas and TS types.
 *
 * Times are ISO-8601 strings in every journey record: the records are stored as jsonb
 * (`journeys.weights`, `journeys.xc_series`, `journeys.agents`) and replays must be
 * deterministic and hashable (AC-11.4.3), so the schemas accept `Date` inputs and
 * normalise them to ISO strings. See docs/DECISIONS.md "Journey records carry ISO strings".
 */
import { z } from "zod";
import { Archetype, ChannelKey, ConversionKind, MatchdayLevel, MilestoneKind, Visibility } from "@foundmill/shared";

// ---------------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------------

/** ISO-8601 date-time with offset (`Z` or `±hh:mm`). A `Date` input is converted. */
export const IsoDateTime = z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.iso.datetime({ offset: true }));
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Calendar day `YYYY-MM-DD` (UTC). */
export const DayKey = z.iso.date();
export type DayKey = z.infer<typeof DayKey>;

/** 8-4-4-4-12 hex id. GUID rather than strict RFC-4122 because seeds and fixtures use deterministic ids. */
export const Id = z.guid();
export type Id = z.infer<typeof Id>;

const MinorAmount = z.number().int().nonnegative();
const Currency = z.string().length(3).toUpperCase();

// ---------------------------------------------------------------------------------------------------
// Consent, touch kinds, sources
// ---------------------------------------------------------------------------------------------------

/** Mirrors `visitors.consent_state` (migration 0007). */
export const CONSENT_STATES = ["unknown", "granted", "denied", "withdrawn"] as const;
export const ConsentState = z.enum(CONSENT_STATES);
export type ConsentState = (typeof CONSENT_STATES)[number];

export const TOUCH_KINDS = [
  "visit", "ad_click", "email_delivered", "email_open", "email_click", "email_reply", "code_redeemed", "qr_scan", "call",
  "form_submit", "meeting", "message", "mail_delivered", "social_engagement",
] as const;
export const TouchKind = z.enum(TOUCH_KINDS);
export type TouchKind = (typeof TOUCH_KINDS)[number];

/** Which kind of code a redemption carried (offline codes attribute to direct mail / print / OOH / broadcast, AC-11.4.4). */
export const CODE_KINDS = ["promo", "affiliate", "influencer", "qr", "vanity_url", "tracking_number"] as const;
export const CodeKind = z.enum(CODE_KINDS);
export type CodeKind = (typeof CODE_KINDS)[number];

/** Click identifiers appended by ad platforms. */
export const ClickIds = z.object({
  gclid: z.string().nullable().default(null),
  gbraid: z.string().nullable().default(null),
  wbraid: z.string().nullable().default(null),
  fbclid: z.string().nullable().default(null),
  ttclid: z.string().nullable().default(null),
  li_fat_id: z.string().nullable().default(null),
  msclkid: z.string().nullable().default(null),
  twclid: z.string().nullable().default(null),
  rdt_cid: z.string().nullable().default(null),
});
export type ClickIds = z.infer<typeof ClickIds>;
export type ClickIdKey = keyof ClickIds;
export const CLICK_ID_KEYS = Object.keys(ClickIds.shape) as readonly ClickIdKey[];

export const Utm = z.object({
  source: z.string().nullable().default(null),
  medium: z.string().nullable().default(null),
  campaign: z.string().nullable().default(null),
  term: z.string().nullable().default(null),
  content: z.string().nullable().default(null),
});
export type Utm = z.infer<typeof Utm>;

/** Normalised `touches.source` jsonb. Everything optional so partial sources round-trip. */
export const TouchSource = z.object({
  utm: Utm.default(() => Utm.parse({})),
  referrer: z.string().nullable().default(null),
  referrerHost: z.string().nullable().default(null),
  landingUrl: z.string().nullable().default(null),
  clickIds: ClickIds.default(() => ClickIds.parse({})),
  code: z.string().nullable().default(null),
  codeKind: CodeKind.nullable().default(null),
  /** Vanity path or phone number used for offline attribution, as typed/dialled. */
  offlineKey: z.string().nullable().default(null),
  /** Connector that reported the touch (sendgrid, meta_capi, shopify, site, ...). */
  provider: z.string().nullable().default(null),
  /** Agent that performed the action (an email sent by the lifecycle agent, a call by lead gen). */
  agentId: Id.nullable().default(null),
  /** Free-text label for the replay ("Opened 'Welcome to Ledgerly'"). */
  label: z.string().nullable().default(null),
});
export type TouchSource = z.infer<typeof TouchSource>;
export type TouchSourceInput = z.input<typeof TouchSource>;

// ---------------------------------------------------------------------------------------------------
// Touch, Conversion
// ---------------------------------------------------------------------------------------------------

export const Touch = z.object({
  id: Id,
  businessId: Id.optional(),
  visitorId: Id.nullable().default(null),
  entityId: Id.nullable().default(null),
  occurredAt: IsoDateTime,
  channelKey: ChannelKey.nullable().default(null),
  campaignId: Id.nullable().default(null),
  kind: TouchKind.default("visit"),
  source: TouchSource.default(() => TouchSource.parse({})),
  /**
   * True when the touch was observed on the business's own properties or channels (site, email, codes, calls).
   * False for touches reported by a third party (ad-platform conversion APIs) or carrying third-party click ids.
   * Consent filtering keeps first-party touches only.
   */
  firstParty: z.boolean().default(true),
});
export type Touch = z.infer<typeof Touch>;
export type TouchInput = z.input<typeof Touch>;

export const Conversion = z.object({
  id: Id,
  businessId: Id.optional(),
  entityId: Id.nullable().default(null),
  kind: ConversionKind,
  amountMinor: MinorAmount.default(0),
  /** The conversion's own currency (a payment's; for a sign-up, the business's). No fixed default. */
  currency: Currency,
  occurredAt: IsoDateTime,
  sourceEventId: Id.nullable().default(null),
  /** Set by the payment connector: the customer's first payment is what makes it a cup tie. */
  firstPayment: z.boolean().default(true),
});
export type Conversion = z.infer<typeof Conversion>;
export type ConversionInput = z.input<typeof Conversion>;

// ---------------------------------------------------------------------------------------------------
// Attribution, xC, Journey
// ---------------------------------------------------------------------------------------------------

export const ATTRIBUTION_MODELS = ["position_based_40_20_40", "data_driven_markov"] as const;
export const AttributionModel = z.enum(ATTRIBUTION_MODELS);
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** A point on the xC curve: cumulative probability of conversion after this touch. */
export const XcPoint = z.object({
  index: z.number().int().nonnegative(),
  touchId: Id.nullable(),
  at: IsoDateTime,
  /** Probability contributed by this touch alone (0 for the terminal conversion point). */
  p: z.number().min(0).max(1),
  /** Cumulative probability after this touch; non-decreasing; 1 at the conversion. */
  cumulative: z.number().min(0).max(1),
});
export type XcPoint = z.infer<typeof XcPoint>;

export const XC_MODEL_SOURCES = ["archetype_prior", "trained"] as const;
export const XcModel = z.object({
  source: z.enum(XC_MODEL_SOURCES),
  archetype: Archetype.nullable(),
  featureNames: z.array(z.string()),
  weights: z.array(z.number()),
  /** Labelled conversions the model saw (0 for a prior). */
  trainedOn: z.number().int().nonnegative(),
});
export type XcModel = z.infer<typeof XcModel>;

/** An agent on the team sheet with its share of the attribution. */
export const JourneyAgent = z.object({
  agentId: Id,
  name: z.string(),
  role: z.string().nullable().default(null),
  departmentId: Id.nullable().default(null),
  /** Sum of the weights of the touches this agent worked (shared equally when several agents share a touch). */
  contribution: z.number().min(0).max(1),
  touchIds: z.array(Id),
  /** Full-time rating 1–10, derived from contribution relative to the best contributor. */
  rating: z.number().int().min(1).max(10),
});
export type JourneyAgent = z.infer<typeof JourneyAgent>;

export const JourneyChannel = z.object({
  channelKey: ChannelKey.nullable(),
  weight: z.number().min(0).max(1),
  touchCount: z.number().int().nonnegative(),
});
export type JourneyChannel = z.infer<typeof JourneyChannel>;

export const JourneyCaptain = z.object({
  touchId: Id,
  channelKey: ChannelKey.nullable(),
  agentId: Id.nullable(),
  weight: z.number().min(0).max(1),
});
export type JourneyCaptain = z.infer<typeof JourneyCaptain>;

export const JourneyStats = z.object({
  touchCount: z.number().int().nonnegative(),
  firstTouchAt: IsoDateTime.nullable(),
  lastTouchAt: IsoDateTime.nullable(),
  timeToConvertHours: z.number().nonnegative().nullable(),
  /** Estimate: Σ weight × channel/campaign CPA. Null when no cost data was supplied. */
  acquisitionCostMinor: MinorAmount.nullable(),
  currency: Currency,
});
export type JourneyStats = z.infer<typeof JourneyStats>;

/** The journey record (`journeys` row plus the derived fields the Match Day and `customer.converted` need). */
export const Journey = z.object({
  id: Id.optional(),
  businessId: Id.optional(),
  conversionId: Id,
  entityId: Id.nullable(),
  kind: ConversionKind,
  touchIds: z.array(Id),
  /** touchId → attribution weight; sums to 1 when there is at least one touch. */
  weights: z.record(z.string(), z.number()),
  xcSeries: z.array(XcPoint),
  /** Composer output (`POST /v1/commentary`); empty until narrated. */
  commentary: z.array(z.unknown()),
  agents: z.array(JourneyAgent),
  matchdayLevel: MatchdayLevel,
  viewedAt: IsoDateTime.nullable().default(null),
  // Derived (recomputable from the inputs; not columns on `journeys`).
  channels: z.array(JourneyChannel),
  captain: JourneyCaptain.nullable(),
  playerOfTheMatch: Id.nullable(),
  attributionModel: AttributionModel,
  xcModelSource: z.enum(XC_MODEL_SOURCES),
  consent: ConsentState,
  partialJourney: z.boolean(),
  nthOfKind: z.number().int().positive(),
  fullMatchDay: z.boolean(),
  stats: JourneyStats,
  convertedAt: IsoDateTime,
});
export type Journey = z.infer<typeof Journey>;

// ---------------------------------------------------------------------------------------------------
// Daily rows, milestones, chapters
// ---------------------------------------------------------------------------------------------------

/** One row of `journey_daily` (business × UTC day × department; department null for business-wide rows). */
export const JourneyDailyRow = z.object({
  businessId: Id.optional(),
  day: DayKey,
  departmentId: Id.nullable(),
  agentHours: z.number().nonnegative(),
  tasksDone: z.number().int().nonnegative(),
  spendMinor: MinorAmount,
  revenueMinor: MinorAmount,
  signups: z.number().int().nonnegative(),
  activations: z.number().int().nonnegative(),
  payments: z.number().int().nonnegative(),
  decisions: z.number().int().nonnegative(),
});
export type JourneyDailyRow = z.infer<typeof JourneyDailyRow>;

/**
 * The milestones the platform records itself, in the order they are listed everywhere. The two early ones come first
 * (docs/NETWORK.md F3; docs/THESIS_REVIEW.md package 5.3): the project's page going live and its first confirmed
 * follower, each a real outside result the platform saw happen.
 */
export const TROPHY_KEYS = [
  "page_live", "first_follower",
  "customer_1", "customer_10", "customer_100", "customer_1000",
  "mrr_1k", "mrr_10k", "mrr_100k",
  "first_enterprise_contract",
] as const;
export const TrophyKey = z.enum(TROPHY_KEYS);
export type TrophyKey = (typeof TROPHY_KEYS)[number];

export const Milestone = z.object({
  id: Id.optional(),
  businessId: Id.optional(),
  kind: MilestoneKind,
  label: z.string().min(1),
  achievedAt: IsoDateTime,
  ref: z.record(z.string(), z.unknown()).nullable().default(null),
  visibility: Visibility.default("private"),
  /** Set for trophy-cabinet milestones so each fires once. */
  trophyKey: TrophyKey.nullable().default(null),
});
export type Milestone = z.infer<typeof Milestone>;
export type MilestoneInput = z.input<typeof Milestone>;

export const CHAPTER_STATUSES = ["past", "current", "future"] as const;
export const ChapterStatus = z.enum(CHAPTER_STATUSES);
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const ChapterSummary = z.object({
  days: z.number().int().nonnegative(),
  agentHours: z.number().nonnegative(),
  tasksDone: z.number().int().nonnegative(),
  spendMinor: MinorAmount,
  revenueMinor: MinorAmount,
  signups: z.number().int().nonnegative(),
  activations: z.number().int().nonnegative(),
  payments: z.number().int().nonnegative(),
  decisions: z.number().int().nonnegative(),
  milestoneLabels: z.array(z.string()),
});
export type ChapterSummary = z.infer<typeof ChapterSummary>;

/** One quarter of the business's life (a chapter). Titles come from Opus; `provisionalTitle` is a deterministic placeholder. */
export const Chapter = z.object({
  id: z.string().regex(/^\d{4}-Q[1-4]$/),
  index: z.number().int().nonnegative(),
  year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  startsOn: DayKey,
  endsOn: DayKey,
  status: ChapterStatus,
  title: z.string().nullable(),
  provisionalTitle: z.string(),
  summary: ChapterSummary,
});
export type Chapter = z.infer<typeof Chapter>;
