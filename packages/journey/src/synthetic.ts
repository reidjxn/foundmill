/**
 * Synthetic journey data (BUILD §17.2 "2 years of synthetic journey data", AC-11.2.1).
 *
 * `generateSyntheticJourneyData` produces, deterministically from a seed, everything the Ribbon and Match Day need for
 * a demo business: dense `journey_daily` rows (agent hours per department with a weekly rhythm, ramp, growth,
 * seasonality, launches as step changes and a dip), customers with signup → activation → payment conversions, their
 * touch paths (UTM / referrer / click ids / codes / offline), trophies and scripted milestones, and quarter chapters.
 * `generateSyntheticConversionPath` yields one ready-to-build journey for Match Day replays.
 *
 * Every number here is synthetic. Consumers must label it (CLAUDE.md: "Label every non-real number").
 */
import { CHANNEL_KEYS, type Archetype, type ChannelKey, type ModuleKey } from "@foundmill/shared/constants";
import type { AttributionRegistry } from "./attribution";
import type { BuildJourneyInput, JourneyAgentInput } from "./builder";
import { buildChapters } from "./chapters";
import { createSeededRng, clamp, type SeededRng } from "./rng";
import { addDaysKey, dayKeyToDate, dayKeyUtc, isoWeekdayUtc, toDate, compareByTimeThenId, DAY_MS, HOUR_MS } from "./time";
import { detectTrophies, isEnterpriseContract, type TrophyCounters } from "./trophies";
import {
  type Chapter, type ConsentState, type Conversion, type DayKey, type JourneyDailyRow, type Milestone, type Touch, type TouchKind, type TouchSource,
  type TrophyKey,
} from "./types";

// ---------------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------------

export interface SyntheticDepartmentInput {
  id: string;
  name: string;
  moduleKeys?: readonly ModuleKey[];
}

export interface GenerateSyntheticJourneyDataOptions {
  seed: string | number;
  /** Kick-off day (UTC). */
  startDate: DayKey | Date | string;
  /** Default 730 (two years). */
  days?: number;
  departments: readonly SyntheticDepartmentInput[];
  archetype: Archetype;
  /** Kit primary colour, passed through to `meta` for Match Day replays. */
  kitColour?: string | null;
  currency?: string;
  businessId?: string;
  /** The business's own host (default `<seed-slug>.example`). */
  siteHost?: string;
  /** Multiply every volume (signups, visitors) by this; 1 by default. */
  volumeScale?: number;
  /** Anonymous visitors that never convert, per signup (default 0.6). They train the Markov and xC models. */
  nonConvertingVisitorRatio?: number;
  /** Today's day for chapter status; default: the last generated day. */
  today?: DayKey;
}

export interface SyntheticCustomer {
  entityId: string;
  visitorId: string;
  displayName: string;
  kind: "person" | "organisation";
  consent: ConsentState;
  signupAt: string;
  activatedAt: string | null;
  paidAt: string | null;
  amountMinor: number | null;
  enterprise: boolean;
  /** Monthly recurring amount in minor units (0 for one-off purchases). */
  mrrMinor: number;
  churnedAt: string | null;
}

export interface SyntheticVisitor {
  id: string;
  anonId: string;
  entityId: string | null;
  firstSeen: string;
  lastSeen: string;
  consentState: ConsentState;
  converted: boolean;
}

export interface SyntheticAgent extends JourneyAgentInput {
  avatarSeed: string;
}

export interface SyntheticCampaign {
  id: string;
  channelKey: ChannelKey;
  name: string;
  code: string | null;
  vanityPath: string | null;
  trackingNumber: string | null;
}

export interface SyntheticJourneyData {
  meta: {
    seed: string;
    label: "Synthetic";
    archetype: Archetype;
    startDate: DayKey;
    endDate: DayKey;
    days: number;
    currency: string;
    kitColour: string | null;
    siteHost: string;
    businessId: string | null;
    departmentIds: string[];
    recurring: boolean;
  };
  daily: JourneyDailyRow[];
  conversions: Conversion[];
  touches: Touch[];
  milestones: Milestone[];
  chapters: Chapter[];
  customers: SyntheticCustomer[];
  visitors: SyntheticVisitor[];
  agents: SyntheticAgent[];
  campaigns: SyntheticCampaign[];
  registry: AttributionRegistry;
  series: {
    /** MRR (or trailing-30-day revenue for non-recurring businesses) per day, minor units. */
    mrrMinorByDay: number[];
    /** Paying customers so far, per day. */
    customersByDay: number[];
  };
}

// ---------------------------------------------------------------------------------------------------
// Archetype profiles
// ---------------------------------------------------------------------------------------------------

type MixState = ChannelKey | "direct";

interface Profile {
  customerKind: "person" | "organisation";
  signupsPerDay: readonly [start: number, end: number];
  activationRate: number;
  activationLagMeanDays: number;
  paymentRate: number;
  paymentLagMeanDays: number;
  priceMinor: readonly [number, number];
  recurring: boolean;
  enterpriseShare: number;
  enterprisePriceMinor: readonly [number, number];
  monthlyChurn: number;
  firstTouchMix: Partial<Record<MixState, number>>;
  touchesMean: number;
  lagToSignupMeanDays: number;
  season: "b2b" | "retail" | "flat";
  /** Monday … Sunday signup multipliers. */
  weekly: readonly [number, number, number, number, number, number, number];
  funding: boolean;
  /** Paid spend per paid-driven signup, minor units. */
  adCpaMinor: number;
  signupHour: readonly [mean: number, sd: number];
}

const PROFILES: Record<Archetype, Profile> = {
  b2b_saas: {
    customerKind: "organisation", signupsPerDay: [0.8, 7], activationRate: 0.55, activationLagMeanDays: 4, paymentRate: 0.45, paymentLagMeanDays: 9,
    priceMinor: [4_900, 49_900], recurring: true, enterpriseShare: 0.04, enterprisePriceMinor: [1_200_000, 3_600_000], monthlyChurn: 0.03,
    firstTouchMix: { lead_generation: 0.18, seo: 0.18, content: 0.12, paid_ads: 0.14, geo: 0.06, social: 0.08, events: 0.05, pr: 0.05, affiliate: 0.03, direct: 0.11 },
    touchesMean: 3.2, lagToSignupMeanDays: 10, season: "b2b", weekly: [1.1, 1.15, 1.1, 1.05, 0.9, 0.3, 0.25], funding: true, adCpaMinor: 9_000, signupHour: [14, 3.5],
  },
  consumer_app: {
    customerKind: "person", signupsPerDay: [3, 30], activationRate: 0.5, activationLagMeanDays: 1, paymentRate: 0.18, paymentLagMeanDays: 5,
    priceMinor: [499, 1_499], recurring: true, enterpriseShare: 0, enterprisePriceMinor: [0, 0], monthlyChurn: 0.08,
    firstTouchMix: { paid_ads: 0.3, social: 0.25, influencer: 0.12, seo: 0.1, pr: 0.04, content: 0.04, affiliate: 0.03, direct: 0.12 },
    touchesMean: 2.4, lagToSignupMeanDays: 4, season: "flat", weekly: [1, 1, 1, 1, 1.05, 1.15, 1.15], funding: true, adCpaMinor: 1_200, signupHour: [19, 4],
  },
  marketplace: {
    customerKind: "person", signupsPerDay: [2, 18], activationRate: 0.5, activationLagMeanDays: 3, paymentRate: 0.3, paymentLagMeanDays: 7,
    priceMinor: [1_500, 9_000], recurring: false, enterpriseShare: 0, enterprisePriceMinor: [0, 0], monthlyChurn: 0,
    firstTouchMix: { seo: 0.28, social: 0.15, paid_ads: 0.18, content: 0.1, affiliate: 0.06, pr: 0.05, geo: 0.04, direct: 0.14 },
    touchesMean: 2.8, lagToSignupMeanDays: 6, season: "retail", weekly: [1, 1, 1, 1, 1.05, 1.1, 1.1], funding: true, adCpaMinor: 2_500, signupHour: [17, 5],
  },
  dtc_physical: {
    customerKind: "person", signupsPerDay: [1.5, 14], activationRate: 0.6, activationLagMeanDays: 2, paymentRate: 0.8, paymentLagMeanDays: 0.4,
    priceMinor: [2_500, 12_000], recurring: false, enterpriseShare: 0.01, enterprisePriceMinor: [1_000_000, 2_400_000], monthlyChurn: 0,
    firstTouchMix: { paid_ads: 0.28, influencer: 0.16, social: 0.14, seo: 0.08, affiliate: 0.05, direct_mail: 0.05, print: 0.04, outdoor: 0.04, broadcast: 0.03, pr: 0.03, direct: 0.1 },
    touchesMean: 2.6, lagToSignupMeanDays: 5, season: "retail", weekly: [0.95, 1, 1, 1, 1.05, 1.1, 1.1], funding: false, adCpaMinor: 2_200, signupHour: [19, 4],
  },
  hardware: {
    customerKind: "organisation", signupsPerDay: [0.3, 3], activationRate: 0.5, activationLagMeanDays: 7, paymentRate: 0.5, paymentLagMeanDays: 20,
    priceMinor: [45_000, 250_000], recurring: false, enterpriseShare: 0.1, enterprisePriceMinor: [1_500_000, 6_000_000], monthlyChurn: 0,
    firstTouchMix: { pr: 0.15, events: 0.15, content: 0.15, lead_generation: 0.15, seo: 0.1, paid_ads: 0.1, social: 0.08, direct: 0.12 },
    touchesMean: 3.6, lagToSignupMeanDays: 20, season: "b2b", weekly: [1.1, 1.15, 1.1, 1.05, 0.9, 0.3, 0.25], funding: true, adCpaMinor: 15_000, signupHour: [14, 3],
  },
  services: {
    customerKind: "organisation", signupsPerDay: [0.3, 3], activationRate: 0.6, activationLagMeanDays: 5, paymentRate: 0.6, paymentLagMeanDays: 10,
    priceMinor: [80_000, 400_000], recurring: true, enterpriseShare: 0.08, enterprisePriceMinor: [1_200_000, 4_000_000], monthlyChurn: 0.04,
    firstTouchMix: { lead_generation: 0.25, seo: 0.2, pr: 0.1, events: 0.1, direct_mail: 0.05, content: 0.08, social: 0.05, direct: 0.17 },
    touchesMean: 3, lagToSignupMeanDays: 12, season: "b2b", weekly: [1.1, 1.15, 1.1, 1.05, 0.9, 0.3, 0.25], funding: false, adCpaMinor: 12_000, signupHour: [13, 3],
  },
  content_media: {
    customerKind: "person", signupsPerDay: [3, 25], activationRate: 0.45, activationLagMeanDays: 2, paymentRate: 0.12, paymentLagMeanDays: 10,
    priceMinor: [500, 1_200], recurring: true, enterpriseShare: 0, enterprisePriceMinor: [0, 0], monthlyChurn: 0.06,
    firstTouchMix: { social: 0.32, seo: 0.22, content: 0.15, geo: 0.05, pr: 0.05, paid_ads: 0.06, affiliate: 0.03, direct: 0.12 },
    touchesMean: 2.5, lagToSignupMeanDays: 7, season: "flat", weekly: [1, 1, 1, 1, 1, 1.05, 1.05], funding: false, adCpaMinor: 800, signupHour: [20, 4],
  },
};

/** Base agent hours per day per module (several agents each). */
const MODULE_HOURS: Record<ModuleKey, number> = { development: 14, distribution: 10, product: 5, finance: 2, legal: 1.5, team: 1.5 };
const DEFAULT_MODULE_HOURS = 3;
/** Model + sandbox cost per agent hour, minor units (≈ €1.80). */
const AGENT_HOUR_COST_MINOR = 180;

// ---------------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------------

const bump = (x: number, centre: number, width: number): number => Math.exp(-0.5 * ((x - centre) / width) ** 2);

function seasonality(kind: Profile["season"], dayOfYear: number): number {
  switch (kind) {
    case "b2b":
      return 1 - 0.25 * bump(dayOfYear, 215, 18) - 0.3 * (bump(dayOfYear, 358, 9) + bump(dayOfYear, -7, 9)) + 0.08 * (bump(dayOfYear, 20, 15) + bump(dayOfYear, 255, 15));
    case "retail":
      return 1 + 0.35 * bump(dayOfYear, 335, 16) - 0.15 * bump(dayOfYear, 15, 14) + 0.08 * bump(dayOfYear, 135, 20);
    default:
      return 1 + 0.05 * Math.sin((2 * Math.PI * dayOfYear) / 365);
  }
}

const dayOfYearUtc = (day: DayKey): number => {
  const d = dayKeyToDate(day);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS);
};

interface ScriptedEvent {
  day: number;
  kind: Milestone["kind"];
  label: string;
  signupStep: number;
  hoursStep: number;
}

/** Launches and other step changes, placed by fraction of the generated window so shorter windows keep the shape. */
function script(profile: Profile, archetype: Archetype, days: number): { events: ScriptedEvent[]; dip: { from: number; to: number; signups: number; hours: number } } {
  const at = (f: number) => Math.min(days - 1, Math.max(0, Math.round(f * days)));
  const events: ScriptedEvent[] = [
    { day: at(0.007), kind: "incorporation", label: "Incorporated", signupStep: 1, hoursStep: 1 },
    { day: at(0.06), kind: "launch", label: "Public launch", signupStep: 2.2, hoursStep: 1.3 },
    { day: at(0.15), kind: "decision", label: "Chose the first channels", signupStep: 1, hoursStep: 1 },
    { day: at(0.35), kind: "decision", label: "Expanded the team", signupStep: 1, hoursStep: 1.1 },
    { day: at(0.45), kind: "launch", label: archetype === "dtc_physical" ? "New range launch" : "v2 launch", signupStep: 1.5, hoursStep: 1.15 },
    { day: at(0.6), kind: "decision", label: "Pricing reset", signupStep: 1.1, hoursStep: 1 },
    { day: at(0.77), kind: "launch", label: profile.recurring ? "Annual plans" : "Retail partnership", signupStep: 1.3, hoursStep: 1.05 },
    { day: at(0.85), kind: "decision", label: "Opened a second market", signupStep: 1.1, hoursStep: 1.05 },
  ];
  if (profile.funding) events.push({ day: at(0.27), kind: "funding", label: "Pre-seed round", signupStep: 1.2, hoursStep: 1.5 });
  events.sort((a, b) => a.day - b.day);
  return { events, dip: { from: at(0.57), to: at(0.615), signups: 0.55, hours: 0.75 } };
}

// ---------------------------------------------------------------------------------------------------
// Names (synthetic, from syllables; no real people or brands)
// ---------------------------------------------------------------------------------------------------

const FIRST = ["Ada", "Bo", "Cato", "Dara", "Eli", "Fenna", "Gil", "Hana", "Ivo", "Jun", "Kari", "Lior", "Mina", "Noor", "Odin", "Pia", "Quin", "Rafa", "Sol", "Tove", "Uma", "Vik", "Wren", "Yara", "Zed"];
const LAST = ["Aalto", "Brandt", "Castel", "Dupré", "Ekholm", "Faber", "Garza", "Holm", "Ivers", "Jansen", "Kovač", "Lund", "Marin", "Nakano", "Ortiz", "Paz", "Quist", "Rask", "Sato", "Tamm", "Udo", "Vale", "Weiss", "Yun", "Zorn"];
const ORG_STEM = ["North", "Bright", "Ledger", "Harbor", "Pine", "Vector", "Quill", "Summit", "Delta", "Orbit", "Maple", "Cobalt", "Granite", "Lumen", "Meridian", "Anchor", "Beacon", "Cinder", "Fjord", "Tessel"];
const ORG_SUFFIX = ["Labs", "Works", "Analytics", "Systems", "Studio", "Partners", "Logistics", "Health", "Robotics", "Foods", "Collective", "Group", "Supply", "Media", "Finance"];
const PRESS_HOSTS = ["dailybeacon.example", "foundersdigest.example", "thebuildreport.example", "regionalgazette.example", "industrywire.example"];
const CREATORS = ["mira.makes", "the.daily.kit", "kai.reviews", "slowmornings", "benchtalk", "studio.noor"];
const PARTNERS = ["toolstack", "indiebundle", "founderdeals", "sidebarco"];
const TOPICS = ["pricing-guide", "getting-started", "benchmarks-2025", "ingredients-explained", "how-we-ship", "case-study"];
const EVENTS = ["saas-summit", "maker-fair", "fintech-week", "beauty-expo", "founder-meetup"];

function personName(rng: SeededRng): string {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}
function orgName(rng: SeededRng): string {
  return `${rng.pick(ORG_STEM)}${rng.bool(0.3) ? rng.pick(ORG_STEM).toLowerCase() : ""} ${rng.pick(ORG_SUFFIX)}`;
}

// ---------------------------------------------------------------------------------------------------
// Agents and campaigns
// ---------------------------------------------------------------------------------------------------

const DISTRIBUTION_ROLES: ReadonlyArray<{ role: string; channels: ChannelKey[] }> = [
  { role: "Distribution strategist", channels: [] },
  { role: "Paid media lead", channels: ["paid_ads"] },
  { role: "Lifecycle email", channels: ["email_automation"] },
  { role: "SEO and content", channels: ["seo", "content", "geo"] },
  { role: "Social and creators", channels: ["social", "influencer", "pr"] },
  { role: "Outbound", channels: ["lead_generation", "events"] },
  { role: "Offline campaigns", channels: ["direct_mail", "print", "broadcast", "outdoor", "affiliate"] },
];
const MODULE_ROLES: Record<ModuleKey, string[]> = {
  development: ["Engineering lead", "Backend engineer", "Frontend engineer"],
  distribution: [],
  product: ["Product manager", "Researcher"],
  finance: ["Finance analyst"],
  legal: ["Legal counsel"],
  team: ["Chief of Staff"],
};

function makeAgents(rng: SeededRng, departments: readonly SyntheticDepartmentInput[]): SyntheticAgent[] {
  const out: SyntheticAgent[] = [];
  for (const d of departments) {
    const modules = d.moduleKeys ?? [];
    const roles: Array<{ role: string; channels: ChannelKey[] }> = [];
    for (const m of modules) {
      if (m === "distribution") roles.push(...DISTRIBUTION_ROLES);
      else roles.push(...MODULE_ROLES[m].map((role) => ({ role, channels: [] as ChannelKey[] })));
    }
    if (roles.length === 0) roles.push({ role: `${d.name} specialist`, channels: [] });
    for (const r of roles) {
      const agentId = rng.uuid();
      out.push({ agentId, name: rng.pick(FIRST), role: r.role, departmentId: d.id, channelKeys: r.channels, campaignIds: [], avatarSeed: agentId.slice(0, 8) });
    }
  }
  return out;
}

function makeCampaigns(rng: SeededRng, siteHost: string): { campaigns: SyntheticCampaign[]; registry: AttributionRegistry } {
  const campaigns: SyntheticCampaign[] = [
    { id: rng.uuid(), channelKey: "direct_mail", name: "Spring postcard", code: "MAIL-SPRING", vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "direct_mail", name: "Welcome-back letter", code: "MAIL-BACK", vanityPath: null, trackingNumber: "+44 20 7946 0101" },
    { id: rng.uuid(), channelKey: "print", name: "Magazine insert", code: "PRINT-MAG", vanityPath: "/mag", trackingNumber: null },
    { id: rng.uuid(), channelKey: "print", name: "Local paper", code: "PAPER10", vanityPath: null, trackingNumber: "+44 20 7946 0102" },
    { id: rng.uuid(), channelKey: "broadcast", name: "Radio spot", code: "RADIO15", vanityPath: "/radio", trackingNumber: "+44 20 7946 0103" },
    { id: rng.uuid(), channelKey: "broadcast", name: "Podcast read", code: "POD20", vanityPath: "/pod", trackingNumber: null },
    { id: rng.uuid(), channelKey: "outdoor", name: "Station billboard", code: "QR-STATION", vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "outdoor", name: "Bus shelter", code: "QR-SHELTER", vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "influencer", name: "Creator seeding", code: "INF-MIRA", vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "affiliate", name: "Partner programme", code: "AFF-TOOLSTACK", vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "paid_ads", name: "Search · brand", code: null, vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "paid_ads", name: "Social · prospecting", code: null, vanityPath: null, trackingNumber: null },
    { id: rng.uuid(), channelKey: "email_automation", name: "Onboarding sequence", code: null, vanityPath: null, trackingNumber: null },
  ];
  const registry: AttributionRegistry = { codes: {}, vanityUrls: {}, trackingNumbers: {}, ownHosts: [siteHost] };
  for (const c of campaigns) {
    const kind = c.channelKey === "outdoor" ? "qr" : c.channelKey === "influencer" ? "influencer" : c.channelKey === "affiliate" ? "affiliate" : "promo";
    if (c.code) registry.codes![c.code] = { channelKey: c.channelKey, campaignId: c.id, kind, label: c.name };
    if (c.vanityPath) registry.vanityUrls![c.vanityPath] = { channelKey: c.channelKey, campaignId: c.id, kind: "vanity_url", label: c.name };
    if (c.trackingNumber) registry.trackingNumbers![c.trackingNumber] = { channelKey: c.channelKey, campaignId: c.id, kind: "tracking_number", label: c.name };
  }
  return { campaigns, registry };
}

// ---------------------------------------------------------------------------------------------------
// Touch sources per channel (shaped so that `parseTouchSource` on the same URL / referrer / code agrees)
// ---------------------------------------------------------------------------------------------------

export function emptyTouchSource(): TouchSource {
  return {
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    referrer: null, referrerHost: null, landingUrl: null,
    clickIds: { gclid: null, gbraid: null, wbraid: null, fbclid: null, ttclid: null, li_fat_id: null, msclkid: null, twclid: null, rdt_cid: null },
    code: null, codeKind: null, offlineKey: null, provider: null, agentId: null, label: null,
  };
}

interface Ctx {
  rng: SeededRng;
  profile: Profile;
  archetype: Archetype;
  siteHost: string;
  campaigns: SyntheticCampaign[];
  agentsByChannel: Map<ChannelKey, SyntheticAgent[]>;
  lifecycleAgent: SyntheticAgent | null;
  outboundAgent: SyntheticAgent | null;
}

interface TouchDraft {
  channelKey: ChannelKey | null;
  kind: TouchKind;
  source: TouchSource;
  campaignId: string | null;
  firstParty: boolean;
}

const token = (rng: SeededRng, n = 12): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[rng.int(0, 35)];
  return s;
};

const campaignFor = (ctx: Ctx, channel: ChannelKey): SyntheticCampaign | null => {
  const list = ctx.campaigns.filter((c) => c.channelKey === channel);
  return list.length ? ctx.rng.pick(list) : null;
};

function draftTouch(ctx: Ctx, state: MixState, identified: boolean): TouchDraft {
  const { rng, siteHost } = ctx;
  const site = `https://${siteHost}`;
  const src = emptyTouchSource();
  const d = (channelKey: ChannelKey | null, kind: TouchKind, campaignId: string | null = null, firstParty = true): TouchDraft => ({ channelKey, kind, source: src, campaignId, firstParty });
  switch (state) {
    case "paid_ads": {
      const c = campaignFor(ctx, "paid_ads");
      const r = rng.next();
      if (r < 0.58) {
        src.clickIds.gclid = token(rng, 20);
        src.utm = { source: "google", medium: "cpc", campaign: c?.name ?? "search-brand", term: rng.pick(TOPICS), content: null };
        src.landingUrl = `${site}/?utm_source=google&utm_medium=cpc&utm_campaign=${slug(c?.name ?? "search-brand")}&gclid=${src.clickIds.gclid}`;
      } else if (r < 0.9) {
        src.clickIds.fbclid = token(rng, 24);
        src.utm = { source: "facebook", medium: "paid_social", campaign: c?.name ?? "prospecting", term: null, content: `creative-${rng.int(1, 6)}` };
        src.landingUrl = `${site}/?utm_source=facebook&utm_medium=paid_social&utm_campaign=${slug(c?.name ?? "prospecting")}&fbclid=${src.clickIds.fbclid}`;
      } else if (ctx.profile.customerKind === "organisation") {
        src.clickIds.li_fat_id = token(rng, 16);
        src.utm = { source: "linkedin", medium: "paid_social", campaign: c?.name ?? "prospecting", term: null, content: null };
        src.landingUrl = `${site}/?utm_source=linkedin&utm_medium=paid_social&li_fat_id=${src.clickIds.li_fat_id}`;
      } else {
        src.clickIds.ttclid = token(rng, 16);
        src.utm = { source: "tiktok", medium: "paid_social", campaign: c?.name ?? "prospecting", term: null, content: null };
        src.landingUrl = `${site}/?utm_source=tiktok&utm_medium=paid_social&ttclid=${src.clickIds.ttclid}`;
      }
      return d("paid_ads", "ad_click", c?.id ?? null, false);
    }
    case "social": {
      const host = ctx.profile.customerKind === "organisation" ? rng.pick(["linkedin.com", "x.com", "news.ycombinator.com"]) : rng.pick(["instagram.com", "tiktok.com", "x.com", "reddit.com", "youtube.com"]);
      src.referrer = `https://${host}/`;
      src.referrerHost = host;
      src.landingUrl = `${site}/`;
      return d("social", host === "news.ycombinator.com" ? "visit" : "visit");
    }
    case "seo": {
      src.referrer = "https://www.google.com/";
      src.referrerHost = "google.com";
      src.landingUrl = `${site}/${rng.bool(0.6) ? "" : rng.pick(TOPICS)}`;
      return d("seo", "visit");
    }
    case "geo": {
      const host = rng.pick(["chatgpt.com", "perplexity.ai", "claude.ai"]);
      src.referrer = `https://${host}/`;
      src.referrerHost = host;
      src.landingUrl = `${site}/`;
      return d("geo", "visit");
    }
    case "content": {
      const topic = rng.pick(TOPICS);
      src.utm = { source: "blog", medium: "content", campaign: topic, term: null, content: null };
      src.landingUrl = `${site}/guides/${topic}?utm_source=blog&utm_medium=content&utm_campaign=${topic}`;
      return d("content", "visit");
    }
    case "email_automation": {
      const c = campaignFor(ctx, "email_automation");
      const step = rng.pick(["welcome", "getting-started", "day-3-tips", "trial-ending", "case-study"]);
      const kind: TouchKind = rng.bool(0.6) ? "email_open" : "email_click";
      src.provider = "sendgrid";
      src.utm = { source: "sendgrid", medium: "email", campaign: step, term: null, content: null };
      src.agentId = ctx.lifecycleAgent?.agentId ?? null;
      src.label = `${kind === "email_open" ? "Opened" : "Clicked"} '${step.replace(/-/g, " ")}'`;
      if (kind === "email_click") src.landingUrl = `${site}/app?utm_source=sendgrid&utm_medium=email&utm_campaign=${step}`;
      return d("email_automation", kind, c?.id ?? null);
    }
    case "lead_generation": {
      const kind: TouchKind = identified ? rng.pick(["email_reply", "meeting", "call"]) : "email_reply";
      src.provider = "outbound";
      src.utm = { source: "outbound", medium: "outbound", campaign: "icp-sequence", term: null, content: null };
      src.agentId = ctx.outboundAgent?.agentId ?? null;
      src.label = kind === "meeting" ? "Discovery call booked" : kind === "call" ? "Follow-up call" : "Replied to outbound sequence";
      return d("lead_generation", kind);
    }
    case "influencer": {
      const c = campaignFor(ctx, "influencer");
      if (c?.code && rng.bool(0.55)) {
        src.code = c.code;
        src.codeKind = "influencer";
        src.label = `Redeemed ${c.code}`;
        return d("influencer", "code_redeemed", c.id);
      }
      const creator = rng.pick(CREATORS);
      src.utm = { source: creator, medium: "influencer", campaign: c?.name ?? "seeding", term: null, content: null };
      src.landingUrl = `${site}/?utm_source=${creator}&utm_medium=influencer`;
      return d("influencer", "visit", c?.id ?? null);
    }
    case "affiliate": {
      const c = campaignFor(ctx, "affiliate");
      const partner = rng.pick(PARTNERS);
      if (c?.code && rng.bool(0.4)) {
        src.code = c.code;
        src.codeKind = "affiliate";
        return d("affiliate", "code_redeemed", c.id);
      }
      src.utm = { source: partner, medium: "affiliate", campaign: c?.name ?? "partners", term: null, content: null };
      src.landingUrl = `${site}/?via=${partner}&utm_medium=affiliate&utm_source=${partner}`;
      return d("affiliate", "visit", c?.id ?? null);
    }
    case "pr": {
      const host = rng.pick(PRESS_HOSTS);
      src.referrer = `https://${host}/story/${token(rng, 6)}`;
      src.referrerHost = host;
      src.landingUrl = `${site}/`;
      return d("pr", "visit");
    }
    case "events": {
      const ev = rng.pick(EVENTS);
      if (rng.bool(0.5)) {
        src.utm = { source: ev, medium: "event", campaign: ev, term: null, content: null };
        src.landingUrl = `${site}/?utm_source=${ev}&utm_medium=event&utm_campaign=${ev}`;
        return d("events", "visit");
      }
      src.provider = "events";
      src.label = `Met at ${ev.replace(/-/g, " ")}`;
      return d("events", rng.bool(0.6) ? "form_submit" : "meeting");
    }
    case "direct_mail": {
      const c = campaignFor(ctx, "direct_mail")!;
      if (c.trackingNumber && rng.bool(0.3)) {
        src.codeKind = "tracking_number";
        src.offlineKey = c.trackingNumber;
        src.label = `Called ${c.trackingNumber}`;
        return d("direct_mail", "call", c.id);
      }
      src.code = c.code;
      src.codeKind = "promo";
      src.label = `Redeemed ${c.code}`;
      return d("direct_mail", "code_redeemed", c.id);
    }
    case "print": {
      const c = campaignFor(ctx, "print")!;
      const r = rng.next();
      if (c.vanityPath && r < 0.35) {
        src.codeKind = "vanity_url";
        src.offlineKey = c.vanityPath;
        src.landingUrl = `${site}${c.vanityPath}`;
        return d("print", "visit", c.id);
      }
      if (c.trackingNumber && r < 0.55) {
        src.codeKind = "tracking_number";
        src.offlineKey = c.trackingNumber;
        return d("print", "call", c.id);
      }
      src.code = c.code;
      src.codeKind = "promo";
      return d("print", "code_redeemed", c.id);
    }
    case "broadcast": {
      const c = campaignFor(ctx, "broadcast")!;
      const r = rng.next();
      if (c.vanityPath && r < 0.5) {
        src.codeKind = "vanity_url";
        src.offlineKey = c.vanityPath;
        src.landingUrl = `${site}${c.vanityPath}`;
        return d("broadcast", "visit", c.id);
      }
      if (c.trackingNumber && r < 0.7) {
        src.codeKind = "tracking_number";
        src.offlineKey = c.trackingNumber;
        return d("broadcast", "call", c.id);
      }
      src.code = c.code;
      src.codeKind = "promo";
      return d("broadcast", "code_redeemed", c.id);
    }
    case "outdoor": {
      const c = campaignFor(ctx, "outdoor")!;
      src.code = c.code;
      src.codeKind = "qr";
      src.utm = { source: "qr", medium: "qr", campaign: slug(c.name), term: null, content: null };
      src.landingUrl = `${site}/qr/${slug(c.name)}?utm_medium=qr&utm_campaign=${slug(c.name)}&code=${c.code}`;
      src.offlineKey = `/qr/${slug(c.name)}`;
      return d("outdoor", "qr_scan", c.id);
    }
    default: {
      src.landingUrl = `${site}/${rng.bool(0.7) ? "" : "pricing"}`;
      return d(null, "visit");
    }
  }
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ---------------------------------------------------------------------------------------------------
// Customer paths
// ---------------------------------------------------------------------------------------------------

function mixStates(profile: Profile): { states: MixState[]; weights: number[] } {
  const states = Object.keys(profile.firstTouchMix) as MixState[];
  return { states, weights: states.map((s) => profile.firstTouchMix[s] ?? 0) };
}

function pickState(ctx: Ctx, mix: { states: MixState[]; weights: number[] }, exclude: Set<MixState> = new Set()): MixState {
  for (let i = 0; i < 4; i++) {
    const s = ctx.rng.weighted(mix.states, mix.weights);
    if (!exclude.has(s)) return s;
  }
  return "direct";
}

interface PathResult {
  touches: Touch[];
}

/** Pre-signup (anonymous) touches for one visitor ending before `endAt`. */
function anonymousPath(ctx: Ctx, mix: ReturnType<typeof mixStates>, visitorId: string, endAt: number, count: number): PathResult {
  const { rng, profile } = ctx;
  const touches: Touch[] = [];
  if (count <= 0) return { touches };
  const spanDays = rng.geometric(1 / (profile.lagToSignupMeanDays + 1)) + (count > 1 ? 1 : 0);
  const spanMs = Math.min(spanDays, 60) * DAY_MS + rng.range(0, 6) * HOUR_MS;
  // Offsets as sorted fractions of the span; the last touch sits within an hour of the end.
  const fractions = Array.from({ length: count }, (_, i) => (i === count - 1 ? 1 : rng.next())).sort((a, b) => a - b);
  let prev: MixState | null = null;
  for (let i = 0; i < count; i++) {
    let state: MixState;
    if (i === 0) state = pickState(ctx, mix);
    else if (i === count - 1) state = rng.next() < 0.38 ? "direct" : rng.next() < 0.5 ? "seo" : pickState(ctx, mix, new Set([prev!]));
    else state = rng.next() < 0.25 ? "direct" : pickState(ctx, mix, new Set([prev!]));
    prev = state;
    const draft = draftTouch(ctx, state, false);
    const at = endAt - (1 - fractions[i]!) * spanMs - (i === count - 1 ? rng.range(5, 55) * 60_000 : 0);
    touches.push({
      id: rng.uuid(), visitorId, entityId: null, occurredAt: new Date(Math.round(at)).toISOString(), channelKey: draft.channelKey,
      campaignId: draft.campaignId, kind: draft.kind, source: draft.source, firstParty: draft.firstParty,
    });
  }
  return { touches };
}

/** Identified touches (lifecycle emails, outbound follow-ups) between two instants. */
function identifiedTouches(ctx: Ctx, entityId: string, visitorId: string, fromAt: number, toAt: number, count: number, channel: "email_automation" | "lead_generation"): Touch[] {
  const out: Touch[] = [];
  if (count <= 0 || toAt <= fromAt) return out;
  for (let i = 0; i < count; i++) {
    const draft = draftTouch(ctx, channel, true);
    const at = fromAt + ((i + 1) / (count + 1)) * (toAt - fromAt) + ctx.rng.range(-0.5, 0.5) * Math.min(HOUR_MS * 6, (toAt - fromAt) / (count + 1));
    out.push({
      id: ctx.rng.uuid(), visitorId, entityId, occurredAt: new Date(Math.round(clamp(at, fromAt + 1, toAt - 1))).toISOString(), channelKey: draft.channelKey,
      campaignId: draft.campaignId, kind: draft.kind, source: draft.source, firstParty: true,
    });
  }
  return out;
}

const signupInstant = (rng: SeededRng, dayStartMs: number, hour: readonly [number, number]): number =>
  dayStartMs + clamp(Math.round(rng.gaussian(hour[0], hour[1])), 0, 23) * HOUR_MS + rng.int(0, 59) * 60_000 + rng.int(0, 59) * 1000;

const pickConsent = (rng: SeededRng): ConsentState => {
  const r = rng.next();
  return r < 0.85 ? "granted" : r < 0.95 ? "unknown" : "denied";
};

// ---------------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------------

export function generateSyntheticJourneyData(options: GenerateSyntheticJourneyDataOptions): SyntheticJourneyData {
  const seed = String(options.seed);
  const days = options.days ?? 730;
  if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be a positive integer");
  const startDay = dayKeyUtc(typeof options.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.startDate) ? dayKeyToDate(options.startDate) : toDate(options.startDate));
  const endDay = addDaysKey(startDay, days - 1);
  const profile = PROFILES[options.archetype];
  const currency = (options.currency ?? "EUR").toUpperCase();
  const siteHost = options.siteHost ?? `${slug(seed) || "club"}.example`;
  const scale = options.volumeScale ?? 1;
  const visitorRatio = options.nonConvertingVisitorRatio ?? 0.6;
  const departments = options.departments.length ? options.departments : [{ id: createSeededRng(`${seed}:dept`).uuid(), name: "Operations", moduleKeys: [] as ModuleKey[] }];

  const root = createSeededRng(seed);
  const agents = makeAgents(root.fork("agents"), departments);
  const { campaigns, registry } = makeCampaigns(root.fork("campaigns"), siteHost);
  const agentsByChannel = new Map<ChannelKey, SyntheticAgent[]>();
  for (const a of agents) for (const k of a.channelKeys ?? []) agentsByChannel.set(k, [...(agentsByChannel.get(k) ?? []), a]);
  const ctx: Ctx = {
    rng: root.fork("customers"), profile, archetype: options.archetype, siteHost, campaigns, agentsByChannel,
    lifecycleAgent: agentsByChannel.get("email_automation")?.[0] ?? null,
    outboundAgent: agentsByChannel.get("lead_generation")?.[0] ?? null,
  };
  const mix = mixStates(profile);
  const { events, dip } = script(profile, options.archetype, days);

  // Day-level multipliers.
  const dayKeys: DayKey[] = new Array(days);
  const signupLambda: number[] = new Array(days);
  const hoursFactor: number[] = new Array(days);
  const weeklyHours = [1, 1.05, 1.05, 1, 0.95, 0.35, 0.25] as const;
  const shapeRng = root.fork("shape");
  let signupStep = 1;
  let hoursStep = 1;
  let eventIdx = 0;
  for (let d = 0; d < days; d++) {
    const day = addDaysKey(startDay, d);
    dayKeys[d] = day;
    while (eventIdx < events.length && events[eventIdx]!.day <= d) {
      signupStep *= events[eventIdx]!.signupStep;
      hoursStep *= events[eventIdx]!.hoursStep;
      eventIdx += 1;
    }
    const inDip = d >= dip.from && d <= dip.to;
    const f = d / Math.max(1, days - 1);
    const ramp = 0.3 + 0.7 * (1 - Math.exp(-d / 45));
    const growth = 1 + 0.6 * f;
    const season = seasonality(profile.season, dayOfYearUtc(day));
    const wd = isoWeekdayUtc(day) - 1;
    const base = profile.signupsPerDay[0] + (profile.signupsPerDay[1] - profile.signupsPerDay[0]) * smoothstep(f);
    signupLambda[d] = Math.max(0, base * scale * season * profile.weekly[wd]! * signupStep * (inDip ? dip.signups : 1) * ramp * Math.exp(shapeRng.gaussian(0, 0.12)));
    hoursFactor[d] = Math.max(0, ramp * growth * season * weeklyHours[wd]! * hoursStep * (inDip ? dip.hours : 1));
  }

  // Customers, visitors, conversions, touches.
  const customers: SyntheticCustomer[] = [];
  const visitors: SyntheticVisitor[] = [];
  const conversions: Conversion[] = [];
  const touches: Touch[] = [];
  const revenueByDay = new Array<number>(days).fill(0);
  const mrrDelta = new Array<number>(days + 1).fill(0);
  const paymentsByDay: Array<Array<{ at: number; entityId: string; conversionId: string; amountMinor: number; enterprise: boolean }>> = Array.from({ length: days }, () => []);
  const paidSignupsByDay = new Array<number>(days).fill(0);
  const endMs = dayKeyToDate(endDay).getTime() + DAY_MS;
  const rng = ctx.rng;

  for (let d = 0; d < days; d++) {
    const dayStart = dayKeyToDate(dayKeys[d]!).getTime();
    const n = rng.poisson(signupLambda[d]!);
    for (let i = 0; i < n; i++) {
      const entityId = rng.uuid();
      const visitorId = rng.uuid();
      const consent = pickConsent(rng);
      const signupAt = signupInstant(rng, dayStart, profile.signupHour);
      const touchCount = clamp(1 + rng.poisson(Math.max(0, profile.touchesMean - 1)), 1, 8);
      const path = anonymousPath(ctx, mix, visitorId, signupAt, touchCount);
      // Organisations reached by outbound are identified before signup (CRM lead).
      const first = path.touches[0];
      if (first && first.channelKey === "lead_generation") for (const t of path.touches) if (t.channelKey === "lead_generation") t.entityId = entityId;
      if (first?.channelKey === "paid_ads") paidSignupsByDay[d] = paidSignupsByDay[d]! + 1;
      touches.push(...path.touches);
      const signupConversionId = rng.uuid();
      conversions.push({ id: signupConversionId, entityId, kind: "signup", amountMinor: 0, currency, occurredAt: new Date(signupAt).toISOString(), sourceEventId: null, firstPayment: true });

      let activatedAt: number | null = null;
      let paidAt: number | null = null;
      let amountMinor: number | null = null;
      let enterprise = false;
      let mrr = 0;
      let churnedAt: number | null = null;
      if (rng.bool(profile.activationRate)) {
        const lagDays = rng.geometric(1 / (profile.activationLagMeanDays + 1));
        activatedAt = signupAt + lagDays * DAY_MS + rng.range(0.5, 20) * HOUR_MS;
        touches.push(...identifiedTouches(ctx, entityId, visitorId, signupAt, activatedAt, rng.int(1, 3), "email_automation"));
        if (activatedAt < endMs) {
          conversions.push({ id: rng.uuid(), entityId, kind: "activation", amountMinor: 0, currency, occurredAt: new Date(activatedAt).toISOString(), sourceEventId: null, firstPayment: true });
        }
        if (rng.bool(profile.paymentRate)) {
          const payLag = rng.geometric(1 / (profile.paymentLagMeanDays + 1));
          paidAt = activatedAt + payLag * DAY_MS + rng.range(0.2, 12) * HOUR_MS;
          enterprise = profile.enterpriseShare > 0 && rng.bool(profile.enterpriseShare);
          amountMinor = enterprise ? rng.int(profile.enterprisePriceMinor[0], profile.enterprisePriceMinor[1]) : rng.int(profile.priceMinor[0], profile.priceMinor[1]);
          amountMinor = Math.round(amountMinor / 100) * 100 - 1; // €x9.99 style prices
          const emails = rng.int(0, 2) + (enterprise ? 1 : 0);
          touches.push(...identifiedTouches(ctx, entityId, visitorId, activatedAt, paidAt, emails, profile.customerKind === "organisation" && rng.bool(0.4) ? "lead_generation" : "email_automation"));
          if (paidAt < endMs) {
            const payDay = Math.floor((paidAt - dayKeyToDate(startDay).getTime()) / DAY_MS);
            const conversionId = rng.uuid();
            conversions.push({ id: conversionId, entityId, kind: "payment", amountMinor, currency, occurredAt: new Date(paidAt).toISOString(), sourceEventId: null, firstPayment: true });
            revenueByDay[payDay] = revenueByDay[payDay]! + amountMinor;
            paymentsByDay[payDay]!.push({ at: paidAt, entityId, conversionId, amountMinor, enterprise });
            if (profile.recurring) {
              mrr = enterprise ? Math.round(amountMinor / 12) : amountMinor;
              const months = 1 + rng.geometric(profile.monthlyChurn);
              const churnDay = payDay + months * 30;
              mrrDelta[payDay] = mrrDelta[payDay]! + mrr;
              if (churnDay < days) {
                mrrDelta[churnDay] = mrrDelta[churnDay]! - mrr;
                churnedAt = dayKeyToDate(startDay).getTime() + churnDay * DAY_MS;
              }
              // Renewals: one-off annual contracts renew yearly, subscriptions monthly.
              const period = enterprise ? 365 : 30;
              for (let k = payDay + period; k < Math.min(days, churnDay); k += period) revenueByDay[k] = revenueByDay[k]! + (enterprise ? amountMinor : mrr);
            }
          }
        }
      }
      customers.push({
        entityId, visitorId, displayName: profile.customerKind === "organisation" ? orgName(rng) : personName(rng), kind: profile.customerKind, consent,
        signupAt: new Date(signupAt).toISOString(), activatedAt: activatedAt ? new Date(activatedAt).toISOString() : null, paidAt: paidAt ? new Date(paidAt).toISOString() : null,
        amountMinor, enterprise, mrrMinor: mrr, churnedAt: churnedAt ? new Date(churnedAt).toISOString() : null,
      });
      visitors.push({
        id: visitorId, anonId: `anon_${visitorId.slice(0, 12)}`, entityId, firstSeen: path.touches[0]?.occurredAt ?? new Date(signupAt).toISOString(),
        lastSeen: new Date(signupAt).toISOString(), consentState: consent, converted: true,
      });
    }
    // Anonymous visitors that never convert.
    const lost = rng.poisson(signupLambda[d]! * visitorRatio);
    for (let i = 0; i < lost; i++) {
      const visitorId = rng.uuid();
      const endAt = dayStart + rng.range(0, 24) * HOUR_MS;
      const path = anonymousPath(ctx, mix, visitorId, endAt, clamp(1 + rng.poisson(0.8), 1, 4));
      touches.push(...path.touches);
      visitors.push({
        id: visitorId, anonId: `anon_${visitorId.slice(0, 12)}`, entityId: null, firstSeen: path.touches[0]!.occurredAt, lastSeen: path.touches[path.touches.length - 1]!.occurredAt,
        consentState: pickConsent(rng), converted: false,
      });
    }
  }

  // Daily rows: one per department (hours, tasks, agent cost) plus the business-wide row (channel spend, conversions, decisions).
  const dailyRng = root.fork("daily");
  const daily: JourneyDailyRow[] = [];
  const signupsByDay = new Array<number>(days).fill(0);
  const activationsByDay = new Array<number>(days).fill(0);
  const paymentCountByDay = new Array<number>(days).fill(0);
  const startMs = dayKeyToDate(startDay).getTime();
  for (const c of conversions) {
    const d = Math.floor((Date.parse(c.occurredAt) - startMs) / DAY_MS);
    if (d < 0 || d >= days) continue;
    if (c.kind === "signup") signupsByDay[d] = signupsByDay[d]! + 1;
    else if (c.kind === "activation") activationsByDay[d] = activationsByDay[d]! + 1;
    else paymentCountByDay[d] = paymentCountByDay[d]! + 1;
  }
  const distributionDept = departments.find((x) => x.moduleKeys?.includes("distribution")) ?? null;
  for (let d = 0; d < days; d++) {
    const day = dayKeys[d]!;
    for (const dept of departments) {
      const modules = dept.moduleKeys ?? [];
      const base = modules.length ? modules.reduce((s, m) => s + MODULE_HOURS[m], 0) : DEFAULT_MODULE_HOURS;
      const hours = Math.max(0, base * hoursFactor[d]! * Math.exp(dailyRng.gaussian(0, 0.12)));
      const row: JourneyDailyRow = {
        day, departmentId: dept.id, agentHours: Math.round(hours * 1000) / 1000, tasksDone: dailyRng.poisson(hours / 2.5),
        spendMinor: Math.round(hours * AGENT_HOUR_COST_MINOR), revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0,
      };
      if (options.businessId) row.businessId = options.businessId;
      daily.push(row);
    }
    const adSpend = distributionDept ? Math.round((paidSignupsByDay[d]! * profile.adCpaMinor + 1_500 * hoursFactor[d]!) * Math.exp(dailyRng.gaussian(0, 0.2))) : 0;
    const weekday = isoWeekdayUtc(day) <= 5;
    const businessRow: JourneyDailyRow = {
      day, departmentId: null, agentHours: 0, tasksDone: 0, spendMinor: Math.max(0, adSpend), revenueMinor: revenueByDay[d]!,
      signups: signupsByDay[d]!, activations: activationsByDay[d]!, payments: paymentCountByDay[d]!,
      decisions: dailyRng.poisson((weekday ? 0.55 : 0.1) * (d < 60 ? 1.6 : 1)),
    };
    if (options.businessId) businessRow.businessId = options.businessId;
    daily.push(businessRow);
  }

  // Series and trophies.
  const mrrMinorByDay = new Array<number>(days).fill(0);
  const customersByDay = new Array<number>(days).fill(0);
  let mrr = 0;
  let customersSoFar = 0;
  let enterpriseSoFar = 0;
  const milestones: Milestone[] = [];
  const awarded = new Set<TrophyKey>();
  const milestoneRng = root.fork("milestones");
  for (let d = 0; d < days; d++) {
    mrr += mrrDelta[d]!;
    const trailing = profile.recurring ? mrr : sumRange(revenueByDay, d - 29, d);
    mrrMinorByDay[d] = Math.max(0, trailing);
    const before: TrophyCounters = { customers: customersSoFar, mrrMinor: d > 0 ? mrrMinorByDay[d - 1]! : 0, enterpriseContracts: enterpriseSoFar };
    const todays = paymentsByDay[d]!.sort((a, b) => a.at - b.at);
    // Customer / enterprise trophies fire on the exact payment that crosses the threshold.
    for (const p of todays) {
      customersSoFar += 1;
      if (p.enterprise && isEnterpriseContract(p.amountMinor)) enterpriseSoFar += 1;
      const stepBefore: TrophyCounters = { customers: customersSoFar - 1, mrrMinor: before.mrrMinor, enterpriseContracts: p.enterprise ? enterpriseSoFar - 1 : enterpriseSoFar };
      const stepAfter: TrophyCounters = { customers: customersSoFar, mrrMinor: before.mrrMinor, enterpriseContracts: enterpriseSoFar };
      for (const m of detectTrophies({ before: stepBefore, after: stepAfter, at: new Date(p.at), currency, awarded, ref: { conversionId: p.conversionId, entityId: p.entityId }, businessId: options.businessId })) {
        awarded.add(m.trophyKey!);
        milestones.push({ ...m, id: milestoneRng.uuid() });
      }
    }
    customersByDay[d] = customersSoFar;
    const after: TrophyCounters = { customers: customersSoFar, mrrMinor: mrrMinorByDay[d]!, enterpriseContracts: enterpriseSoFar };
    const endOfDay = new Date(dayKeyToDate(dayKeys[d]!).getTime() + 23 * HOUR_MS);
    for (const m of detectTrophies({ before: { ...before, customers: customersSoFar, enterpriseContracts: enterpriseSoFar }, after, at: endOfDay, currency, awarded, businessId: options.businessId })) {
      awarded.add(m.trophyKey!);
      milestones.push({ ...m, id: milestoneRng.uuid() });
    }
  }
  // Scripted banners, flags and diamonds.
  for (const e of events) {
    milestones.push({
      id: milestoneRng.uuid(), businessId: options.businessId, kind: e.kind, label: e.label,
      achievedAt: new Date(dayKeyToDate(dayKeys[e.day]!).getTime() + 10 * HOUR_MS).toISOString(), ref: { scripted: true }, visibility: "private", trophyKey: null,
    });
  }
  const launchDay = events.find((e) => e.kind === "launch")?.day ?? 0;
  let release = 0;
  for (let d = launchDay + 21; d < days; d += 21) {
    if (!milestoneRng.bool(0.6)) continue;
    release += 1;
    milestones.push({
      id: milestoneRng.uuid(), businessId: options.businessId, kind: "release", label: `Release ${1 + Math.floor(release / 10)}.${release % 10}`,
      achievedAt: new Date(dayKeyToDate(dayKeys[d]!).getTime() + 16 * HOUR_MS).toISOString(), ref: { scripted: true }, visibility: "private", trophyKey: null,
    });
  }
  for (const m of milestones) if (m.businessId === undefined) delete m.businessId;
  milestones.sort((a, b) => Date.parse(a.achievedAt) - Date.parse(b.achievedAt) || a.label.localeCompare(b.label));

  conversions.sort(compareByTimeThenId);
  touches.sort(compareByTimeThenId);
  const today = options.today ?? endDay;
  const chapters = buildChapters({ startDay, today, daily, milestones });

  return {
    meta: {
      seed, label: "Synthetic", archetype: options.archetype, startDate: startDay, endDate: endDay, days, currency, kitColour: options.kitColour ?? null, siteHost,
      businessId: options.businessId ?? null, departmentIds: departments.map((d) => d.id), recurring: profile.recurring,
    },
    daily, conversions, touches, milestones, chapters, customers, visitors, agents, campaigns, registry,
    series: { mrrMinorByDay, customersByDay },
  };
}

const smoothstep = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

function sumRange(arr: readonly number[], from: number, to: number): number {
  let s = 0;
  for (let i = Math.max(0, from); i <= to && i < arr.length; i++) s += arr[i]!;
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Grouping helpers for training the data-driven models from synthetic data
// ---------------------------------------------------------------------------------------------------

/** Touch groups per visitor (anonymous path + stitched identified touches) with the converted flag — feed to buildMarkovModel / xcSamplesFromPaths. */
export function syntheticConversionGroups(data: Pick<SyntheticJourneyData, "touches" | "visitors">): Array<{ touches: Touch[]; converted: boolean }> {
  const byVisitor = new Map<string, Touch[]>();
  for (const t of data.touches) {
    const key = t.visitorId ?? t.entityId;
    if (!key) continue;
    byVisitor.set(key, [...(byVisitor.get(key) ?? []), t]);
  }
  const out: Array<{ touches: Touch[]; converted: boolean }> = [];
  for (const v of data.visitors) {
    const ts = byVisitor.get(v.id);
    if (!ts || ts.length === 0) continue;
    out.push({ touches: ts.sort(compareByTimeThenId), converted: v.converted });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// One conversion path for Match Day replays
// ---------------------------------------------------------------------------------------------------

export interface GenerateSyntheticConversionPathOptions {
  archetype?: Archetype;
  kind?: Conversion["kind"];
  /** Conversion instant; default 2025-06-12T09:30:00Z plus a seed-derived offset. */
  at?: Date | string;
  currency?: string;
  touchCount?: number;
  consent?: ConsentState;
  /** Count context for the volume rule; defaults are seed-derived small numbers (full Match Day). */
  counts?: Partial<BuildJourneyInput["counts"]>;
  departments?: readonly SyntheticDepartmentInput[];
}

export interface SyntheticConversionPath extends BuildJourneyInput {
  conversion: Conversion;
  touches: Touch[];
  agents: SyntheticAgent[];
  customer: SyntheticCustomer;
  registry: AttributionRegistry;
}

/** A single deterministic journey input (conversion, touches, agents, consent, counts) for `buildJourney`. */
export function generateSyntheticConversionPath(seed: string | number, options: GenerateSyntheticConversionPathOptions = {}): SyntheticConversionPath {
  const archetype = options.archetype ?? "b2b_saas";
  const profile = PROFILES[archetype];
  const currency = (options.currency ?? "EUR").toUpperCase();
  const root = createSeededRng(`path:${String(seed)}`);
  const siteHost = `${slug(String(seed)) || "club"}.example`;
  const departments = options.departments ?? [{ id: root.fork("dept").uuid(), name: "Distribution", moduleKeys: ["distribution"] as ModuleKey[] }];
  const agents = makeAgents(root.fork("agents"), departments);
  const { campaigns, registry } = makeCampaigns(root.fork("campaigns"), siteHost);
  const agentsByChannel = new Map<ChannelKey, SyntheticAgent[]>();
  for (const a of agents) for (const k of a.channelKeys ?? []) agentsByChannel.set(k, [...(agentsByChannel.get(k) ?? []), a]);
  const rng = root.fork("customer");
  const ctx: Ctx = {
    rng, profile, archetype, siteHost, campaigns, agentsByChannel,
    lifecycleAgent: agentsByChannel.get("email_automation")?.[0] ?? null, outboundAgent: agentsByChannel.get("lead_generation")?.[0] ?? null,
  };
  const kind = options.kind ?? "payment";
  const at = options.at ? toDate(options.at).getTime() : Date.UTC(2025, 5, 12, 9, 30) + rng.int(0, 120) * DAY_MS + rng.int(0, 600) * 60_000;
  const entityId = rng.uuid();
  const visitorId = rng.uuid();
  const consent = options.consent ?? pickConsent(rng);
  const touchCount = options.touchCount ?? clamp(2 + rng.poisson(Math.max(0, profile.touchesMean - 1)), 1, 8);

  // Signup precedes activation precedes payment.
  const signupAt = kind === "signup" ? at : at - (kind === "activation" ? rng.range(1, 6) : rng.range(3, 20)) * DAY_MS;
  const activatedAt = kind === "signup" ? null : kind === "activation" ? at : at - rng.range(1, 8) * DAY_MS;
  const touches: Touch[] = [...anonymousPath(ctx, mixStates(profile), visitorId, signupAt, touchCount).touches];
  if (activatedAt) touches.push(...identifiedTouches(ctx, entityId, visitorId, signupAt, activatedAt, rng.int(1, 2), "email_automation"));
  if (kind === "payment" && activatedAt) {
    touches.push(...identifiedTouches(ctx, entityId, visitorId, activatedAt, at, rng.int(1, 2), profile.customerKind === "organisation" ? "lead_generation" : "email_automation"));
  }
  touches.sort(compareByTimeThenId);
  const enterprise = kind === "payment" && profile.enterpriseShare > 0 && rng.bool(profile.enterpriseShare);
  const amountMinor = kind === "payment" ? (enterprise ? rng.int(profile.enterprisePriceMinor[0], profile.enterprisePriceMinor[1]) : rng.int(profile.priceMinor[0], profile.priceMinor[1])) : 0;
  const conversion: Conversion = { id: rng.uuid(), entityId, kind, amountMinor, currency, occurredAt: new Date(at).toISOString(), sourceEventId: null, firstPayment: true };
  const customer: SyntheticCustomer = {
    entityId, visitorId, displayName: profile.customerKind === "organisation" ? orgName(rng) : personName(rng), kind: profile.customerKind, consent,
    signupAt: new Date(signupAt).toISOString(), activatedAt: activatedAt ? new Date(activatedAt).toISOString() : null,
    paidAt: kind === "payment" ? conversion.occurredAt : null, amountMinor: kind === "payment" ? amountMinor : null, enterprise, mrrMinor: profile.recurring && kind === "payment" ? amountMinor : 0, churnedAt: null,
  };
  const counts: BuildJourneyInput["counts"] = {
    conversions: options.counts?.conversions ?? rng.int(5, 150),
    nthOfKind: options.counts?.nthOfKind ?? rng.int(1, 60),
    valuePercentile75Minor: options.counts?.valuePercentile75Minor ?? null,
    flaggedHighValue: options.counts?.flaggedHighValue ?? enterprise,
  };
  return {
    conversion, touches, agents, consent, counts, archetype, visitorIds: [visitorId], customer, registry,
    costs: { cpaByChannelMinor: Object.fromEntries(CHANNEL_KEYS.map((k) => [k, k === "paid_ads" ? profile.adCpaMinor : Math.round(profile.adCpaMinor * 0.4)])) },
  };
}
